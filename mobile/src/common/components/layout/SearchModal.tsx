import { SELECTION_COLOR } from "@/common/theme/colors";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, TextInput, View, type TextInputInstance } from "react-native";
import { C, EmptyText, FilterChipRow, Hit, PIcon, ServerFlatList, TopModal, Txt, openPage } from "@/common/components/ui";
import { useServerList } from "@/common/hooks/use-server-list";
import { listLoansPage } from "@/modules/loans/services/loanService";
import { listCustomersPage } from "@/modules/customers/services/customerService";
import { listSchemesPage } from "@/modules/schemes/services/schemeService";
import { useCanOpen } from "@/common/config/routePermissions";
import type { Loan } from "@/modules/loans/types/loan-types";
import type { Customer } from "@/modules/customers/types/customer-types";
import type { Scheme } from "@/modules/schemes/types/scheme-types";
import { s } from "./shellModalsShared";

// ---------------------------------------------------------------------------
// Global search (prototype #search-modal) — slides down from the top.
// ---------------------------------------------------------------------------
const SEARCH_SCOPES = ["All", "Customers", "Loan No.", "Scheme"] as const;
type SearchScope = (typeof SEARCH_SCOPES)[number];
type SearchModalProps = { visible: boolean; onClose: () => void };

export function SearchModal({ visible, onClose }: SearchModalProps) {
  const [picked, setScope] = useState<SearchScope>("All");
  // Only the scopes whose results the user can open: customers → Customers,
  // loans → All / Loan No., and a scheme hit opens the loan list filtered by it.
  const canOpen = useCanOpen();
  const scopes = SEARCH_SCOPES.filter((sc) =>
    sc === "Customers" ? canOpen("/customers") : sc === "Scheme" ? canOpen("/schemes") && canOpen("/loans") : canOpen("/loans")
  );
  const scope: SearchScope | undefined = scopes.includes(picked) ? picked : scopes[0];
  // Nothing heavy happens while the panel slides in: the result lists
  // mount (and start fetching) and the keyboard rises only once it has
  // finished — doing either mid-slide is what made the opening stutter.
  const searchInput = useRef<TextInputInstance>(null);
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
    enabled: opened && (scope === "Customers" || (scope === "All" && canOpen("/customers"))),
  });
  const schemeList = useServerList<Scheme>({
    key: ["search", "schemes"],
    fetchPage: (p) => listSchemesPage(p),
    enabled: opened && (scope === "Scheme" || (scope === "All" && canOpen("/schemes") && canOpen("/loans"))),
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

  // A finger that dragged to scroll a result list must not count as a tap on the row it lifted off
  // (on iOS the row press is no longer cancelled by the scroll, so lift-off opened the row and closed the modal).
  const touch = useRef({ x: 0, y: 0, moved: false });
  const go = (path: string) => {
    if (touch.current.moved) return;
    onClose();
    openPage(path);
  };

  // "All" shows the best few matches from each place the user can open, instead of loans only.
  const ALL_PER_SECTION = 4;
  const showCustomers = canOpen("/customers");
  const showSchemes = canOpen("/schemes") && canOpen("/loans");
  const allCustomers = showCustomers ? custList.items.slice(0, ALL_PER_SECTION) : [];
  const allLoans = loanList.items.slice(0, ALL_PER_SECTION);
  const allSchemes = showSchemes ? schemeList.items.slice(0, ALL_PER_SECTION) : [];
  const allLoading = loanList.isLoading || (showCustomers && custList.isLoading) || (showSchemes && schemeList.isLoading);
  const sectionLabel = { fontSize: 12, color: C.muted, marginTop: 10, marginBottom: 4 } as const;
  const allBody = (
    <ScrollView keyboardShouldPersistTaps="handled" style={{ paddingHorizontal: 16 }}>
      {allCustomers.length > 0 && <Txt style={sectionLabel}>Customers</Txt>}
      {allCustomers.map((c) => (
        <Hit key={`c${c.id}`} name={c.name} meta={`${c.code ?? ""} · ${c.phone ?? ""}`} tag="Customer" onPress={() => go(`/customers/${c.id}`)} />
      ))}
      {allLoans.length > 0 && <Txt style={sectionLabel}>Loans</Txt>}
      {allLoans.map((l) => (
        <Hit
          key={`l${l.id}`}
          name={l.customer?.name ?? `Customer #${l.customerId}`}
          meta={`${l.loanNumber}${l.customer?.code ? ` · ${l.customer.code}` : ""}`}
          tag={l.scheme?.name}
          onPress={() => go(`/loans/${l.id}`)}
        />
      ))}
      {allSchemes.length > 0 && <Txt style={sectionLabel}>Schemes</Txt>}
      {allSchemes.map((sc) => (
        <Hit key={`s${sc.id}`} name={sc.name} meta={sc.ltvBased === false ? `${sc.interestRate}% p.a. · no LTV` : `${sc.interestRate}% p.a. · LTV ${sc.ltvPercent}%`} tag="Scheme" onPress={() => go(`/loans?schemeId=${sc.id}`)} />
      ))}
      {!allLoading && allCustomers.length + allLoans.length + allSchemes.length === 0 ? <EmptyText>No results match your search.</EmptyText> : null}
      {allCustomers.length + allLoans.length + allSchemes.length > 0 ? <Txt style={{ ...sectionLabel, textAlign: "center" }}>Pick a category above to see more.</Txt> : null}
    </ScrollView>
  );

  const body = !scope ? (
    <EmptyText>You don&apos;t have permission to search customers, loans or schemes.</EmptyText>
  ) :
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
    ) : scope === "All" ? (
      allBody
    ) : scope === "Scheme" ? (
      <ServerFlatList
        list={schemeList}
        items={schemeList.items}
        inSheet
        gutter={16}
        emptyText="No schemes match your search."
        keyOf={(sc) => `s${sc.id}`}
        renderItem={(sc) => (
          <Hit name={sc.name} meta={sc.ltvBased === false ? `${sc.interestRate}% p.a. · no LTV` : `${sc.interestRate}% p.a. · LTV ${sc.ltvPercent}%`} tag="Scheme" onPress={() => go(`/loans?schemeId=${sc.id}`)} />
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
            cursorColor={C.brand}
            selectionColor={SELECTION_COLOR}
            autoCorrect={false}
            autoCapitalize="none"
            allowFontScaling={false}
            style={s.searchInput}
          />
          {text ? (
            <Pressable style={s.searchIc} hitSlop={10} onPress={() => setText("")} accessibilityLabel="Clear search">
              <PIcon name="close" color={C.muted} size={14} />
            </Pressable>
          ) : (
            <View style={s.searchIc} pointerEvents="none">
              <PIcon name="search" color={C.muted} />
            </View>
          )}
        </View>
        <Pressable onPress={onClose} hitSlop={10}>
          <Txt style={s.cancel}>Cancel</Txt>
        </Pressable>
      </View>
      <View style={{ paddingTop: 12, paddingHorizontal: 16, paddingBottom: 4 }}>
        {scopes.length > 1 && scope ? <FilterChipRow options={scopes} value={scope} onChange={setScope} style={{ marginBottom: 0 }} /> : null}
      </View>
      {/* Fixed-height placeholder while sliding, so the panel doesn't
          change size (or render the lists) mid-animation. */}
      <View
        style={{ maxHeight: 460, paddingTop: 6 }}
        onTouchStart={(e) => (touch.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, moved: false })}
        onTouchMove={(e) => {
          if (Math.abs(e.nativeEvent.pageY - touch.current.y) > 8 || Math.abs(e.nativeEvent.pageX - touch.current.x) > 8) touch.current.moved = true;
        }}
      >{opened ? body : <View style={{ height: 300 }} />}</View>
    </TopModal>
  );
}
