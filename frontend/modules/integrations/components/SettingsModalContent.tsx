"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/common/components/Icon";
import { useModal } from "@/common/components/ModalProvider";
import { useBranding } from "@/common/providers/BrandingProvider";
import { WhatsAppPanel } from "@/modules/integrations/components/WhatsAppPanel";

/* One entry per integration; `module` is the business module the superadmin
 * has to switch on for it to show up (tenant.KnownModules). */
const INTEGRATIONS = [
  { key: "whatsapp", label: "WhatsApp", icon: "whatsapp" as const, module: "whatsapp", Panel: WhatsAppPanel },
];

/* Where a business manages its integrations. Opened from the header account menu. */
export function SettingsModalContent() {
  const { closeModal } = useModal();
  const { hasModule } = useBranding();
  const items = useMemo(() => INTEGRATIONS.filter((i) => hasModule(i.module)), [hasModule]);
  const [active, setActive] = useState(items[0]?.key ?? "");
  const current = items.find((i) => i.key === active) ?? items[0];

  return (
    <>
      <div className="hd"><h3>Settings</h3><div className="sp" /><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        <div className="set-wrap">
          <nav className="set-nav" aria-label="Settings sections">
            <span className="set-nav-h">Integrations</span>
            {items.map((i) => (
              <button
                key={i.key}
                type="button"
                className={i.key === current?.key ? "on" : ""}
                onClick={() => setActive(i.key)}
              >
                <Icon name={i.icon} /> {i.label}
              </button>
            ))}
          </nav>
          <section className="set-pane">
            {current ? <current.Panel /> : <p className="connect-qr-msg">No integrations are enabled for your business.</p>}
          </section>
        </div>
      </div>
      <div className="ft">
        <button className="btn" onClick={closeModal}>Close</button>
      </div>
    </>
  );
}
