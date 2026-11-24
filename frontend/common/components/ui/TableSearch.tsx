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
    // Its own <form> (layout-neutral) so Chrome's autofill treats the search box as a separate form and
    // doesn't fill it along with a registration form open on the same page.
    <form role="search" autoComplete="off" style={{ display: "contents" }} onSubmit={(e) => e.preventDefault()}>
      <div className="search">
        <Icon name="search" />
        <input className="inp" autoComplete="off" name="table-search" data-lpignore="true" data-form-type="other" placeholder={placeholder} title={`Searches: ${searches}`} value={value} onChange={(e) => onChange(e.target.value)} />
        {value ? <button type="button" className="search-clear" aria-label="Clear search" title="Clear" onClick={() => onChange("")}><Icon name="x" /></button> : null}
      </div>
    </form>
  );
}
