
import { StyleSheet } from "react-native";

export const styles = StyleSheet.create({
  screen: { flex: 1, overflow: "hidden" },
  flex: { flex: 1 },
  scroll: { flexGrow: 1 },

  decor: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, overflow: "hidden" },
  ring: { position: "absolute", borderRadius: 999, borderWidth: 2, borderColor: "rgba(255,255,255,0.16)" },
  ringFill: { position: "absolute", borderRadius: 999, backgroundColor: "rgba(255,255,255,0.1)" },
  stripe: {
    position: "absolute",
    left: -50,
    bottom: "34%",
    width: 260,
    height: 14,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.12)",
    transform: [{ rotate: "-12deg" }],
  },

  hero: { paddingHorizontal: 28 },
  heroTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  heroTopCompact: { marginBottom: 0, gap: 12 },
  compactTitle: { flex: 1 },
  // No white backing tile any more — the logo (HEADER_LOGO, cut out on a
  // transparent background) sits straight on the hero gradient, matching
  // every page header (Shell.tsx's flatLogo/aId).
  logoTile: {
    width: 60,
    height: 60,
    alignItems: "center",
    justifyContent: "center",
  },
  logo: { width: 56, height: 56 },
  logoTileCompact: { width: 44, height: 44 },
  logoCompact: { width: 40, height: 40 },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.28)",
    alignItems: "center",
    justifyContent: "center",
  },
  chip: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.18)",
    marginBottom: 10,
  },
  chipText: { fontWeight: "700", letterSpacing: 1.4 },
  title: { fontSize: 34, lineHeight: 40, letterSpacing: -0.6 },

  body: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 8 },
  subtitle: { fontSize: 15, lineHeight: 21, marginBottom: 14 },

  fieldGroup: { marginBottom: 12 },
  fieldLabel: { fontSize: 14, fontWeight: "600", marginBottom: 6 },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    height: 56,
    borderRadius: 18,
    borderWidth: 2,
    paddingLeft: 10,
    paddingRight: 14,
  },
  // No focus-only shadow on purpose: toggling shadowColor/elevation/opacity on a
  // view that CONTAINS a TextInput flips it in and out of being a Fabric
  // "stacking context", which detaches and re-attaches its children —
  // Android then drops the input's focus and jumps to the next field
  // (see the diagnostics: FOCUS Username → BLUR → FOCUS Password …).
  fieldIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  fieldInput: { flex: 1, height: "100%", fontSize: 17, paddingVertical: 0 },
  eye: { padding: 6 },

  otpRow: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  otpBox: { flex: 1, height: 62, borderRadius: 16, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  otpHidden: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, opacity: 0.011, color: "transparent" },

  buttonShadow: { borderRadius: 18, shadowOpacity: 0.45, shadowRadius: 16, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
  buttonShadowOff: { shadowOpacity: 0, elevation: 0 },
  button: {
    height: 58,
    borderRadius: 18,
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  buttonLabel: { fontSize: 17, fontWeight: "700", letterSpacing: 0.2 },

  errorBox: { flexDirection: "row", alignItems: "flex-start", gap: 10, borderRadius: 14, padding: 12, marginBottom: 12 },
  errorText: { flex: 1, fontSize: 14, lineHeight: 20 },

  linkRight: { alignSelf: "flex-end", marginTop: -2, marginBottom: 14 },
  linkCenter: { alignSelf: "center", marginTop: 14, paddingVertical: 4 },
  linkText: { fontSize: 15, fontWeight: "600" },

  secureRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 12 },
  secureText: { fontSize: 13 },
});
