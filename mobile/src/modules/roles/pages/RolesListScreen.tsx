import React, { useEffect, useRef, useState } from "react";
import { LayoutAnimation, Pressable, ScrollView, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { useRouter } from "expo-router";
import {
  Buffering,
  C,
  Card,
  FlatHeader,
  PIcon,
  PrimaryButton,
  Screen,
  SearchInput,
  ServerFlatList,
  StatusChip,
  Txt,
  toast,
} from "@/common/components/ui";
import { useAuth } from "@/common/providers/AuthProvider";
import { NoAccess } from "@/common/components/NoAccess";
import { useServerList } from "@/common/hooks/use-server-list";
import { userMessage } from "@/common/services/apiErrors";
import { fetchRoleEmployees, fetchRolesPage } from "@/modules/roles/services/roleService";
import { type RoleEmployeeRow, type RoleListRow } from "@/modules/roles/types/role-types";

const ROLES_PAGE_SIZE = 12;
const EMPLOYEES_PAGE_SIZE = 10;
// The employees box shows at most three rows; the rest scroll inside it.
const EMPLOYEE_ROW_H = 52;
const EMPLOYEES_MAX_H = EMPLOYEE_ROW_H * 3;
// Bumped on every "Open Permissions" so the permissions screen re-applies the role even when it is the same one.
let openSeq = 0;

// Roles — mobile equivalent of web's Roles modal (opened from the Roles & Permissions corner button): every role in
// one scrolling list that loads 5 more at a time as it is scrolled; tapping a role drops down the employees who hold
// it, the same way an investor opens to their investments.
export default function RolesListScreen() {
  const router = useRouter();
  const canView = useAuth().can("Role_Management", "can_view_role_and_permission_module");
  const [openId, setOpenId] = useState<number | null>(null);
  const list = useServerList<RoleListRow>({
    key: ["roles", "list"],
    pageSize: ROLES_PAGE_SIZE,
    enabled: canView,
    fetchPage: (p) => fetchRolesPage(Math.floor(p.offset / p.limit) + 1, p.limit, p.q || undefined),
  });

  const header = <FlatHeader back title="Roles" subtitle="Every role & who holds it" />;
  if (!canView) return <NoAccess header={header} />;

  function openPermissions(r: RoleListRow) {
    router.navigate({ pathname: "/roles", params: { role: r.name, t: String(++openSeq) } } as never);
  }

  return (
    <Screen header={header}>
      <ServerFlatList
        stickyHeader
        list={list}
        items={list.items}
        keyOf={(r) => String(r.id)}
        emptyText={list.search ? "No roles match your search." : "No roles yet."}
        header={
          <View style={{ paddingTop: 12 }}>
            <SearchInput value={list.search} onChangeText={(v) => { setOpenId(null); list.setSearch(v); }} placeholder="Search roles" style={{ paddingBottom: 8 }} />
          </View>
        }
        renderItem={(r) => (
          <RoleItem
            role={r}
            open={openId === r.id}
            onToggle={() => {
              LayoutAnimation.configureNext(LayoutAnimation.create(220, "easeInEaseOut", "opacity"));
              setOpenId((cur) => (cur === r.id ? null : r.id));
            }}
            onOpenPermissions={() => openPermissions(r)}
          />
        )}
      />
    </Screen>
  );
}

type RoleItemProps = { role: RoleListRow; open: boolean; onToggle: () => void; onOpenPermissions: () => void };

/** One role row; while open, the employees who hold it drop down underneath (like an investor's investments). */
function RoleItem({ role: r, open, onToggle, onOpenPermissions }: RoleItemProps) {
  const sub = [r.isSystem ? "System role · read-only" : r.description, `${r.employee_count} employee${r.employee_count === 1 ? "" : "s"}`]
    .filter(Boolean)
    .join(" · ");
  return (
    <Card style={{ paddingVertical: 0, marginBottom: 10, overflow: "hidden" }}>
      <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: open }} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12 }}>
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.brandPale, alignItems: "center", justifyContent: "center" }}>
          <PIcon name="shield" color={C.brandDeep} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt numberOfLines={1} style={{ fontWeight: "700", fontSize: 14.5 }}>{r.name}</Txt>
          <Txt numberOfLines={1} style={{ color: C.muted, fontSize: 12.5 }}>{sub}</Txt>
        </View>
        <StatusChip label={r.isSystem ? "Read-only" : r.isActive ? "Active" : "Inactive"} tone={r.isSystem ? "info" : r.isActive ? "active" : "closed"} />
        <View style={{ transform: [{ rotate: open ? "180deg" : "0deg" }] }}>
          <PIcon name="chevdown" color={C.muted} />
        </View>
      </Pressable>
      {open ? (
        <View style={{ backgroundColor: C.brandFaint, borderTopWidth: 1, borderTopColor: C.line, paddingBottom: 12 }}>
          <RoleEmployeesBox roleId={r.id} />
          <View style={{ paddingHorizontal: 14 }}>
            <PrimaryButton label="Open Permissions" variant="outline" onPress={onOpenPermissions} />
          </View>
        </View>
      ) : null}
    </Card>
  );
}

/** The employees holding one role, three rows tall; the next page loads as the box is scrolled to its end. */
function RoleEmployeesBox({ roleId }: { roleId: number }) {
  const [rows, setRows] = useState<RoleEmployeeRow[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  // True from mount (the first page loads straight away) and again whenever the next page is asked for.
  const [loading, setLoading] = useState(true);
  const loadingRef = useRef(true);

  useEffect(() => {
    let stale = false;
    fetchRoleEmployees(roleId, page, EMPLOYEES_PAGE_SIZE)
      .then((res) => {
        if (stale) return;
        setRows((prev) => (page === 1 ? res.items : [...prev, ...res.items]));
        setHasMore(res.hasMore);
      })
      .catch((e) => { if (!stale) toast.error(userMessage(e, "Could not load employees — try again.")); })
      .finally(() => {
        if (stale) return;
        loadingRef.current = false;
        setLoading(false);
      });
    return () => { stale = true; };
  }, [roleId, page]);

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
    if (loadingRef.current || !hasMore) return;
    if (contentOffset.y + layoutMeasurement.height >= contentSize.height - EMPLOYEE_ROW_H) {
      loadingRef.current = true;
      setLoading(true);
      setPage((p) => p + 1);
    }
  }

  return (
    <View style={{ marginHorizontal: 14, marginVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.card, overflow: "hidden" }}>
      <ScrollView style={{ maxHeight: EMPLOYEES_MAX_H }} nestedScrollEnabled onScroll={onScroll} scrollEventThrottle={100}>
        {rows.length === 0 && loading ? <Buffering /> : null}
        {rows.length === 0 && !loading ? (
          <View style={{ height: EMPLOYEE_ROW_H, justifyContent: "center", paddingHorizontal: 14 }}>
            <Txt style={{ color: C.muted, fontSize: 13 }}>No employees in this role</Txt>
          </View>
        ) : null}
        {rows.map((e, i) => (
          <View
            key={e.id}
            style={{ height: EMPLOYEE_ROW_H, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: C.line }}
          >
            <PIcon name="user" color={C.brandDeep} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt numberOfLines={1} style={{ fontWeight: "600", fontSize: 13.5 }}>{e.name}</Txt>
              <Txt numberOfLines={1} style={{ color: C.muted, fontSize: 12 }}>{[e.code, e.branchName].filter(Boolean).join(" · ") || "—"}</Txt>
            </View>
          </View>
        ))}
        {loading && rows.length > 0 ? <Buffering /> : null}
      </ScrollView>
    </View>
  );
}
