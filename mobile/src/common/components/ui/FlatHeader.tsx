import { Image, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Txt } from "./Txt";
import { PIcon } from "./PIcon";
import { HEADER_LOGO } from "@/common/config/brand";
import { HeroBackground } from "./HeroBackground";
import { useShell, s } from "./shellContext";

type HeaderIcon = { icon: string; onPress: () => void; label?: string; dot?: boolean };
type FlatHeaderProps = {
  title: string;
  subtitle?: string;
  /** Show the back button (router.back() unless onBack is given). */
  back?: boolean;
  onBack?: () => void;
  icons?: HeaderIcon[];
};

/** .flat-header — every page except the Dashboard. New loans are created
 * from the Loans page's + button, the centre Loans tab, or the Dashboard's
 * quick action — not from page headers. */
export function FlatHeader({
  title,
  subtitle,
  back,
  onBack,
  icons = [],
}: FlatHeaderProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { openProfile } = useShell();
  return (
    <View style={[s.flatHeader, { paddingTop: insets.top + 12 }]}>
      <HeroBackground />
      <View style={s.flatTopRow}>
        {back ? (
          <Pressable
            style={s.backBtn}
            hitSlop={6}
            accessibilityLabel="Back"
            onPress={() => (onBack ? onBack() : router.canGoBack() ? router.back() : router.replace("/(tabs)/dashboard"))}
          >
            <PIcon name="back" color="#fff" />
          </Pressable>
        ) : null}
        {/* The logo opens the profile sheet (sign out) on every page. */}
        <Pressable onPress={openProfile} hitSlop={4} accessibilityLabel="Profile and sign out">
          <Image source={HEADER_LOGO} style={s.flatLogo} resizeMode="contain" />
        </Pressable>
        <View style={s.flatTitleBlock}>
          <Txt style={s.flatTitle} numberOfLines={1}>
            {title}
          </Txt>
          {subtitle ? (
            <Txt style={s.flatSub} numberOfLines={1}>
              {subtitle}
            </Txt>
          ) : null}
        </View>
        <View style={s.flatIcons}>
          {icons.map((ic) => (
            <Pressable key={ic.icon} style={s.flatIcBtn} onPress={ic.onPress} hitSlop={4} accessibilityLabel={ic.label ?? ic.icon}>
              <PIcon name={ic.icon} color="#fff" />
              {ic.dot ? <View style={s.flatDot} /> : null}
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}
