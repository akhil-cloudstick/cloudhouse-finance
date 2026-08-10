"use client";

import { useEffect, useRef, useState } from "react";
import { useData } from "@/lib/DataProvider";
import { useCustomers } from "@/lib/CustomersProvider";
import { useSchemes } from "@/lib/SchemesProvider";
import { useLoans } from "@/lib/LoansProvider";
import { Icon } from "@/lib/icons";
import { StatusChip } from "./StatusChip";
import { fmt } from "@/lib/format";

type ResultRow = { href: string; ic: string; t: string; s: string; chip: string | null };
type ResultGroup = [string, ResultRow[]];

/* Ported from legacy/app.js's global-search IIFE (`searchAll`, `draw`,
 * keyboard nav, `/` shortcut, click-outside-to-close). */
export default function GlobalSearch() {
  const { db } = useData();
  const { customers } = useCustomers();
  const { schemes } = useSchemes();
  const { loans } = useLoans();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(-1);
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
        href: "#loan/" + l.id,
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
        href: "#customer/" + c.id,
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
        href: "#schemes",
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
        href: "#packets",
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
        href: "#employees",
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
        window.location.hash = target.href;
        setQuery("");
        closeResults();
        inputRef.current?.blur();
      }
    } else if (e.key === "Escape") {
      setQuery("");
      closeResults();
      inputRef.current?.blur();
    }
  }

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!(e.target as HTMLElement).closest(".gsearch")) closeResults();
    }
    function onDocKeyDown(e: KeyboardEvent) {
      const tag = (document.activeElement?.tagName || "").toUpperCase();
      if (e.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onDocKeyDown);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onDocKeyDown);
    };
  }, []);

  return (
    <div className="gsearch" id="gsearch">
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
                    onClick={() => { setQuery(""); closeResults(); }}
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
