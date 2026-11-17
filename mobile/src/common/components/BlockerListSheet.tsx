import { Pressable, View } from "react-native";
import { BoundedList, C, PIcon, PrimaryButton, Sheet, StatusChip, Txt, WarningBanner } from "@/common/components/ui";

export type BlockerItem = { key: string; title: string; sub?: string; status?: string; onPress?: () => void };

type BlockerListSheetProps = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  /** What is in the way, e.g. "Rahul still holds 80 investments." */
  message: string;
  items: BlockerItem[];
  total: number;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
};

/** "Can't delete yet": a clear warning plus the records still in the way, in a box that scrolls and loads the rest
 * as you reach the bottom — so every blocker can be reached, however many there are. */
export function BlockerListSheet({ visible, onClose, title = "Can't Delete Yet", message, items, total, hasMore, loadingMore, onLoadMore }: BlockerListSheetProps) {
  return (
    <Sheet visible={visible} onClose={onClose} title={title} maxHeightPct={75}>
      <WarningBanner>{message}</WarningBanner>
      <Txt style={{ fontSize: 12.5, color: C.muted, marginBottom: 10 }}>Close or delete these first, then come back. Tap one to open it.</Txt>
      <BoundedList
        rows={4}
        onEndReached={hasMore && !loadingMore ? onLoadMore : undefined}
        loadingMore={loadingMore}
        caption={`Showing ${items.length} of ${total}${hasMore ? " — scroll for more" : ""}`}
      >
        {items.map((b, i) => (
          <Pressable
            key={b.key}
            onPress={b.onPress}
            disabled={!b.onPress}
            style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10, minHeight: 58, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: C.line }}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt style={{ fontSize: 13.5, fontWeight: "800", color: b.onPress ? C.brandDeep : C.ink }}>{b.title}</Txt>
              {b.sub ? <Txt style={{ fontSize: 11.5, color: C.muted, marginTop: 1 }}>{b.sub}</Txt> : null}
            </View>
            {b.status ? <StatusChip label={b.status} /> : null}
            {b.onPress ? <PIcon name="chevright" color={C.muted} /> : null}
          </Pressable>
        ))}
      </BoundedList>
      <PrimaryButton label="Close" variant="outline" onPress={onClose} />
    </Sheet>
  );
}
