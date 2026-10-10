import { Pressable, View } from "react-native";
import { initialsOf } from "./base";
import { Txt } from "./Txt";
import { s } from "./rowContext";

type HitProps = { name: string; meta: string; tag?: string; onPress: () => void };

/** .hit — global search result. */
export function Hit({ name, meta, tag, onPress }: HitProps) {
  return (
    <Pressable style={s.hit} onPress={onPress}>
      <View style={s.actAvatar}>
        <Txt style={s.actAvatarTxt}>{initialsOf(name)}</Txt>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt style={s.actTitle} numberOfLines={1}>
          {name}
        </Txt>
        <Txt style={s.actSub} numberOfLines={1}>
          {meta}
        </Txt>
      </View>
      {tag ? (
        <View style={s.hitTag}>
          <Txt style={s.hitTagTxt}>{tag}</Txt>
        </View>
      ) : null}
    </Pressable>
  );
}
