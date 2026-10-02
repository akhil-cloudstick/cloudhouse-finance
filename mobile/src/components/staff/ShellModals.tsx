import React, { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AsyncSelect,
  Buffering,
  C,
  CenterModal,
  ChipToggle,
  ConfirmSheet,
  DateField,
  Field,
  FilterChipRow,
  GrmTabs,
  Hit,
  Input,
  PIcon,
  PrimaryButton,
  ReminderPill,
  RepayItem,
  ReviewWarning,
  SearchInput,
  ServerFlatList,
  Sheet,
  SheetListItem,
  TopModal,
  Txt,
  Avatar,
  WarningBanner,
  toast,
  openPage,
} from "../ui";
import { useServerList } from "../../hooks/useServerList";
import { latestGoldRate, listGoldRatesPage, publishGoldRate } from "../../api/goldRates";
import { listLoansPage } from "../../api/loans";
import { listCustomers, listCustomersPage } from "../../api/customers";
import { listSchemesPage } from "../../api/schemes";
import { createReminder, listCalendarEventsPage } from "../../api/reminders";
import { useAuth } from "../../auth/AuthContext";
import { useTheme } from "../../theme/ThemeProvider";
import { routeEnabled } from "../../config/tenantModules";
import { FEATURES } from "../../config/features";
import { addDaysISO, dmy, inr, todayISO } from "../../lib/format";
import { finenessForKarat, rateForFineness } from "../../lib/purity";
import type { CalendarEvent } from "../../types/reminder";
import type { Loan } from "../../types/loan";
import type { Customer } from "../../types/customer";
import type { Scheme } from "../../types/scheme";
import type { GoldRate } from "../../types/goldRate";
import { userMessage } from "../../api/errors";

// ---------------------------------------------------------------------------
// Gold Rate (prototype #gold-modal): Set Rate / History
//
// Same rules as the web RateModal and the pre-redesign mobile screen. Mode
// is all-or-nothing across the three karats:
// - Auto (default): 22K/18K derive live off 24K at an editable fineness %
//   (prefilled with karat/24). 24K's own fineness scales the rate that was
//   live when the modal opened.
// - Manual: every karat is typed independently. Typing straight into the
//   22K or 18K rate switches to Manual; typing 24K does not.
// Only karats whose rate actually changed are published, 24 -> 22 -> 18.
//
// Set Rate lets staff set all three karats (Auto derives 22K/18K off 24K;
// Manual types each independently) — only the History tab's list drops the
// 22K/18K columns, showing 24K alone.
// ---------------------------------------------------------------------------
type RateMode = "Auto" | "Manual";
type Karat = 24 | 22 | 18;
const KARAT_ROWS: { k: Karat; label: string }[] = [
  { k: 24, label: "24K · 999" },
  { k: 22, label: "22K · 916" },
  { k: 18, label: "18K · 750" },
];
const defaultFineness = (k: Karat) => (k === 24 ? "100" : String(finenessForKarat(k)));
const clampFineness = (v: string) => (v !== "" && +v > 100 ? "100" : v);

export function GoldRateModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { employee } = useAuth();
  const [tab, setTab] = useState<"set" | "history">("set");
  const latest = useQuery({ queryKey: ["gold-rates", "latest"], queryFn: latestGoldRate, enabled: visible });
  const now: Record<Karat, number> = { 24: latest.data?.k24 ?? 0, 22: latest.data?.k22 ?? 0, 18: latest.data?.k18 ?? 0 };

  const [mode, setMode] = useState<RateMode>("Auto");
  const [ref24, setRef24] = useState(0);
  const [rates, setRates] = useState<Record<Karat, string>>({ 24: "", 22: "", 18: "" });
  const [fin, setFin] = useState<Record<Karat, string>>({ 24: "100", 22: defaultFineness(22), 18: defaultFineness(18) });
  const [lastEdited, setLastEdited] = useState<Karat | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resetAuto = (k24: number) => {
    setMode("Auto");
    setRef24(k24);
    setFin({ 24: "100", 22: defaultFineness(22), 18: defaultFineness(18) });
    setRates({
      24: k24 > 0 ? String(Math.round(k24)) : "",
      22: k24 > 0 ? String(rateForFineness(k24, finenessForKarat(22))) : "",
      18: k24 > 0 ? String(rateForFineness(k24, finenessForKarat(18))) : "",
    });
    setLastEdited(null);
    setError(null);
  };

  useEffect(() => {
    if (!visible) return;
    setTab("set");
    if (latest.data) resetAuto(latest.data.k24 || 0);
  }, [visible, latest.data]);

  const switchMode = (m: RateMode) => {
    if (m === "Auto") resetAuto(ref24 || now[24]);
    else {
      setMode("Manual");
      setLastEdited(null);
    }
  };

  const editRate = (k: Karat, v: string) => {
    setError(null);
    setLastEdited(k);
    if (k !== 24) {
      setMode("Manual");
      setRates((r) => ({ ...r, [k]: v }));
      return;
    }
    const k24 = +v;
    setRates((r) =>
      mode === "Auto" && k24 > 0
        ? {
            24: v,
            22: +fin[22] > 0 ? String(rateForFineness(k24, +fin[22])) : r[22],
            18: +fin[18] > 0 ? String(rateForFineness(k24, +fin[18])) : r[18],
          }
        : { ...r, 24: v }
    );
  };

  const editFineness = (k: Karat, v: string) => {
    const c = clampFineness(v);
    setError(null);
    setFin((f) => ({ ...f, [k]: c }));
    if (!(+c > 0)) return;
    if (k === 24) {
      if (ref24 > 0) {
        const k24 = rateForFineness(ref24, +c);
        setRates((r) => ({
          24: String(k24),
          22: +fin[22] > 0 ? String(rateForFineness(k24, +fin[22])) : r[22],
          18: +fin[18] > 0 ? String(rateForFineness(k24, +fin[18])) : r[18],
        }));
      }
    } else {
      setRates((r) => (+r[24] > 0 ? { ...r, [k]: String(rateForFineness(+r[24], +c)) } : r));
    }
  };

  // Non-blocking sanity check (Manual only): a lower karat priced above a
  // purer one inverts the purity hierarchy. Flagged on the field just typed.
  const n: Record<Karat, number> = { 24: +rates[24], 22: +rates[22], 18: +rates[18] };
  const bad2224 = mode === "Manual" && n[22] > 0 && n[24] > 0 && n[22] > n[24];
  const bad1822 = mode === "Manual" && n[18] > 0 && n[22] > 0 && n[18] > n[22];
  const bad1824 = mode === "Manual" && n[18] > 0 && n[24] > 0 && n[18] > n[24];
  const invalid: Record<Karat, boolean> = {
    24: lastEdited === 24 && (bad2224 || bad1824),
    22: lastEdited === 22 && bad2224,
    18: lastEdited === 18 && (bad1822 || bad1824),
  };
  const hierarchyMsg = bad2224 ? "22K is priced above 24K." : bad1822 ? "18K is priced above 22K." : bad1824 ? "18K is priced above 24K." : null;

  const history = useServerList<GoldRate>({
    key: ["gold-rates", "history"],
    fetchPage: (p) => listGoldRatesPage({ limit: p.limit, offset: p.offset }),
    enabled: visible && tab === "history",
  });

  const save = useMutation({
    mutationFn: async () => {
      const setBy = employee?.name ?? "Mobile App";
      const jobs = KARAT_ROWS.filter(({ k }) => n[k] > 0 && Math.round(n[k]) !== Math.round(now[k])).map(({ k }) => ({ karat: k, rate: n[k] }));
      if (!jobs.length) throw new Error("Nothing has changed from the current rates.");
      for (const j of jobs) await publishGoldRate({ karat: j.karat, rate: j.rate, setBy });
      return jobs;
    },
    onSuccess: (jobs) => {
      qc.invalidateQueries({ queryKey: ["gold-rates"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Gold rate updated", `${jobs.map((j) => `${j.karat}K ${inr(j.rate)}`).join(" · ")} per gram`);
      onClose();
    },
    onError: (e: Error) => setError(userMessage(e, "Could not save the rate — try again.")),
  });

  const canPublish = n[24] > 0 && n[22] > 0 && n[18] > 0;
  // Height the Set Rate tab laid out at — the History tab reuses it.
  const [setTabH, setSetTabH] = useState(0);

  return (
    <CenterModal visible={visible} onClose={onClose} title="Gold Rate">
      <GrmTabs tabs={["set", "history"] as const} value={tab} onChange={setTab} labels={{ set: "Set Rate", history: "History" }} />
      {tab === "set" ? (
        latest.isLoading ? (
          <Buffering block />
        ) : (
          <View style={{ flexShrink: 1 }} onLayout={(e) => setSetTabH(e.nativeEvent.layout.height)}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={{ flexShrink: 1 }}
            contentContainerStyle={{ paddingTop: 14, paddingHorizontal: 16, paddingBottom: 10 }}
          >
            <View style={s.rateNow}>
              {KARAT_ROWS.map(({ k }) => (
                <View key={k} style={{ flex: 1, alignItems: "center" }}>
                  <Txt style={s.rateNowK}>{k}K now</Txt>
                  <Txt style={s.rateNowV}>{now[k] ? inr(Math.round(now[k])) : "—"}</Txt>
                </View>
              ))}
            </View>
            <Field label="Mode">
              <ChipToggle options={["Auto", "Manual"] as const} value={mode} onChange={switchMode} />
            </Field>
            <Txt style={s.modeHint}>
              {mode === "Auto" ? "22K and 18K follow 24K at their fineness %. Typing a 22K/18K rate switches to Manual." : "Each karat is set independently of 24K."}
            </Txt>
            {KARAT_ROWS.map(({ k, label }) => (
              <View key={k} style={[s.karatRow, invalid[k] && { borderColor: C.red }]}>
                <Txt style={s.karatLbl}>{label}</Txt>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  {mode === "Auto" ? (
                    <Field label="Fineness %" style={{ flex: 1, marginBottom: 0 }}>
                      <Input keyboardType="decimal-pad" value={fin[k]} onChangeText={(v) => editFineness(k, v)} />
                    </Field>
                  ) : null}
                  <Field label="Rate (₹/g)" style={{ flex: 1.3, marginBottom: 0 }}>
                    <Input keyboardType="decimal-pad" value={rates[k]} onChangeText={(v) => editRate(k, v)} style={invalid[k] ? { borderColor: C.red } : undefined} />
                  </Field>
                </View>
              </View>
            ))}
            {hierarchyMsg ? <ReviewWarning>{`Price hierarchy looks wrong: ${hierarchyMsg} You can still save if this is intended.`}</ReviewWarning> : null}
            {error ? <WarningBanner>{error}</WarningBanner> : null}
          </ScrollView>
          {/* Sticky footer — the fields scroll, the button stays put. */}
          <View style={s.modalFooter}>
            <PrimaryButton label="Save New Rate" onPress={() => save.mutate()} loading={save.isPending} disabled={!canPublish} />
          </View>
          </View>
        )
      ) : (
        // Same height as the Set Rate tab, so switching tabs never resizes
        // the pop-up (both stay within the card's 76% screen cap).
        <View style={setTabH ? { height: setTabH } : { maxHeight: 420 }}>
          <ServerFlatList
            list={history}
            items={history.items}
            inSheet
            gutter={16}
            emptyText="No rate history yet."
            keyOf={(r) => String(r.id)}
            renderItem={(r, i) => (
              <RepayItem
                first={i === 0}
                label={`${dmy(r.date || r.createdAt)}${r.setBy ? ` · ${r.setBy}` : ""}`}
                value={`24K ${inr(r.k24)}`}
                valueColor={C.ink}
                style={s.histRow}
              />
            )}
          />
        </View>
      )}
    </CenterModal>
  );
}

// ---------------------------------------------------------------------------
// Global search (prototype #search-modal) — slides down from the top.
// ---------------------------------------------------------------------------
type SearchScope = "All" | "Customers" | "Loan No." | "Scheme";

export function SearchModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [scope, setScope] = useState<SearchScope>("All");
  // Nothing heavy happens while the panel slides in: the result lists
  // mount (and start fetching) and the keyboard rises only once it has
  // finished — doing either mid-slide is what made the opening stutter.
  const searchInput = useRef<TextInput>(null);
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    if (!visible) setOpened(false);
  }, [visible]);
  const onOpened = () => {
    setOpened(true);
    searchInput.current?.focus();
  };
  const loanList = useServerList<Loan>({
    key: ["search", "loans"],
    fetchPage: (p) => listLoansPage(p),
    enabled: opened && (scope === "All" || scope === "Loan No."),
  });
  const custList = useServerList<Customer>({
    key: ["search", "customers"],
    fetchPage: (p) => listCustomersPage(p),
    enabled: opened && scope === "Customers",
  });
  const schemeList = useServerList<Scheme>({
    key: ["search", "schemes"],
    fetchPage: (p) => listSchemesPage(p),
    enabled: opened && scope === "Scheme",
  });
  const [text, setText] = useState("");
  useEffect(() => {
    loanList.setSearch(text);
    custList.setSearch(text);
    schemeList.setSearch(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  useEffect(() => {
    if (!visible) setText("");
  }, [visible]);

  const go = (path: string) => {
    onClose();
    openPage(path);
  };

  const body =
    scope === "Customers" ? (
      <ServerFlatList
        list={custList}
        items={custList.items}
        inSheet
        gutter={16}
        emptyText="No customers match your search."
        keyOf={(c) => `c${c.id}`}
        renderItem={(c) => <Hit name={c.name} meta={`${c.code ?? ""} · ${c.phone ?? ""}`} tag="Customer" onPress={() => go(`/customers/${c.id}`)} />}
      />
    ) : scope === "Scheme" ? (
      <ServerFlatList
        list={schemeList}
        items={schemeList.items}
        inSheet
        gutter={16}
        emptyText="No schemes match your search."
        keyOf={(sc) => `s${sc.id}`}
        renderItem={(sc) => (
          <Hit name={sc.name} meta={`${sc.interestRate}% p.a. · LTV ${sc.ltvPercent}%`} tag="Scheme" onPress={() => go(`/loans?schemeId=${sc.id}`)} />
        )}
      />
    ) : (
      <ServerFlatList
        list={loanList}
        items={loanList.items}
        inSheet
        gutter={16}
        emptyText="No loans match your search."
        keyOf={(l) => `l${l.id}`}
        renderItem={(l) => (
          <Hit
            name={l.customer?.name ?? `Customer #${l.customerId}`}
            meta={`${l.loanNumber}${l.customer?.code ? ` · ${l.customer.code}` : ""}`}
            tag={l.scheme?.name}
            onPress={() => go(`/loans/${l.id}`)}
          />
        )}
      />
    );

  return (
    <TopModal visible={visible} onClose={onClose} onOpened={onOpened}>
      <View style={s.searchHead}>
        <View style={s.searchBox}>
          <TextInput
            ref={searchInput}
            value={text}
            onChangeText={setText}
            placeholder="Search customer, LN number, ID, scheme"
            placeholderTextColor={C.muted}
            autoCorrect={false}
            autoCapitalize="none"
            allowFontScaling={false}
            style={s.searchInput}
          />
          <View style={s.searchIc} pointerEvents="none">
            <PIcon name="search" color={C.muted} />
          </View>
        </View>
        <Pressable onPress={onClose} hitSlop={10}>
          <Txt style={s.cancel}>Cancel</Txt>
        </Pressable>
      </View>
      <View style={{ paddingTop: 12, paddingHorizontal: 16, paddingBottom: 4 }}>
        <FilterChipRow options={["All", "Customers", "Loan No.", "Scheme"] as const} value={scope} onChange={setScope} style={{ marginBottom: 0 }} />
      </View>
      {/* Fixed-height placeholder while sliding, so the panel doesn't
          change size (or render the lists) mid-animation. */}
      <View style={{ maxHeight: 460, paddingTop: 6 }}>{opened ? body : <View style={{ height: 300 }} />}</View>
    </TopModal>
  );
}

// ---------------------------------------------------------------------------
// Reminders modal (dashboard bell) — not in the prototype; built from its
// own pieces (.reminder-item + pills inside a rise-up sheet).
// ---------------------------------------------------------------------------
type RemScope = "Today" | "Upcoming" | "Overdue";

export function reminderKind(t: CalendarEvent["type"]): "overdue" | "due" | "ptp" {
  if (t === "Overdue") return "overdue";
  if (t === "PromiseToPay" || t === "FollowUp" || t === "Custom") return "ptp";
  return "due";
}
export function reminderLabel(t: CalendarEvent["type"]) {
  switch (t) {
    case "Overdue":
      return "Overdue";
    case "LoanDue":
      return "Loan due";
    case "InterestDue":
      return "Interest due";
    case "PromiseToPay":
      return "Promise to pay";
    case "FollowUp":
      return "Follow-up";
    default:
      return "Custom";
  }
}

export function ReminderItem({ ev, first, showDate, onPress }: { ev: CalendarEvent; first?: boolean; showDate?: boolean; onPress?: () => void }) {
  const who = [ev.customerName, ev.loanNumber].filter(Boolean).join(" — ") || ev.title;
  return (
    <Pressable disabled={!onPress} onPress={onPress} style={[s.remItem, !first && s.remBorder]}>
      <ReminderPill label={reminderLabel(ev.type)} kind={reminderKind(ev.type)} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt style={s.remTitle} numberOfLines={1}>
          {who}
        </Txt>
        <Txt style={s.remSub} numberOfLines={2}>
          {showDate ? `${dmy(ev.date)} · ` : ""}
          {ev.detail || ev.title}
        </Txt>
      </View>
    </Pressable>
  );
}

function rangeFor(scope: RemScope): { from: string; to: string } {
  const t = todayISO();
  if (scope === "Today") return { from: t, to: t };
  if (scope === "Upcoming") return { from: addDaysISO(t, 1), to: addDaysISO(t, 30) };
  return { from: addDaysISO(t, -90), to: addDaysISO(t, -1) };
}

export function RemindersModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [scope, setScope] = useState<RemScope>("Today");
  const [adding, setAdding] = useState(false);
  const range = rangeFor(scope);
  const list = useServerList<CalendarEvent, { from: string; to: string }>({
    key: ["reminders", "modal"],
    filters: range,
    fetchPage: (p) => listCalendarEventsPage(p),
    enabled: visible,
  });
  return (
    <>
      <Sheet
        visible={visible && !adding}
        onClose={onClose}
        title="Reminders"
        maxHeightPct={85}
        scroll={false}
        headExtra={
          <View style={{ paddingTop: 12 }}>
            <View style={{ paddingHorizontal: 16 }}>
              <FilterChipRow options={["Today", "Upcoming", "Overdue"] as const} value={scope} onChange={setScope} />
            </View>
            <SearchInput value={list.search} onChangeText={list.setSearch} placeholder="Search by customer name, ID, or loan number" style={{ paddingHorizontal: 16 }} />
          </View>
        }
      >
        <ServerFlatList
          list={list}
          items={list.items}
          inSheet
          gutter={16}
          emptyText={scope === "Today" ? "No reminders for today." : scope === "Upcoming" ? "No upcoming reminders." : "No overdue reminders."}
          keyOf={(e, i) => `${e.date}-${e.type}-${e.reminderId ?? e.loanId ?? i}`}
          renderItem={(e, i) => (
            <ReminderItem
              ev={e}
              first={i === 0}
              showDate={scope !== "Today"}
              onPress={
                e.loanId
                  ? () => {
                      onClose();
                      openPage(`/loans/${e.loanId}`);
                    }
                  : undefined
              }
            />
          )}
          header={null}
        />
        <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}>
          <PrimaryButton label="Add Reminder" onPress={() => setAdding(true)} />
        </View>
      </Sheet>
      <ReminderCreateSheet visible={visible && adding} onClose={() => setAdding(false)} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Add Reminder (prototype #reminder-create-modal)
// ---------------------------------------------------------------------------
type RType = "Follow-Up" | "Promise-to-Pay" | "Custom";

export function ReminderCreateSheet({ visible, onClose, defaultDate }: { visible: boolean; onClose: () => void; defaultDate?: string }) {
  const qc = useQueryClient();
  const { employee } = useAuth();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loan, setLoan] = useState<Loan | null>(null);
  const [type, setType] = useState<RType>("Follow-Up");
  const [due, setDue] = useState(defaultDate ?? todayISO());
  const [note, setNote] = useState("");

  useEffect(() => {
    if (visible) {
      setCustomer(null);
      setLoan(null);
      setType("Follow-Up");
      setDue(defaultDate ?? todayISO());
      setNote("");
    }
  }, [visible, defaultDate]);

  const create = useMutation({
    mutationFn: () => {
      if (!customer) throw new Error("Pick a customer.");
      if (!employee) throw new Error("Not signed in.");
      return createReminder({ customerId: customer.id, loanId: loan?.id ?? null, type, dueDate: due, note: note.trim() || undefined, employeeId: employee.id });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reminders"] });
      toast.success("Reminder added");
      onClose();
    },
    onError: (e: Error) => toast.error("Couldn't add reminder", userMessage(e, "Please try again.")),
  });

  return (
    <Sheet visible={visible} onClose={onClose} title="Add Reminder" maxHeightPct={85}>
      <AsyncSelect<Customer>
        label="Customer"
        placeholder="Search customer"
        queryKey={["customers", "picker"]}
        fetcher={(q) => listCustomers(q || undefined)}
        selectedLabel={customer ? `${customer.name} · ${customer.code ?? ""}` : undefined}
        onClear={() => {
          setCustomer(null);
          setLoan(null);
        }}
        onSelect={(c) => {
          setCustomer(c);
          setLoan(null);
        }}
        keyOf={(c) => c.id}
        renderItem={(c) => ({ title: c.name, sub: [c.code, c.phone].filter(Boolean).join(" · ") })}
      />
      <Field label="Type">
        <ChipToggle options={["Follow-Up", "Promise-to-Pay", "Custom"] as const} value={type} onChange={setType} wrap />
      </Field>
      <DateField label="Due date" value={due} onChange={setDue} />
      {customer ? (
        <AsyncSelect<Loan>
          label="Loan number (optional)"
          placeholder="e.g. LN-2481"
          queryKey={["loans", "picker", customer.id]}
          fetcher={async (q) => (await listLoansPage({ customerId: customer.id, q: q || undefined, limit: 20, offset: 0 })).items ?? []}
          selectedLabel={loan?.loanNumber}
          onClear={() => setLoan(null)}
          onSelect={setLoan}
          keyOf={(l) => l.id}
          renderItem={(l) => ({ title: l.loanNumber, sub: l.status })}
        />
      ) : null}
      <Field label="Note">
        <Input placeholder="Add a note" value={note} onChangeText={setNote} />
      </Field>
      <PrimaryButton label="Add Reminder" onPress={() => create.mutate()} loading={create.isPending} />
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Profile (tap on the dashboard avatar) — sign out lives here.
// ---------------------------------------------------------------------------
export function ProfileSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { employee, signOut, exitBusiness } = useAuth();
  const { businessName } = useTheme();
  // Unlike Sign out (which keeps the business, so the next sign-in goes
  // straight to its login page), this also forgets the business and sends
  // the app back to the "enter a business" screen (app/(auth)/connect.tsx).
  // Confirmed in the app's own sheet, not a native Alert.
  const [confirmExit, setConfirmExit] = useState(false);
  return (
    <>
      <Sheet visible={visible} onClose={onClose} title="Profile" maxHeightPct={50}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 }}>
          <Avatar name={employee?.name} size={44} radius={13} fontSize={15} />
          <View style={{ flex: 1 }}>
            <Txt style={{ fontWeight: "700", fontSize: 15 }}>{employee?.name}</Txt>
            <Txt style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
              {[employee?.role, (employee as { branch?: { name: string } } | null)?.branch?.name, businessName].filter(Boolean).join(" · ")}
            </Txt>
          </View>
        </View>
        <SheetListItem
          icon="logout"
          title="Sign out"
          sub="End this session on this device"
          warn
          onPress={() => {
            onClose();
            signOut();
          }}
        />
        <SheetListItem icon="home" title="Exit business" sub={`Disconnect ${businessName} from this device`} warn onPress={() => setConfirmExit(true)} />
      </Sheet>
      <ConfirmSheet
        visible={visible && confirmExit}
        onClose={() => setConfirmExit(false)}
        title="Exit business?"
        message={`You'll be signed out and need to scan ${businessName}'s QR code (or enter its business code) again to sign in.`}
        confirmLabel="Exit business"
        danger
        onConfirm={() => {
          setConfirmExit(false);
          onClose();
          exitBusiness();
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// More (prototype #more-modal) + the modules the prototype doesn't list.
// ---------------------------------------------------------------------------
type MoreRow = { key: string; route?: string; title: string; sub: string; icon: string; perms: [string, string][]; action?: "gold" };

const MORE_ROWS: MoreRow[] = [
  { key: "auctions", route: "auctions", title: "Auctions", sub: "Active cases & auction history", icon: "gavel", perms: [["Loan_Management", "can_view_loan"]] },
  { key: "packets", route: "packets", title: "Packets & Lockers", sub: "Ornament custody tracking", icon: "doc", perms: [["Packet_Management", "can_view_packet"], ["Locker_Management", "can_view_locker"]] },
  { key: "banks", route: "banks", title: "Bank Pledges", sub: "Loans pledged to a bank", icon: "card", perms: [["Bank_Pledge_Management", "can_view_bank_pledge"]] },
  { key: "requests", route: "requests", title: "Releases", sub: "Loan extensions & gold release", icon: "edit", perms: [["Loan_Management", "can_view_loan"]] },
  { key: "cash", route: "cash", title: "Ledger", sub: "Movements, expenses & gold sales", icon: "coin", perms: [["Cash_Management", "can_view_cash"]] },
  { key: "personal-loans", route: "personal-loans", title: "Personal Loans", sub: "Non-gold loans & collections", icon: "card", perms: [["Personal_Loan_Management", "can_view_personal_loan"]] },
  { key: "investments", route: "investments", title: "Investments", sub: "Deposits, plans & payouts", icon: "coin", perms: [["Investment_Management", "can_view_investment"]] },
  { key: "reminders", route: "reminders", title: "Reminders", sub: "Follow-ups & promise-to-pay", icon: "calendar", perms: [["Reminder_Management", "can_view_reminder"]] },
  { key: "reports", route: "reports", title: "Reports", sub: "Branch reports & summaries", icon: "note", perms: [["Report_Management", "can_view_report"]] },
  { key: "loan-risk", route: "loan-risk", title: "Loan Risk", sub: "Risk assessment across active loans", icon: "chart", perms: [["Loan_Management", "can_view_loan"]] },
  { key: "gold-rates", title: "Gold Rates", sub: "Set today's rate & view history", icon: "coin", perms: [["Gold_Rate_Management", "can_view_gold_rate"]], action: "gold" },
  { key: "employees", route: "employees", title: "Employees", sub: "Staff accounts & roles", icon: "user", perms: [["Employee_Management", "can_view_employee"]] },
  { key: "branches", route: "branches", title: "Branches", sub: "Branch details & lockers", icon: "home", perms: [["Branch_Management", "can_view_branch"]] },
  { key: "roles", route: "roles", title: "Roles & Permissions", sub: "What each role can do", icon: "shield", perms: [["Role_Management", "can_view_role_and_permission"]] },
  // Shown only with EXPO_PUBLIC_ENABLE_PLAN_UPGRADE on (filtered in MoreSheet).
  { key: "billing", route: "billing", title: "Billing & Plan", sub: "Your plan, branch limit & upgrades", icon: "card", perms: [["Billing", "can_manage_billing"]] },
  { key: "settings", route: "settings", title: "Settings", sub: "Branch, staff, and app settings", icon: "dots", perms: [["Settings_Management", "can_view_setting"]] },
];

export function MoreSheet({ visible, onClose, onGoldRate }: { visible: boolean; onClose: () => void; onGoldRate: () => void }) {
  const { can } = useAuth();
  const { hasModule } = useTheme();
  const rows = MORE_ROWS.filter(
    (r) => r.perms.some(([m, k]) => can(m, k)) && (!r.route || routeEnabled(r.route, hasModule)) && (r.key !== "billing" || FEATURES.planUpgrade)
  );
  return (
    <Sheet visible={visible} onClose={onClose} title="More" maxHeightPct={80}>
      {rows.map((r, i) => (
        <SheetListItem
          key={r.key}
          first={i === 0}
          icon={r.icon}
          title={r.title}
          sub={r.sub}
          onPress={() => {
            onClose();
            if (r.action === "gold") onGoldRate();
            else openPage(`/${r.route}`);
          }}
        />
      ))}
    </Sheet>
  );
}

const s = StyleSheet.create({
  rateNow: { flexDirection: "row", backgroundColor: C.brandFaint, borderRadius: 12, paddingVertical: 10, marginBottom: 14 },
  rateNowK: { fontSize: 10, fontWeight: "700", color: C.muted, textTransform: "uppercase", letterSpacing: 0.4 },
  rateNowV: { fontSize: 14, fontWeight: "800", marginTop: 2 },
  histRow: { paddingVertical: 16 },
  modeHint: { fontSize: 11, color: C.muted, marginTop: -4, marginBottom: 12, lineHeight: 15 },
  modalFooter: { paddingTop: 10, paddingHorizontal: 16, paddingBottom: 14, borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.card },
  karatRow: { borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 12, marginBottom: 10 },
  karatLbl: { fontSize: 12.5, fontWeight: "700", color: C.brandDeep, marginBottom: 8 },
  searchHead: { flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 16, paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: C.line },
  searchBox: { flex: 1, justifyContent: "center" },
  searchInput: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 11, paddingVertical: 11, paddingLeft: 13, paddingRight: 42, fontSize: 14, color: C.ink },
  searchIc: { position: "absolute", right: 12 },
  cancel: { fontSize: 13, fontWeight: "700", color: C.brandDeep },
  remItem: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 },
  remBorder: { borderTopWidth: 1, borderTopColor: C.line },
  remTitle: { fontWeight: "700", fontSize: 12.5 },
  remSub: { fontSize: 11, color: C.muted },
});
