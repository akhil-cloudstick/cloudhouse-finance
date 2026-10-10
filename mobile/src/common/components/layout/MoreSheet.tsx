import { Sheet, SheetListItem, openPage } from "@/common/components/ui";
import { useMoreRows } from "./moreRows";

type MoreSheetProps = { visible: boolean; onClose: () => void; onGoldRate: () => void };

export function MoreSheet({ visible, onClose, onGoldRate }: MoreSheetProps) {
  const rows = useMoreRows();
  return (
    <Sheet visible={visible} onClose={onClose} title="More" maxHeightPct={80}>
      {rows.map((r, i) => (
        <SheetListItem
          key={r.key}
          first={i === 0}
          icon={r.icon}
          title={r.title}
          sub={r.sub}
          onPress={() => {
            onClose();
            if (r.action === "gold") onGoldRate();
            else openPage(`/${r.route}`);
          }}
        />
      ))}
    </Sheet>
  );
}
