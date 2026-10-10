import { FlatList, FlatListProps } from "react-native";
import { SheetScrollView } from "./SheetScrollView";

/** FlatList variant of SheetScrollView. */
export function SheetFlatList<T>(props: FlatListProps<T>) {
  return <FlatList {...props} renderScrollComponent={(p) => <SheetScrollView {...p} />} />;
}
