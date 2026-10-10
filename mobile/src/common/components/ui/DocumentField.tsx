import React, { useState } from "react";
import { View, Image, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { ThemedText } from "./ThemedText";
import { BottomSheetModal } from "./BottomSheetModal";
import { Icon } from "./Icon";
import { colors } from "@/common/theme/colors";
import { useTheme } from "@/common/theme/ThemeProvider";
import { API_ORIGIN, ApiError } from "@/common/services/httpClient";
import { uploadFile } from "@/common/services/uploadService";
import { PickedFile } from "@/common/types/upload-types";
import { useUploadSource } from "@/common/components/BillSheet";

// The web modal collects these with a bare <input type="file">. On mobile the
// equivalent is drawn in the app's own language instead of the platform's:
// a dashed "attach" tile, a themed source chooser raised as a BottomSheetModal
// (the same sheet the More menu uses), and a thumbnail/filename chip once
// something is attached. Nothing here shows stock picker chrome beyond the
// OS gallery/camera/file screens themselves, which aren't ours to restyle.
//
// The file is uploaded as soon as it's picked and the field holds the
// resulting "/uploads/..." URL, so submitting the form is a plain JSON POST
// with no multipart work left to do — same split as the web modal, which
// uploads in save() before createCustomer.

type Source = { key: string; label: string; icon: string; run: () => Promise<PickedFile | null> };

// Thrown for a denied permission — the one non-API error whose message is
// meant for the user as-is (see pick()'s catch).
export class PermissionError extends Error {}

export async function fromCamera(): Promise<PickedFile | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new PermissionError("Camera permission is needed to take a photo.");
  // Low quality keeps full-resolution camera shots small enough to upload quickly.
  const res = await ImagePicker.launchCameraAsync({ mediaTypes: "images", quality: 0.35, exif: false });
  if (res.canceled || !res.assets?.length) return null;
  const a = res.assets[0];
  return { uri: a.uri, name: a.fileName || "photo.jpg", mimeType: a.mimeType || "image/jpeg" };
}

export async function fromLibrary(): Promise<PickedFile | null> {
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: "images", quality: 0.35, exif: false });
  if (res.canceled || !res.assets?.length) return null;
  const a = res.assets[0];
  return { uri: a.uri, name: a.fileName || "image.jpg", mimeType: a.mimeType || "image/jpeg" };
}

export async function fromFiles(): Promise<PickedFile | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: ["application/pdf", "image/*"],
    copyToCacheDirectory: true,
  });
  if (res.canceled || !res.assets?.length) return null;
  const a = res.assets[0];
  return { uri: a.uri, name: a.name || "document", mimeType: a.mimeType };
}

type DocumentFieldProps = {
  label: string;
  hint?: string;
  /** The uploaded "/uploads/..." URL, or "" when nothing is attached. */
  value: string;
  onChange: (url: string) => void;
  allowPdf?: boolean;
};

export function DocumentField({
  label,
  hint,
  value,
  onChange,
  allowPdf = true,
}: DocumentFieldProps) {
  const { colors } = useTheme();
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);

  const sources: Source[] = [
    { key: "camera", label: "Take a photo", icon: "scan", run: fromCamera },
    { key: "library", label: "Choose from photos", icon: "eye", run: fromLibrary },
    ...(allowPdf ? [{ key: "files", label: "Choose a PDF or file", icon: "doc", run: fromFiles }] : []),
  ];

  const isImage = !!value && !/\.pdf$/i.test(value);
  // /uploads/* is only served to a signed-in caller — send the session token.
  const thumbSource = useUploadSource(value || "");

  async function pick(source: Source) {
    setChoosing(false);
    setError(null);
    try {
      const file = await source.run();
      if (!file) return;
      setBusy(true);
      const url = await uploadFile(file);
      setName(file.name);
      onChange(url);
    } catch (e) {
      // Backend rejections (ApiError) carry a message written for staff —
      // "file is too large", "unsupported file type" — so those are shown.
      // Anything else is an internal JS/native error ("Unsupported
      // FormDataPart implementation", a picker crash) that means nothing to
      // the person holding the phone, so it's logged and replaced.
      if (e instanceof ApiError) {
        setError(e.message);
      } else {
        console.warn("DocumentField upload failed", e);
        setError(e instanceof PermissionError ? e.message : "Couldn't attach that file — please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <ThemedText variant="label" color={colors.muted} style={styles.label}>
        {label}
      </ThemedText>

      {value ? (
        <View style={styles.attached}>
          {isImage ? (
            <Image source={thumbSource ?? { uri: `${API_ORIGIN}${value}` }} style={[styles.thumb, { backgroundColor: colors.brandPale }]} />
          ) : (
            <View style={[styles.thumb, { backgroundColor: colors.brandPale }, styles.thumbDoc]}>
              <Icon name="doc" size={20} color={colors.brandDeep} />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <ThemedText variant="body" numberOfLines={1}>
              {name ?? "Attached"}
            </ThemedText>
            <ThemedText variant="small" color={colors.green}>
              Uploaded
            </ThemedText>
          </View>
          <Pressable onPress={() => setChoosing(true)} hitSlop={8} style={styles.action}>
            <ThemedText variant="label" color={colors.brandDeep}>
              Replace
            </ThemedText>
          </Pressable>
          <Pressable
            onPress={() => {
              onChange("");
              setName(null);
            }}
            hitSlop={8}
            style={styles.action}
          >
            <ThemedText variant="label" color={colors.red}>
              Remove
            </ThemedText>
          </Pressable>
        </View>
      ) : (
        <Pressable style={[styles.dropzone, { borderColor: colors.brand }]} onPress={() => setChoosing(true)} disabled={busy}>
          {busy ? (
            <ActivityIndicator color={colors.brand} />
          ) : (
            <>
              <Icon name="plus" size={18} color={colors.brandDeep} />
              <ThemedText variant="body" color={colors.brandDeep}>
                Attach
              </ThemedText>
            </>
          )}
        </Pressable>
      )}

      {hint && !value ? (
        <ThemedText variant="small" color={colors.muted} style={{ marginTop: 4 }}>
          {hint}
        </ThemedText>
      ) : null}
      {error ? (
        <ThemedText variant="small" color={colors.red} style={{ marginTop: 4 }}>
          {error}
        </ThemedText>
      ) : null}

      <BottomSheetModal visible={choosing} onClose={() => setChoosing(false)}>
        <ThemedText variant="h3" color={colors.brandDeep} style={{ marginBottom: 2 }}>
          {label}
        </ThemedText>
        <ThemedText variant="small" color={colors.muted} style={{ marginBottom: 14 }}>
          Where should this come from?
        </ThemedText>
        <View style={styles.island}>
          {sources.map((s, i) => (
            <Pressable
              key={s.key}
              onPress={() => pick(s)}
              style={[styles.sourceRow, i > 0 && styles.sourceDivider]}
            >
              <Icon name={s.icon} size={20} color={colors.muted} />
              <ThemedText variant="body">{s.label}</ThemedText>
            </Pressable>
          ))}
        </View>
      </BottomSheetModal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 14 },
  label: { marginBottom: 6 },
  // Dashed rather than solid so an empty slot reads as "drop something here"
  // and never as a primary action competing with the Register button.
  dropzone: {
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "dashed",
    backgroundColor: colors.card,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  attached: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  thumb: { width: 38, height: 38, borderRadius: 8 },
  thumbDoc: { alignItems: "center", justifyContent: "center" },
  action: { paddingHorizontal: 4 },
  island: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: "hidden",
  },
  sourceRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  sourceDivider: { borderTopWidth: 1, borderTopColor: colors.line },
});
