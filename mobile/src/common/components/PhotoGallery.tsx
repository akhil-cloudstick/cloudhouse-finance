import React, { useRef, useState } from "react";
import { Pressable, ScrollView, View, useWindowDimensions, type ScrollViewInstance } from "react-native";
import { C, PIcon, Sheet, Txt } from "@/common/components/ui";
import { UploadImage } from "./BillSheet";

type PhotoGalleryProps = { paths: string[]; title: string; height?: number };

/** One preview photo (the first) with a "+N" badge. Tapping it opens a viewer that
 * pages through every photo — swipe, or use the arrows. */
export function PhotoGallery({ paths, title, height = 160 }: PhotoGalleryProps) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const ref = useRef<ScrollViewInstance>(null);
  const { width } = useWindowDimensions();
  // The sheet pads 20px each side.
  const pageW = width - 40;
  if (paths.length === 0) return null;
  const go = (i: number) => {
    const n = Math.max(0, Math.min(paths.length - 1, i));
    setIndex(n);
    ref.current?.scrollTo({ x: n * pageW, animated: true });
  };
  return (
    <>
      <Pressable
        onPress={() => {
          setIndex(0);
          setOpen(true);
        }}
        accessibilityRole="imagebutton"
        accessibilityLabel={`${title}, ${paths.length} photo${paths.length > 1 ? "s" : ""}`}
      >
        <UploadImage path={paths[0]} viewer={false} title={title} style={{ width: "100%", height, borderRadius: 10, marginTop: 8 }} />
        {paths.length > 1 ? (
          <View style={{ position: "absolute", right: 8, bottom: 8, backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 }}>
            <Txt style={{ color: "#fff", fontSize: 11.5, fontWeight: "700" }}>{`+${paths.length - 1}`}</Txt>
          </View>
        ) : null}
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} title={paths.length > 1 ? `${title} · ${index + 1}/${paths.length}` : title} maxHeightPct={85}>
        <ScrollView
          ref={ref}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / pageW))}
          style={{ marginTop: 10 }}
        >
          {paths.map((p) => (
            <View key={p} style={{ width: pageW }}>
              <UploadImage path={p} viewer={false} title={title} style={{ width: pageW, height: 420, borderRadius: 10 }} />
            </View>
          ))}
        </ScrollView>
        {paths.length > 1 ? (
          <View style={{ flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 28, paddingTop: 14 }}>
            <Pressable onPress={() => go(index - 1)} disabled={index === 0} hitSlop={10} accessibilityLabel="Previous photo" style={{ opacity: index === 0 ? 0.3 : 1 }}>
              <PIcon name="back" color={C.brandDeep} size={26} />
            </Pressable>
            <Pressable onPress={() => go(index + 1)} disabled={index === paths.length - 1} hitSlop={10} accessibilityLabel="Next photo" style={{ opacity: index === paths.length - 1 ? 0.3 : 1 }}>
              <PIcon name="chevright" color={C.brandDeep} size={26} />
            </Pressable>
          </View>
        ) : null}
      </Sheet>
    </>
  );
}
