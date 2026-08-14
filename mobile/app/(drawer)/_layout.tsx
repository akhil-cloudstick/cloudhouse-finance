import { Drawer } from "expo-router/drawer";
import { colors } from "../../src/theme/colors";
import { typeScale } from "../../src/theme/typography";
import { useIsAdministrator } from "../../src/auth/AuthContext";

// Sidebar/drawer nav — replaces the earlier bottom-tabs + Dashboard "More
// grid" per your request, mirroring frontend/components/Sidebar.tsx's flat
// always-visible module list. Administrator-only rows (Employees, Settings)
// are hidden via `drawerItemStyle: { display: "none" }` rather than removed,
// so the route still resolves if linked to directly but doesn't clutter the
// sidebar for other roles — same "hide, don't just rely on styling" intent
// as the web sidebar's role checks.
export default function DrawerLayout() {
  const isAdmin = useIsAdministrator();
  const hidden = { display: "none" as const };

  return (
    <Drawer
      screenOptions={{
        headerStyle: { backgroundColor: colors.ivory },
        headerTitleStyle: { fontFamily: typeScale.h3.fontFamily, color: colors.ink },
        drawerActiveTintColor: colors.goldDeep,
        drawerInactiveTintColor: colors.ink,
        drawerActiveBackgroundColor: colors.goldPale,
        drawerStyle: { backgroundColor: colors.card, width: 260 },
        drawerLabelStyle: { fontFamily: typeScale.label.fontFamily, fontSize: 14 },
      }}
    >
      <Drawer.Screen name="dashboard" options={{ title: "Dashboard", drawerLabel: "Dashboard" }} />
      <Drawer.Screen name="customers" options={{ title: "Customers", drawerLabel: "Customers" }} />
      <Drawer.Screen name="loans" options={{ title: "Loans", drawerLabel: "Loans" }} />
      <Drawer.Screen name="auctions" options={{ title: "Auctions", drawerLabel: "Auctions" }} />
      <Drawer.Screen name="banks" options={{ title: "Bank Pledge", drawerLabel: "Bank Pledge" }} />
      <Drawer.Screen name="cash" options={{ title: "Cash & Expenses", drawerLabel: "Cash & Expenses" }} />
      <Drawer.Screen
        name="employees"
        options={{ title: "Employees", drawerLabel: "Employees", drawerItemStyle: isAdmin ? undefined : hidden }}
      />
      <Drawer.Screen name="gold-rates" options={{ title: "Gold Rates", drawerLabel: "Gold Rates" }} />
      <Drawer.Screen name="schemes" options={{ title: "Schemes", drawerLabel: "Schemes" }} />
      <Drawer.Screen
        name="purity-standards"
        options={{ title: "Purity Standards", drawerLabel: "Purity Standards" }}
      />
      <Drawer.Screen
        name="ornament-types"
        options={{ title: "Ornament Types", drawerLabel: "Ornament Types" }}
      />
      <Drawer.Screen name="lockers" options={{ title: "Lockers", drawerLabel: "Lockers" }} />
      <Drawer.Screen name="packets" options={{ title: "Packets", drawerLabel: "Packets" }} />
      <Drawer.Screen name="reminders" options={{ title: "Reminders", drawerLabel: "Reminders" }} />
      <Drawer.Screen name="reports" options={{ title: "Reports", drawerLabel: "Reports" }} />
      <Drawer.Screen
        name="settings"
        options={{ title: "Settings", drawerLabel: "Settings", drawerItemStyle: isAdmin ? undefined : hidden }}
      />
    </Drawer>
  );
}
