"use client";

import { useState } from "react";
import { useData } from "@/lib/DataProvider";
import { useModal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { Icon } from "@/lib/icons";
import type { Customer } from "@/lib/data";

/* Ported from legacy/app.js's `openCustomerModal()` / `saveCustomer()`. */
export function RegisterCustomerModalContent() {
  const { db, refresh } = useData();
  const { closeModal } = useModal();
  const toast = useToast();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [dob, setDob] = useState("");
  const [branch, setBranch] = useState("Koratty");
  const [addr, setAddr] = useState("");
  const [pan, setPan] = useState("");
  const [aad, setAad] = useState("");
  const [err, setErr] = useState("");

  function save() {
    const n = name.trim();
    const p = phone.trim();
    if (n.length < 3) { setErr("Please enter the customer’s full name."); return; }
    if (!/^\d[\d ]{8,}$/.test(p)) { setErr("Please enter a valid mobile number."); return; }

    const nextNum = 1000 + db.customers.length + 1;
    const c: Customer = {
      id: "CUST-" + nextNum,
      name: n,
      phone: p,
      dob: dob || "—",
      addr: addr.trim() || "—",
      pan: "P",
      aadhaar: "P",
      kyc: "Pending",
      photo: n.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase(),
      branch,
      loans: [],
      since: new Date().toISOString().slice(0, 10),
    };
    db.addCustomer(c);
    refresh();
    closeModal();
    toast(`${n} registered — ${c.id} · KYC verification pending`);
    location.hash = "customer/" + c.id;
  }

  return (
    <>
      <div className="hd"><h3>Register Customer</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <div className="frow c2">
          <div><label className="f">Full Name *</label><input className="inp" placeholder="e.g. Anil Varma" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><label className="f">Mobile Number *</label><input className="inp" placeholder="10-digit mobile" maxLength={11} value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        </div>
        <div className="frow c2">
          <div><label className="f">Date of Birth</label><input className="inp" type="date" value={dob} onChange={(e) => setDob(e.target.value)} /></div>
          <div><label className="f">Branch</label>
            <select className="inp" value={branch} onChange={(e) => setBranch(e.target.value)}>
              <option>Koratty</option><option>Angamaly</option><option>Kodakara</option>
            </select>
          </div>
        </div>
        <div className="frow"><div><label className="f">Address</label><input className="inp" placeholder="House / street, town, district" value={addr} onChange={(e) => setAddr(e.target.value)} /></div></div>
        <div className="frow c2">
          <div><label className="f">PAN Number</label><input className="inp" placeholder="ABCDE1234F" maxLength={10} style={{ textTransform: "uppercase" }} value={pan} onChange={(e) => setPan(e.target.value)} /></div>
          <div><label className="f">Aadhaar (last 4 digits)</label><input className="inp" placeholder="XXXX" maxLength={4} value={aad} onChange={(e) => setAad(e.target.value)} /></div>
        </div>
        <div className="frow"><div><label className="f">Customer Photograph</label><input className="inp" type="file" accept="image/*" /></div></div>
        <div className="notice"><Icon name="shield" /> PAN &amp; Aadhaar verification runs through the authorized KYC service after registration. Loans stay blocked until KYC passes.</div>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save}><Icon name="check" /> Register Customer</button>
      </div>
    </>
  );
}
