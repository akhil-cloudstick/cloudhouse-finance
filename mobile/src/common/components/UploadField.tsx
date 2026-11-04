import React, { useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from "react-native";
import { C, Field, Sheet, SheetListItem, Txt } from "@/common/components/ui";
import { fromCamera, fromFiles, fromLibrary, PermissionError } from "@/common/components/ui/DocumentField";
import { uploadFile } from "@/common/services/uploadService";
import { type PickedFile } from "@/common/types/upload-types";
import { API_ORIGIN, ApiError } from "@/common/services/httpClient";
import { BillSheet, useUploadSource } from "./BillSheet";
import { useAuth } from "@/common/providers/AuthProvider";

type UploadFieldProps = {
  label: string;
  value: string;
  onChange: (url: string) => void;
  allowPdf?: boolean;
  emptyText?: string;
};

/** Prototype dashed upload tile ("Tap to add a photo" / "Tap to upload").
 * Uploads as soon as a file is picked; the value is the "/uploads/..." URL. */
export function UploadField({
  label,
  value,
  onChange,
  allowPdf = true,
  emptyText,
}: UploadFieldProps) {
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  // The just-picked file's own uri: shown at once (no wait for the server image to download) and used as the
  // thumbnail until the field is cleared.
  const [localUri, setLocalUri] = useState<{ url: string; uri: string } | null>(null);
  const [viewing, setViewing] = useState(false);
  // POST /uploads is gated "can create upload" — without it the tile is inert.
  const canUpload = useAuth().can("Upload_Management", "can_create_upload");

  async function pick(run: () => Promise<PickedFile | null>) {
    setChoosing(false);
    setError(null);
    try {
      const file = await run();
      if (!file) return;
      setBusy(true);
      // Show the picked photo immediately while it uploads.
      setLocalUri({ url: "", uri: file.uri });
      const url = await uploadFile(file);
      setName(file.name);
      setLocalUri({ url, uri: file.uri });
      onChange(url);
    } catch (e) {
      setLocalUri(null);
      setError(e instanceof PermissionError || e instanceof ApiError ? (e as Error).message : "Upload failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const isImage = !!value && !/\.pdf$/i.test(value);
  // /uploads/* is only served to a signed-in caller — send the session token.
  const thumbSource = useUploadSource(value || "");
  const localThumb = value && localUri && localUri.url === value ? { uri: localUri.uri } : null;
  const preview = localThumb ?? thumbSource ?? { uri: value.startsWith("http") ? value : `${API_ORIGIN}${value}` };
  return (
    <Field label={label}>
      <Pressable onPress={() => canUpload && !busy && setChoosing(true)} disabled={!canUpload} style={[s.box, !!value && s.boxDone]}>
        {busy ? (
          <View style={s.done}>
            {localUri?.uri ? <Image source={{ uri: localUri.uri }} style={[s.thumb, { opacity: 0.6 }]} /> : null}
            <ActivityIndicator color={C.brandDeep} />
            <Txt style={s.doneTxt}>Uploading…</Txt>
          </View>
        ) : value ? (
          <View style={s.done}>
            {isImage ? (
              <Pressable onPress={() => setViewing(true)} hitSlop={6}>
                <Image source={preview} style={s.thumb} />
              </Pressable>
            ) : null}
            <Txt style={s.doneTxt} numberOfLines={1}>
              {name ?? "Attached"}
              {canUpload ? " · Tap to replace" : ""}
            </Txt>
          </View>
        ) : (
          <Txt style={s.empty}>{!canUpload ? "You don't have permission to upload files" : emptyText ?? (allowPdf ? "Tap to upload" : "Tap to add a photo")}</Txt>
        )}
      </Pressable>
      {value ? (
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 18, marginTop: 6 }}>
          <Pressable onPress={() => setViewing(true)} hitSlop={6}>
            <Txt style={{ fontSize: 11, fontWeight: "700", color: C.brandDeep }}>View</Txt>
          </Pressable>
          <Pressable
            onPress={() => {
              setLocalUri(null);
              onChange("");
            }}
            hitSlop={6}
          >
            <Txt style={{ fontSize: 11, fontWeight: "700", color: C.red }}>Remove</Txt>
          </Pressable>
        </View>
      ) : null}
      <BillSheet path={viewing && value ? value : null} onClose={() => setViewing(false)} title={label} />
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
  thumb: { width: 56, height: 56, borderRadius: 8, backgroundColor: C.line },
  doneTxt: { flex: 1, fontSize: 12, fontWeight: "700", color: C.brandDeep },
});
