"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/common/components/Icon";
import { useModal } from "@/common/components/ModalProvider";
import { useAuth } from "@/common/providers/AuthProvider";
import { useBranding } from "@/common/providers/BrandingProvider";
import { WhatsAppPanel } from "@/modules/integrations/components/WhatsAppPanel";
import { ConnectMobilePanel } from "@/modules/integrations/components/ConnectMobilePanel";
import { BusinessProfilePanel } from "@/modules/settings/components/BusinessProfilePanel";

/* One entry per section; `module` is the business module the superadmin
 * has to switch on for it to show up (tenant.KnownModules), none means always shown.
 * `perm` is the role permission ([module, key]) the section additionally needs. */
const SECTIONS: { key: string; label: string; icon: "mobileLink" | "waOutline" | "bank"; module?: string; perm?: [string, string]; Panel: () => React.ReactNode }[] = [
  { key: "profile", label: "Business Profile", icon: "bank", perm: ["Business_Profile", "can_view_business_profile_module"], Panel: BusinessProfilePanel },
  { key: "mobile", label: "Link Mobile", icon: "mobileLink", Panel: ConnectMobilePanel },
  { key: "whatsapp", label: "WhatsApp", icon: "waOutline", module: "whatsapp", Panel: WhatsAppPanel },
];

/* Where a business keeps its profile, links the staff app and manages its integrations. Opened from the header account menu. */
export function SettingsModalContent() {
  const { closeModal } = useModal();
  const { hasModule } = useBranding();
  const { can } = useAuth();
  const items = useMemo(
    () => SECTIONS.filter((i) => (!i.module || hasModule(i.module)) && (!i.perm || can(i.perm[0], i.perm[1]))),
    [hasModule, can]
  );
  const [active, setActive] = useState(items[0].key);
  const current = items.find((i) => i.key === active) ?? items[0];

  return (
    <>
      <div className="hd"><h3>Settings</h3><div className="sp" /><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        <div className="set-wrap">
          <nav className="set-nav" aria-label="Settings sections">
            <span className="set-nav-h">Settings</span>
            {items.map((i) => (
              <button
                key={i.key}
                type="button"
                className={i.key === current?.key ? "on" : ""}
                onClick={() => setActive(i.key)}
              >
                <span className="set-nav-ico"><Icon name={i.icon} /></span> {i.label}
              </button>
            ))}
          </nav>
          <section className="set-pane">
            <current.Panel />
          </section>
        </div>
      </div>
      <div className="ft">
        <button className="btn" onClick={closeModal}>Close</button>
      </div>
    </>
  );
}
