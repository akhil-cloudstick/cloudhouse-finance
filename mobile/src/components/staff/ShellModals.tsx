import React, { useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, TextInput, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import {
  AsyncSelect,
  Buffering,
  C,
  CenterModal,
  ChipToggle,
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
  SearchInput,
  ServerFlatList,
  Sheet,
  SheetListItem,
  TopModal,
  Txt,
  Avatar,
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
import { addDaysISO, dmy, inr, todayISO } from "../../lib/format";
import type { CalendarEvent } from "../../types/reminder";
import type { Loan } from "../../types/loan";
import type { Customer } from "../../types/customer";
import type { Scheme } from "../../types/scheme";
import type { GoldRate } from "../../types/goldRate";

// ---------------------------------------------------------------------------
// Gold Rate (prototype #gold-modal): Set Rate / History
// ---------------------------------------------------------------------------
export function GoldRateModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { employee } = useAuth();
  const [tab, setTab] = useState<"set" | "history">("set");
  const latest = useQuery({ queryKey: ["gold-rates", "latest"], queryFn: latestGoldRate, enabled: visible });
  const [r22, setR22] = useState("");
  const [r24, setR24] = useState("");

  useEffect(() => {
    if (visible && latest.data) {
      setR22(String(Math.round(latest.data.k22 || 0)));
      setR24(String(Math.round(latest.data.k24 || 0)));
    }
  }, [visible, latest.data]);

  const history = useServerList<GoldRate>({
    key: ["gold-rates", "history"],
    fetchPage: (p) => listGoldRatesPage({ limit: p.limit, offset: p.offset }),
    enabled: visible && tab === "history",
  });

  const save = useMutation({
    mutationFn: async () => {
      const setBy = employee?.name ?? "Mobile App";
      const jobs: { karat: 24 | 22; rate: number }[] = [];
      if (+r24 > 0 && Math.round(+r24) !== Math.round(latest.data?.k24 ?? 0)) jobs.push({ karat: 24, rate: +r24 });
      if (+r22 > 0 && Math.round(+r22) !== Math.round(latest.data?.k22 ?? 0)) jobs.push({ karat: 22, rate: +r22 });
      if (!jobs.length) throw new Error("Change a rate before saving.");
      for (const j of jobs) await publishGoldRate({ karat: j.karat, rate: j.rate, setBy });
      return jobs;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gold-rates"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      Alert.alert("Gold rate", "New rate saved.");
      onClose();
    },
    onError: (e: Error) => Alert.alert("Couldn't save rate", e.message),
  });

  return (
    <CenterModal visible={visible} onClose={onClose} title="Gold Rate">
      <GrmTabs tabs={["set", "history"] as const} value={tab} onChange={setTab} labels={{ set: "Set Rate", history: "History" }} />
      {tab === "set" ? (
        <View style={{ paddingTop: 6, paddingHorizontal: 16, paddingBottom: 18 }}>
          {latest.isLoading ? (
            <Buffering block />
          ) : (
            <>
              <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
                <Field label="22 Karat rate (₹/g)" style={{ flex: 1 }}>
                  <Input keyboardType="decimal-pad" value={r22} onChangeText={setR22} />
                </Field>
                <Field label="24 Karat rate (₹/g)" style={{ flex: 1 }}>
                  <Input keyboardType="decimal-pad" value={r24} onChangeText={setR24} />
                </Field>
              </View>
              <PrimaryButton label="Save New Rate" onPress={() => save.mutate()} loading={save.isPending} />
            </>
          )}
        </View>
      ) : (
        <View style={{ maxHeight: 420 }}>
          <ServerFlatList
            list={history}
            items={history.items}
            inSheet
            gutter={16}
            emptyText="No rate history yet."
            keyOf={(r) => String(r.id)}
            renderItem={(r, i) => (
              <RepayItem first={i === 0} label={`${dmy(r.date || r.createdAt)} · 24K ${inr(r.k24)}`} value={inr(r.k22)} valueColor={C.ink} />
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
  const router = useRouter();
  const [scope, setScope] = useState<SearchScope>("All");
  const loanList = useServerList<Loan>({
    key: ["search", "loans"],
    fetchPage: (p) => listLoansPage(p),
    enabled: visible && (scope === "All" || scope === "Loan No."),
  });
  const custList = useServerList<Customer>({
    key: ["search", "customers"],
    fetchPage: (p) => listCustomersPage(p),
    enabled: visible && scope === "Customers",
  });
  const schemeList = useServerList<Scheme>({
    key: ["search", "schemes"],
    fetchPage: (p) => listSchemesPage(p),
    enabled: visible && scope === "Scheme",
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
    router.push(path as never);
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
    <TopModal visible={visible} onClose={onClose}>
      <View style={s.searchHead}>
        <PIcon name="search" color={C.muted} />
        <TextInput
          autoFocus
          value={text}
          onChangeText={setText}
          placeholder="Search customer, LN number, ID, scheme"
          placeholderTextColor={C.muted}
          autoCorrect={false}
          autoCapitalize="none"
          allowFontScaling={false}
          style={s.searchInput}
        />
        <Pressable onPress={onClose} hitSlop={10}>
          <Txt style={s.cancel}>Cancel</Txt>
        </Pressable>
      </View>
      <View style={{ paddingTop: 12, paddingHorizontal: 16, paddingBottom: 4 }}>
        <FilterChipRow options={["All", "Customers", "Loan No.", "Scheme"] as const} value={scope} onChange={setScope} style={{ marginBottom: 0 }} />
      </View>
      <View style={{ maxHeight: 460, paddingTop: 6 }}>{body}</View>
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
  const router = useRouter();
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
                      router.push(`/loans/${e.loanId}` as never);
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
      Alert.alert("Reminder", "Reminder added.");
      onClose();
    },
    onError: (e: Error) => Alert.alert("Couldn't add reminder", e.message),
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
  const { employee, signOut } = useAuth();
  const { businessName } = useTheme();
  return (
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
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// More (prototype #more-modal) + the modules the prototype doesn't list.
// ---------------------------------------------------------------------------
type MoreRow = { key: string; route?: string; title: string; sub: string; icon: string; perms: [string, string][]; action?: "gold" };

const MORE_ROWS: MoreRow[] = [
  { key: "auctions", route: "auctions", title: "Auctions", sub: "Active cases & auction history", icon: "alert", perms: [["Loan_Management", "can_view_loan"]] },
  { key: "packets", route: "packets", title: "Packets & Lockers", sub: "Ornament custody tracking", icon: "doc", perms: [["Packet_Management", "can_view_packet"], ["Locker_Management", "can_view_locker"]] },
  { key: "banks", route: "banks", title: "Bank Pledges", sub: "Loans pledged to a bank", icon: "card", perms: [["Bank_Pledge_Management", "can_view_bank_pledge"]] },
  { key: "requests", route: "requests", title: "Releases", sub: "Loan extensions & gold release", icon: "edit", perms: [["Loan_Management", "can_view_loan"]] },
  { key: "cash", route: "cash", title: "Cash & Expenses", sub: "Movements, expenses & gold sales", icon: "coin", perms: [["Cash_Management", "can_view_cash"]] },
  { key: "personal-loans", route: "personal-loans", title: "Personal Loans", sub: "Non-gold loans & collections", icon: "card", perms: [["Personal_Loan_Management", "can_view_personal_loan"]] },
  { key: "investments", route: "investments", title: "Investments", sub: "Deposits, plans & payouts", icon: "coin", perms: [["Investment_Management", "can_view_investment"]] },
  { key: "reminders", route: "reminders", title: "Reminders", sub: "Follow-ups & promise-to-pay", icon: "calendar", perms: [["Reminder_Management", "can_view_reminder"]] },
  { key: "reports", route: "reports", title: "Reports", sub: "Branch reports & summaries", icon: "note", perms: [["Report_Management", "can_view_report"]] },
  { key: "loan-risk", route: "loan-risk", title: "Loan Risk", sub: "Risk assessment across active loans", icon: "alert", perms: [["Loan_Management", "can_view_loan"]] },
  { key: "gold-rates", title: "Gold Rates", sub: "Set today's rate & view history", icon: "coin", perms: [["Gold_Rate_Management", "can_view_gold_rate"]], action: "gold" },
  { key: "employees", route: "employees", title: "Employees", sub: "Staff accounts & roles", icon: "user", perms: [["Employee_Management", "can_view_employee"]] },
  { key: "branches", route: "branches", title: "Branches", sub: "Branch details & lockers", icon: "home", perms: [["Branch_Management", "can_view_branch"]] },
  { key: "roles", route: "roles", title: "Roles & Permissions", sub: "What each role can do", icon: "shield", perms: [["Role_Management", "can_view_role_and_permission"]] },
  { key: "settings", route: "settings", title: "Settings", sub: "Branch, staff, and app settings", icon: "dots", perms: [["Settings_Management", "can_view_setting"]] },
];

export function MoreSheet({ visible, onClose, onGoldRate }: { visible: boolean; onClose: () => void; onGoldRate: () => void }) {
  const router = useRouter();
  const { can } = useAuth();
  const { hasModule } = useTheme();
  const rows = MORE_ROWS.filter((r) => r.perms.some(([m, k]) => can(m, k)) && (!r.route || routeEnabled(r.route, hasModule)));
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
            else router.push(`/${r.route}` as never);
          }}
        />
      ))}
    </Sheet>
  );
}

const s = StyleSheet.create({
  searchHead: { flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 16, paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: C.line },
  searchInput: { flex: 1, backgroundColor: C.brandFaint, borderRadius: 11, paddingVertical: 11, paddingHorizontal: 13, fontSize: 14, color: C.ink },
  cancel: { fontSize: 13, fontWeight: "700", color: C.brandDeep },
  remItem: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 },
  remBorder: { borderTopWidth: 1, borderTopColor: C.line },
  remTitle: { fontWeight: "700", fontSize: 12.5 },
  remSub: { fontSize: 11, color: C.muted },
});
