"use client";

import { Icon } from "@/common/components/Icon";

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  // What the box searches, shown on hover: "Searches: branch name, code, address…"
  searches: string;
};

// The search box every list table uses — the same markup as the Investments list.
export function TableSearch({ value, onChange, placeholder, searches }: Props) {
  return (
    <div className="search">
      <Icon name="search" />
      <input className="inp" placeholder={placeholder} title={`Searches: ${searches}`} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
