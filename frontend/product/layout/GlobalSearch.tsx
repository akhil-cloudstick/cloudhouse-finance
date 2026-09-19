"use client";

import { useEffect, useRef, useState } from "react";
import { useData } from "@/product/providers/DataProvider";
import { useCustomers } from "@/product/pages/customers/store/CustomersProvider";
import { useSchemes } from "@/product/pages/schemes/store/SchemesProvider";
import { useLoans } from "@/product/pages/loans/store/LoansProvider";
import { Icon } from "@/product/components/Icon";
import { StatusChip } from "@/product/components/ui/StatusChip";
import { fmt } from "@/product/utils/format";
import { navigate, routeHref } from "@/product/services/appRoutes";

type ResultRow = { href: string; ic: string; t: string; s: string; chip: string | null };
type ResultGroup = [string, ResultRow[]];

/* Ported from legacy/app.js's global-search IIFE (`searchAll`, `draw`,
 * keyboard nav, `/` shortcut, click-outside-to-close). */
export default function GlobalSearch({
  isOpen,
  onToggle,
}: {
  isOpen?: boolean;
  onToggle?: (open: boolean) => void;
} = {}) {
  const { db } = useData();
  const { customers } = useCustomers();
  const { schemes } = useSchemes();
  const { loans } = useLoans();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(-1);
  const [internalOpen, setInternalOpen] = useState(false);
  const isExpanded = isOpen !== undefined ? isOpen : internalOpen;
  const setExpanded = onToggle || setInternalOpen;
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  function searchAll(q: string): ResultGroup[] {
    const needle = q.toLowerCase();
    const hit = (s?: string) => (s || "").toLowerCase().includes(needle);
    const groups: ResultGroup[] = [];

    const loanHits = loans
      .filter((l) => hit(l.id) || hit(l.customerName) || hit(l.status))
      .slice(0, 5)
      .map((l) => ({
        href: routeHref("loan/" + l.id),
        ic: "list",
        t: l.id + " — " + l.customerName,
        s: l.schemeName + " · " + fmt(l.principal),
        chip: l.status,
      }));
    if (loanHits.length) groups.push(["Loans", loanHits]);

    const custs = customers
      .filter((c) => hit(c.name) || hit(c.id) || hit(c.phone) || hit(c.address))
      .slice(0, 5)
      .map((c) => ({
        href: routeHref("customer/" + c.id),
        ic: "user",
        t: c.name,
        s: c.code + " · " + c.phone + " · " + c.branchName,
        chip: c.kycStatus,
      }));
    if (custs.length) groups.push(["Customers", custs]);

    const schs = schemes
      .filter((s) => hit(s.name) || hit(s.id))
      .slice(0, 4)
      .map((s) => ({
        href: routeHref("schemes"),
        ic: "doc",
        t: s.name,
        s: s.rate + "% p.a. · " + s.ltv + "% LTV · penal " + s.penal + "%/m",
        chip: s.active ? "Active" : "Inactive",
      }));
    if (schs.length) groups.push(["Schemes", schs]);

    const pkts = db.packets
      .filter((p) => hit(p.id) || hit(p.qr) || hit(p.cust))
      .slice(0, 4)
      .map((p) => ({
        href: routeHref("packets"),
        ic: "box",
        t: p.id + " — " + p.cust,
        s: p.weight.toFixed(1) + " g · " + p.locker,
        chip: p.status,
      }));
    if (pkts.length) groups.push(["Gold Packets", pkts]);

    const emps = db.employees
      .filter((e) => hit(e.name) || hit(e.id) || hit(e.role))
      .slice(0, 4)
      .map((e) => ({
        href: routeHref("employees"),
        ic: "user",
        t: e.name,
        s: e.role + " · " + e.branch,
        chip: null as string | null,
      }));
    if (emps.length) groups.push(["Employees", emps]);

    return groups;
  }

  const groups = query.trim().length >= 2 ? searchAll(query.trim()) : [];
  const flatItems = groups.flatMap(([, items]) => items);

  function closeResults() {
    setOpen(false);
  }

  function handleChange(v: string) {
    setQuery(v);
    setSel(-1);
    setOpen(v.trim().length >= 2);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!flatItems.length) return;
      setSel((s) => (e.key === "ArrowDown" ? (s + 1) % flatItems.length : (s - 1 + flatItems.length) % flatItems.length));
    } else if (e.key === "Enter") {
      const target = sel >= 0 ? flatItems[sel] : flatItems[0];
      if (target) {
        navigate(target.href);
        setQuery("");
        closeResults();
        setExpanded(false);
        inputRef.current?.blur();
      }
    } else if (e.key === "Escape") {
      setQuery("");
      closeResults();
      setExpanded(false);
      inputRef.current?.blur();
    }
  }

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!(e.target as HTMLElement).closest(".gsearch")) {
        closeResults();
        setExpanded(false);
      }
    }
    function onDocKeyDown(e: KeyboardEvent) {
      const tag = (document.activeElement?.tagName || "").toUpperCase();
      if (e.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) {
        e.preventDefault();
        setExpanded(true);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    }
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onDocKeyDown);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onDocKeyDown);
    };
  }, [setExpanded]);

  return (
    <div className={`gsearch${isExpanded ? " gsearch-expanded" : ""}`} id="gsearch">
      <button
        type="button"
        className="gsearch-trigger"
        aria-label="Open search"
        title="Search ( / )"
        onClick={() => {
          setExpanded(true);
          setTimeout(() => inputRef.current?.focus(), 50);
        }}
      >
        <Icon name="search" />
      </button>
      <div className="gsearch-bar">
        <Icon name="search" />
        <input
          ref={inputRef}
          id="gsInput"
          type="text"
          placeholder="Search loans, customers, schemes, packets…"
          autoComplete="off"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => { if (query.trim().length >= 2) setOpen(true); }}
          onKeyDown={handleKeyDown}
        />
        <kbd>/</kbd>
        <button
          type="button"
          className="gsearch-close"
          aria-label="Close search"
          onClick={() => {
            setQuery("");
            closeResults();
            setExpanded(false);
          }}
        >
          ×
        </button>
      </div>
      <div className={`gs-results${open ? " open" : ""}`} id="gsResults" ref={boxRef}>
        {groups.length ? (
          groups.map(([g, items]) => (
            <div key={g}>
              <div className="gs-grp">{g}</div>
              {items.map((r) => {
                const flatIndex = flatItems.indexOf(r);
                return (
                  <a
                    key={r.href + r.t}
                    href={r.href}
                    className={flatIndex === sel ? "sel" : ""}
                    onClick={() => { setQuery(""); closeResults(); setExpanded(false); }}
                  >
                    <span className="ic"><Icon name={r.ic} /></span>
                    <span className="tx">
                      <b>{r.t}</b>
                      <small>{r.s}</small>
                    </span>
                    {r.chip && <StatusChip status={r.chip} />}
                  </a>
                );
              })}
            </div>
          ))
        ) : query.trim().length >= 2 ? (
          <div className="gs-none">No results for &ldquo;{query.trim()}&rdquo;</div>
        ) : null}
      </div>
    </div>
  );
}
