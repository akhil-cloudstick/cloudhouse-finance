import { Redirect } from "expo-router";
import { useAuth } from "../src/auth/AuthContext";

// The app launches at "/" (cloudhouse:///), which had no screen of its own —
// RootNavigation's useEffect redirect was the only thing moving it on, and in
// a release build that can fire before the router has mounted and be dropped,
// leaving the user on Expo Router's "Unmatched Route" page. This route makes
// "/" resolve on its own. RootNavigation only renders the <Slot> once auth has
// finished loading, so `employee` is already settled here.
export default function Index() {
  const { employee } = useAuth();
  return <Redirect href={employee ? "/(tabs)/dashboard" : "/(auth)/login"} />;
}
