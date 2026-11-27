
import { StyleSheet } from "react-native";
import { C } from "./base";

export const s = StyleSheet.create({
  searchWrap: { paddingHorizontal: 18, paddingBottom: 10 },
  search: {
    width: "100%",
    paddingVertical: 10,
    paddingHorizontal: 13,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.card,
    fontSize: 14.5,
    color: C.ink,
  },
  count: { paddingTop: 12, paddingHorizontal: 18, paddingBottom: 10, fontSize: 11.5, color: C.muted, fontWeight: "600" },
});
