import { Animated } from "react-native";

// Primary tab routes in bar order — the pages a horizontal swipe moves between.
export const PRIMARY_ROUTES = ["dashboard", "customers", "loans", "schemes"];

// The one position that places the four primary pages AND lights the tab bar,
// so they cannot drift apart: 1.4 = 40% of the way from Customers to Loans.
// Page i sits at (i - pos) screen widths; tab i is lit by how close pos is to i.
// A finger swipe writes it directly; a tap or a release animates it.
export const swipe = {
  pos: new Animated.Value(0),
  // True from the first drag frame until the release has settled.
  active: false,
};
