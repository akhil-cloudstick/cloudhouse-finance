import { useEffect, useState } from "react";
import { Pressable } from "react-native";
import { Sheet, SheetListItem, Txt, C } from "@/common/components/ui";
import { TENANT_MODULES } from "@/common/config/tenantModules";
import { useTheme } from "@/common/theme/ThemeProvider";
import { WhatsAppPanel } from "@/modules/integrations/components/WhatsAppPanel";

/* One entry per integration; `module` is the business module the super admin
 * has to switch on for it to show up. */
const INTEGRATIONS = [
  { key: "whatsapp", label: "WhatsApp", sub: "Send messages from your own number", icon: "share", module: TENANT_MODULES.whatsapp, Panel: WhatsAppPanel },
];

type SettingsSheetProps = { visible: boolean; onClose: () => void };

/* Where a business manages its integrations — opened from the Profile sheet.
 * The web modal's sidebar becomes a list that drills into the integration. */
export function SettingsSheet({ visible, onClose }: SettingsSheetProps) {
  const { hasModule } = useTheme();
  const items = INTEGRATIONS.filter((i) => hasModule(i.module));
  const [active, setActive] = useState<string | null>(null);
  const current = items.find((i) => i.key === active);

  // reopening starts from the list again
  useEffect(() => {
    if (!visible) setActive(null);
  }, [visible]);

  return (
    <Sheet visible={visible} onClose={onClose} title={current ? current.label : "Settings"} maxHeightPct={85}>
      {current ? (
        // mounted only while open, so its status polling stops with the sheet
        visible ? <current.Panel /> : null
      ) : items.length ? (
        items.map((i, n) => <SheetListItem key={i.key} first={n === 0} icon={i.icon} title={i.label} sub={i.sub} onPress={() => setActive(i.key)} />)
      ) : (
        <Txt style={{ color: C.muted, fontSize: 13, paddingVertical: 12 }}>No integrations are enabled for your business.</Txt>
      )}
      {current ? (
        <Pressable onPress={() => setActive(null)} style={{ paddingVertical: 12 }}>
          <Txt style={{ color: C.brandDeep, fontSize: 13, fontWeight: "600" }}>‹ All integrations</Txt>
        </Pressable>
      ) : null}
    </Sheet>
  );
}
