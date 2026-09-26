import React, { useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from "react-native";
import { C, Field, Sheet, SheetListItem, Txt } from "../ui";
import { fromCamera, fromFiles, fromLibrary, PermissionError } from "../DocumentField";
import { uploadFile, type PickedFile } from "../../api/uploads";
import { API_ORIGIN } from "../../api/config";
import { ApiError } from "../../api/client";

/** Prototype dashed upload tile ("Tap to add a photo" / "Tap to upload").
 * Uploads as soon as a file is picked; the value is the "/uploads/..." URL. */
export function UploadField({
  label,
  value,
  onChange,
  allowPdf = true,
  emptyText,
}: {
  label: string;
  value: string;
  onChange: (url: string) => void;
  allowPdf?: boolean;
  emptyText?: string;
}) {
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);

  async function pick(run: () => Promise<PickedFile | null>) {
    setChoosing(false);
    setError(null);
    try {
      const file = await run();
      if (!file) return;
      setBusy(true);
      const url = await uploadFile(file);
      setName(file.name);
      onChange(url);
    } catch (e) {
      setError(e instanceof PermissionError || e instanceof ApiError ? (e as Error).message : "Upload failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const isImage = !!value && !/\.pdf$/i.test(value);
  return (
    <Field label={label}>
      <Pressable onPress={() => !busy && setChoosing(true)} style={[s.box, !!value && s.boxDone]}>
        {busy ? (
          <ActivityIndicator color={C.brandDeep} />
        ) : value ? (
          <View style={s.done}>
            {isImage ? <Image source={{ uri: value.startsWith("http") ? value : `${API_ORIGIN}${value}` }} style={s.thumb} /> : null}
            <Txt style={s.doneTxt} numberOfLines={1}>
              {name ?? "Attached"} · Tap to replace
            </Txt>
          </View>
        ) : (
          <Txt style={s.empty}>{emptyText ?? (allowPdf ? "Tap to upload" : "Tap to add a photo")}</Txt>
        )}
      </Pressable>
      {value ? (
        <Pressable onPress={() => onChange("")} hitSlop={6} style={{ alignSelf: "flex-end", marginTop: 6 }}>
          <Txt style={{ fontSize: 11, fontWeight: "700", color: C.red }}>Remove</Txt>
        </Pressable>
      ) : null}
      {error ? <Txt style={{ fontSize: 11, color: C.red, marginTop: 6 }}>{error}</Txt> : null}
      <Sheet visible={choosing} onClose={() => setChoosing(false)} title={label} maxHeightPct={50}>
        <SheetListItem first icon="scan" title="Take a photo" onPress={() => pick(fromCamera)} />
        <SheetListItem icon="doc" title="Choose from gallery" onPress={() => pick(fromLibrary)} />
        {allowPdf ? <SheetListItem icon="note" title="Choose a file" sub="PDF or image" onPress={() => pick(fromFiles)} /> : null}
      </Sheet>
    </Field>
  );
}

const s = StyleSheet.create({
  box: { borderWidth: 1.5, borderStyle: "dashed", borderColor: C.line, borderRadius: 12, padding: 16, alignItems: "center", justifyContent: "center", minHeight: 52 },
  boxDone: { borderColor: C.brandDeep, backgroundColor: C.brandFaint, padding: 10 },
  empty: { color: C.muted, fontSize: 12 },
  done: { flexDirection: "row", alignItems: "center", gap: 10, alignSelf: "stretch" },
  thumb: { width: 40, height: 40, borderRadius: 8, backgroundColor: C.line },
  doneTxt: { flex: 1, fontSize: 12, fontWeight: "700", color: C.brandDeep },
});
