import React, { useState } from "react";
import { View, RefreshControl } from "react-native";
import { BottomSheetModal } from "../../../src/components/BottomSheetModal";
import { Icon } from "../../../src/components/Icon";
import { GutterScrollView } from "../../../src/components/Gutter";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueries, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRefetchOnFocus, useResetOnBlur } from "../../../src/hooks/useRefetchOnFocus";
import { useDebouncedValue } from "../../../src/hooks/useDebouncedValue";
import { ScreenContainer } from "../../../src/components/ScreenContainer";
import { Card } from "../../../src/components/Card";
import { ThemedText } from "../../../src/components/ThemedText";
import { GoldTextInput } from "../../../src/components/GoldTextInput";
import { GoldButton } from "../../../src/components/GoldButton";
import { SearchDropdown } from "../../../src/components/SearchDropdown";
import { Stepper, Step } from "../../../src/components/Stepper";
import { colors, statusColors, StatusTone } from "../../../src/theme/colors";
import { useTheme } from "../../../src/theme/ThemeProvider";
import { getPacket, getPacketMovements, movePacket } from "../../../src/api/packets";
import { listLockersPage, getLocker } from "../../../src/api/lockers";
import { Locker } from "../../../src/types/locker";
import { useAuth } from "../../../src/auth/AuthContext";
import { ApiError } from "../../../src/api/client";
import { fmt } from "../../../src/lib/format";
import { Loading } from "../../../src/components/Loading";

const GENERATED = "Packet Generated";
const LOCKER_STORED = "Locker Stored";
const BANK_PLEDGED = "Bank Pledged";
const RETURNED = "Returned";
const READY_FOR_RELEASE = "Ready For Release"; // legacy — nothing moves into it any more
const RELEASED = "Released";

// Loan outcomes after which the gold has left custody — the backend rejects
// every movement (ErrLoanNoLongerMovable), so no actions are offered.
const AUCTIONED_LOAN = ["Auctioned", "Auctioned - Balance Due"];

function toneForStatus(status: string): StatusTone {
  if (status === RELEASED) return "green";
  if (status === BANK_PLEDGED) return "info";
  if (status === "Auctioned") return "red";
  if (status === READY_FOR_RELEASE || status === RETURNED) return "amber";
  return "muted";
}

function StatusPill({ status }: { status: string }) {
  const { colors } = useTheme();
  const tone = statusColors(toneForStatus(status), colors);
  return (
    <ThemedText
      variant="label"
      numberOfLines={1}
      style={{ backgroundColor: tone.bg, color: tone.fg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, alignSelf: "flex-start", fontSize: 12 }}
    >
      {status}
    </ThemedText>
  );
}

const lockerLabel = (l: Locker) => `${l.code} (${l.occupied}/${l.capacity})`;

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 6 }}>
      <ThemedText variant="small" color={colors.muted}>
        {k}
      </ThemedText>
      {typeof v === "string" ? (
        <ThemedText variant="small" style={{ flexShrink: 1, textAlign: "right" }}>
          {v}
        </ThemedText>
      ) : (
        v
      )}
    </View>
  );
}

export default function PacketDetailScreen() {
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const packetId = Number(id);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { employee, can } = useAuth();
  // Same gates as the web PacketDetail: every movement writes the packet.
  const canMove = can("Packet_Management", "can_update_packet");
  const canBankPledge = can("Bank_Pledge_Management", "can_create_bank_pledge");

  const packet = useQuery({ queryKey: ["packet", id], queryFn: () => getPacket(packetId), enabled: !!id });
  const movements = useQuery({
    queryKey: ["packet", id, "movements"],
    queryFn: () => getPacketMovements(packetId),
    enabled: !!id,
  });

  useRefetchOnFocus(packet.refetch, movements.refetch);

  const [pickLocker, setPickLocker] = useState(false);
  const [lockerQuery, setLockerQuery] = useState("");
  const [lockerOpen, setLockerOpen] = useState(false);
  const [locker, setLocker] = useState<Locker | null>(null);
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState<string | null>(null);
  const debouncedLockerQuery = useDebouncedValue(lockerQuery);

  const branchId = packet.data?.loan?.branchId;
  // A locker physically lives at one branch, so the picker is scoped to the
  // loan's branch. Distinct key from the Lockers list's infinite query —
  // sharing ["lockers"] mixed a paged cache shape with this one.
  const lockerSearch = useQuery({
    queryKey: ["lockers", "picker", branchId, debouncedLockerQuery],
    queryFn: () =>
      listLockersPage({ branchId, active: true, q: debouncedLockerQuery || undefined, limit: 20, offset: 0 }),
    enabled: pickLocker && branchId != null,
  });
  const lockerOptions = (lockerSearch.data?.items ?? []).filter((l) => l.occupied < l.capacity);

  // Movement rows and the current locker only carry an id — resolve codes per
  // distinct locker (usually one or two) rather than listing the branch.
  const lockerIds = Array.from(
    new Set(
      [packet.data?.currentLockerId, ...(movements.data ?? []).map((m) => m.lockerId)].filter(
        (v): v is number => typeof v === "number" && v > 0
      )
    )
  );
  const lockerLookups = useQueries({
    queries: lockerIds.map((lid) => ({ queryKey: ["locker", String(lid)], queryFn: () => getLocker(lid), staleTime: 60_000 })),
  });
  const lockerCode = (lid?: number) => {
    if (!lid) return undefined;
    const found = lockerLookups[lockerIds.indexOf(lid)]?.data;
    return found?.code ?? `#${lid}`;
  };

  function resetPicker() {
    setPickLocker(false);
    setLockerQuery("");
    setLockerOpen(false);
    setLocker(null);
  }

  const move = useMutation({
    mutationFn: (input: { toStatus: string; lockerId?: number }) =>
      movePacket(packetId, { ...input, employeeId: employee!.id, remarks: remarks.trim() || undefined }),
    onSuccess: (updated) => {
      setReleaseConfirmOpen(false);
      setRemarks("");
      setError(null);
      resetPicker();
      queryClient.setQueryData(["packet", id], updated);
      queryClient.invalidateQueries({ queryKey: ["packet", id] });
      queryClient.invalidateQueries({ queryKey: ["packets"] });
      queryClient.invalidateQueries({ queryKey: ["lockers"] });
      queryClient.invalidateQueries({ queryKey: ["locker"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not record movement."),
  });

  const [releaseConfirmOpen, setReleaseConfirmOpen] = useState(false);
  function confirmRelease() {
    setReleaseConfirmOpen(true);
  }

  useResetOnBlur(() => {
    setReleaseConfirmOpen(false);
    resetPicker();
  });

  if (packet.isLoading) return <Loading full />;
  if (packet.isError || !packet.data)
    return (
      <ScreenContainer style={{ padding: 0 }}>
        <View style={{ flex: 1, paddingHorizontal: 8, paddingTop: 20 }}>
          <ThemedText color={colors.red}>Could not load this packet.</ThemedText>
        </View>
      </ScreenContainer>
    );

  const p = packet.data;
  const status = p.status;
  const loanStatus = p.loan?.status ?? "";
  const isAuctioned = AUCTIONED_LOAN.includes(loanStatus);
  // Once auctioned/closed the gold has left custody: the loan outcome is the
  // meaningful status and the packet's own stage is moot.
  const movementLocked = isAuctioned || loanStatus === "Closed" || loanStatus === "Rejected";
  const displayStatus = isAuctioned ? "Auctioned" : status;

  // Rail shows only the stages this packet can actually pass through: the
  // bank detour only once it's been pledged, the legacy stage only if used.
  const visited = new Set([status, ...(movements.data ?? []).map((m) => m.toStatus)]);
  const rail = [GENERATED, LOCKER_STORED];
  if (visited.has(BANK_PLEDGED) || visited.has(RETURNED)) rail.push(BANK_PLEDGED, RETURNED);
  if (visited.has(READY_FOR_RELEASE)) rail.push(READY_FOR_RELEASE);
  rail.push(RELEASED);
  const railIndex = rail.indexOf(status);
  const steps: Step[] = rail.map((label, i) => ({
    key: label,
    label,
    state: i < railIndex || (status === RELEASED && i === railIndex) ? "done" : i === railIndex ? "current" : "upcoming",
    caption:
      i === railIndex && status === RETURNED ? "Returned from the bank — check in to a locker or release" : undefined,
  }));

  const ornaments = p.loan?.ornaments ?? [];
  const itemCount = ornaments.reduce((sum, o) => sum + (o.quantity || 0), 0);
  const netWeight = p.totalNetWeight ?? ornaments.reduce((sum, o) => sum + (o.netWeight || 0), 0);
  const grossWeight = p.totalGrossWeight ?? ornaments.reduce((sum, o) => sum + (o.grossWeight || 0), 0);
  const totalGoldValue = ornaments.reduce((sum, o) => sum + (o.goldValue || 0), 0);

  const canCheckIn = status === GENERATED || status === RETURNED;
  const canRelease = status === LOCKER_STORED || status === RETURNED || status === READY_FOR_RELEASE;
  const hasActions = canMove && !movementLocked && (canCheckIn || canRelease);

  return (
    <ScreenContainer style={{ padding: 0 }}>
      <View style={{ flex: 1, paddingHorizontal: 8, paddingTop: 20 }} onTouchStart={() => lockerOpen && setLockerOpen(false)}>
        <GutterScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={packet.isRefetching || movements.isRefetching}
              onRefresh={() => {
                packet.refetch();
                movements.refetch();
              }}
            />
          }
        >
          <Card>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <ThemedText variant="h2" color={colors.brandDeep} style={{ flexShrink: 1 }}>
                {p.code}
              </ThemedText>
              <StatusPill status={displayStatus} />
            </View>
            <ThemedText variant="body" style={{ marginTop: 8 }}>
              {p.loan?.loanNumber ?? `Loan #${p.loanId}`}
              {p.loan?.customer?.name ? ` · ${p.loan.customer.name}` : ""}
            </ThemedText>
            <View style={{ marginTop: 8 }}>
              <KV k="Branch" v={p.loan?.branch?.name ?? "—"} />
              <KV k="Current locker" v={lockerCode(p.currentLockerId) ?? "—"} />
              <KV k="Items" v={String(itemCount)} />
              <KV k="Gross weight" v={`${grossWeight.toFixed(2)} g`} />
              <KV k="Net weight" v={`${netWeight.toFixed(2)} g`} />
            </View>
            <GoldButton
              title="Open loan"
              variant="outline"
              onPress={() => router.push(`/loans/${p.loanId}`)}
              style={{ marginTop: 10 }}
            />
          </Card>

          {/* The loan's still-pledged ornaments (released ones drop off) —
              staff opening a locker check the packet against this list. */}
          <Card>
            <ThemedText variant="h3" style={{ marginBottom: 10 }}>
              Packet contents
            </ThemedText>
            {ornaments.length === 0 ? (
              <ThemedText variant="small" color={colors.muted}>
                No ornaments left in this packet.
              </ThemedText>
            ) : (
              <>
                {ornaments.map((o) => (
                  <View
                    key={o.id}
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: 12,
                      paddingVertical: 8,
                      borderTopWidth: 1,
                      borderTopColor: colors.line,
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <ThemedText variant="body">
                        {o.name}
                        {o.quantity > 1 ? ` × ${o.quantity}` : ""}
                      </ThemedText>
                      <ThemedText variant="small" color={colors.muted}>
                        {o.purity} · {o.netWeight}g net
                        {o.grossWeight && o.grossWeight !== o.netWeight ? ` (${o.grossWeight}g gross)` : ""}
                      </ThemedText>
                      {o.remarks ? (
                        <ThemedText variant="small" color={colors.muted}>
                          {o.remarks}
                        </ThemedText>
                      ) : null}
                    </View>
                    <ThemedText variant="body" color={colors.brandDeep}>
                      {fmt(o.goldValue)}
                    </ThemedText>
                  </View>
                ))}
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    paddingTop: 10,
                    marginTop: 2,
                    borderTopWidth: 1,
                    borderTopColor: colors.line,
                  }}
                >
                  <ThemedText variant="label" color={colors.muted}>
                    {itemCount} item{itemCount === 1 ? "" : "s"} · {netWeight.toFixed(2)}g net
                  </ThemedText>
                  <ThemedText variant="label" color={colors.brandDeep}>
                    {fmt(totalGoldValue)}
                  </ThemedText>
                </View>
              </>
            )}
          </Card>

          <Card>
            <ThemedText variant="h3" style={{ marginBottom: 14 }}>
              Custody progress
            </ThemedText>
            {isAuctioned ? (
              <ThemedText variant="small" color={colors.muted}>
                This loan's gold was sold at auction — the packet's locker workflow no longer applies.
              </ThemedText>
            ) : (
              <Stepper steps={steps} />
            )}
          </Card>

          <Card>
            <ThemedText variant="h3" style={{ marginBottom: 8 }}>
              Actions
            </ThemedText>

            {movementLocked ? (
              <ThemedText variant="small" color={colors.muted}>
                {isAuctioned ? "The loan was auctioned" : "The loan is closed"} — no further packet movements are possible.
              </ThemedText>
            ) : status === BANK_PLEDGED ? (
              <ThemedText variant="small" color={colors.muted}>
                This packet's gold is pledged with a bank. Release it from Bank Pledge (the loan's bank pledge) — that
                returns the packet here automatically as "Returned".
              </ThemedText>
            ) : status === RELEASED ? (
              <ThemedText variant="small" color={colors.muted}>
                This packet has been released to the customer — no further actions.
              </ThemedText>
            ) : !canMove ? (
              <ThemedText variant="small" color={colors.muted}>
                You don't have permission to move packets.
              </ThemedText>
            ) : null}

            {hasActions ? (
              <>
                {pickLocker ? (
                  <>
                    <SearchDropdown<Locker>
                      label="Check in to locker"
                      placeholder="Search locker code…"
                      query={lockerQuery}
                      onQueryChange={(v) => {
                        setLockerQuery(v);
                        setLocker(null);
                      }}
                      open={lockerOpen}
                      onOpenChange={setLockerOpen}
                      items={lockerOptions}
                      keyOf={(l) => l.id}
                      renderItem={(l) => (
                        <View>
                          <ThemedText variant="body">{lockerLabel(l)}</ThemedText>
                          {l.branch?.name ? (
                            <ThemedText variant="small" color={colors.muted}>
                              {l.branch.name}
                            </ThemedText>
                          ) : null}
                        </View>
                      )}
                      onSelect={(l) => {
                        setLocker(l);
                        setLockerQuery(lockerLabel(l));
                        setError(null);
                      }}
                      loading={lockerSearch.isFetching}
                      emptyText={branchId == null ? "This loan has no branch." : "No locker with free space."}
                    />
                    <GoldTextInput label="Remarks (optional)" value={remarks} onChangeText={setRemarks} />
                    {error ? (
                      <ThemedText variant="small" color={colors.red} style={{ marginBottom: 8 }}>
                        {error}
                      </ThemedText>
                    ) : null}
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <View style={{ flex: 1 }}>
                        <GoldButton title="Cancel" variant="outline" onPress={resetPicker} disabled={move.isPending} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <GoldButton
                          title="Confirm Check-In"
                          icon="lock"
                          onPress={() => locker && move.mutate({ toStatus: LOCKER_STORED, lockerId: locker.id })}
                          loading={move.isPending}
                          disabled={!locker}
                        />
                      </View>
                    </View>
                  </>
                ) : (
                  <>
                    <GoldTextInput label="Remarks (optional)" value={remarks} onChangeText={setRemarks} />
                    {error ? (
                      <ThemedText variant="small" color={colors.red} style={{ marginBottom: 8 }}>
                        {error}
                      </ThemedText>
                    ) : null}
                    <View style={{ gap: 8 }}>
                      {canCheckIn ? (
                        <GoldButton
                          title="Check In to Locker"
                          icon="lock"
                          onPress={() => {
                            setError(null);
                            setPickLocker(true);
                            setLockerOpen(true);
                          }}
                          disabled={move.isPending}
                        />
                      ) : null}
                      {canRelease ? (
                        <GoldButton
                          title="Release"
                          icon="check"
                          variant={canCheckIn ? "outline" : "primary"}
                          onPress={confirmRelease}
                          loading={move.isPending}
                        />
                      ) : null}
                      {/* A bank pledge is a real transaction (bank, amount,
                          cash) recorded on the loan — it moves the packet to
                          Bank Pledged itself. */}
                      {status === LOCKER_STORED && canBankPledge ? (
                        <GoldButton
                          title="Repledge to Bank"
                          icon="bank"
                          variant="outline"
                          onPress={() => router.push(`/loans/${p.loanId}`)}
                        />
                      ) : null}
                    </View>
                  </>
                )}
              </>
            ) : null}
          </Card>

          <Card>
            <ThemedText variant="h3" style={{ marginBottom: 8 }}>
              Movement history
            </ThemedText>
            {movements.data?.length ? (
              movements.data.map((m, i) => {
                // Same-status rows are partial ornament releases, not moves.
                const isRemark = !!m.fromStatus && m.fromStatus === m.toStatus;
                const remarkText = m.remarks
                  ? /^partial release/i.test(m.remarks)
                    ? m.remarks
                    : `Partial release: ${m.remarks}`
                  : "Partial release";
                const lk = lockerCode(m.lockerId);
                const meta = [
                  new Date(m.createdAt).toLocaleString("en-IN"),
                  lk ? `Locker ${lk}` : null,
                  m.actorEmployeeId ? `EMP-${m.actorEmployeeId}` : "System",
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <View
                    key={m.id}
                    style={{ paddingVertical: 8, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.line }}
                  >
                    <ThemedText variant="small" color={isRemark ? colors.muted : undefined}>
                      {isRemark ? remarkText : m.fromStatus ? `${m.fromStatus} → ${m.toStatus}` : m.toStatus}
                    </ThemedText>
                    <ThemedText variant="small" color={colors.muted}>
                      {meta}
                    </ThemedText>
                    {!isRemark && m.remarks ? (
                      <ThemedText variant="small" color={colors.muted}>
                        {m.remarks}
                      </ThemedText>
                    ) : null}
                  </View>
                );
              })
            ) : (
              <ThemedText variant="small" color={colors.muted}>
                No movements yet.
              </ThemedText>
            )}
          </Card>
        </GutterScrollView>
      </View>

      <BottomSheetModal visible={releaseConfirmOpen} onClose={() => setReleaseConfirmOpen(false)}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.redBg, alignItems: "center", justifyContent: "center" }}>
            <Icon name="warning" size={20} color={colors.red} />
          </View>
          <ThemedText variant="h3">Release packet?</ThemedText>
        </View>
        <ThemedText variant="body" color={colors.muted} style={{ marginBottom: 6 }}>
          This hands {p.code}&apos;s gold back to the customer.
        </ThemedText>
        <ThemedText variant="small" color={colors.red} style={{ marginBottom: 16 }}>
          This can&apos;t be undone.
        </ThemedText>
        {error ? (
          <ThemedText variant="small" color={colors.red} style={{ marginBottom: 10 }}>
            {error}
          </ThemedText>
        ) : null}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <GoldButton title="Cancel" variant="outline" onPress={() => setReleaseConfirmOpen(false)} />
          </View>
          <View style={{ flex: 1 }}>
            <GoldButton
              title="Release"
              onPress={() => move.mutate({ toStatus: RELEASED })}
              loading={move.isPending}
              style={{ backgroundColor: colors.red }}
            />
          </View>
        </View>
      </BottomSheetModal>
    </ScreenContainer>
  );
}
