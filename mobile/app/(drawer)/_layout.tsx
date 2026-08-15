import { Drawer } from "expo-router/drawer";
import { colors } from "../../src/theme/colors";
import { FloatingHeader } from "../../src/components/FloatingHeader";
import { AppDrawerContent } from "../../src/components/AppDrawerContent";

// Sidebar/drawer nav — grouped custom content (AppDrawerContent) mirroring
// frontend/components/Sidebar.tsx's sectioned module list, instead of one
// flat always-visible list.
//
// Header: every screen gets exactly ONE header, rendered by FloatingHeader
// as a floating rounded "island" bar (menu/back on the left, profile +
// log out on the right). Screens below that own a nested Stack (their
// folder has its own _layout.tsx — customers, loans, auctions, banks,
// cash, employees, lockers, packets, schemes, settings) set
// `headerShown: false` here so the drawer doesn't also render a header on
// top of the Stack's — that duplicate-header stacking was the earlier bug.
// Screens with no nested Stack (dashboard, gold-rates, ornament-types,
// purity-standards, reminders, reports) get their header from the drawer
// directly via `header` below.
export default function DrawerLayout() {
  return (
    <Drawer
      drawerContent={(props) => <AppDrawerContent {...props} />}
      screenOptions={{
        header: ({ options, route, navigation }) => (
          <FloatingHeader title={options.title ?? route.name} navigation={navigation} />
        ),
        drawerStyle: { backgroundColor: colors.card, width: 270 },
      }}
    >
      <Drawer.Screen name="dashboard" options={{ title: "Dashboard", drawerLabel: "Dashboard" }} />
      <Drawer.Screen
        name="customers"
        options={{ title: "Customers", drawerLabel: "Customers", headerShown: false }}
      />
      <Drawer.Screen name="loans" options={{ title: "Loans", drawerLabel: "Loans", headerShown: false }} />
      <Drawer.Screen
        name="auctions"
        options={{ title: "Auctions", drawerLabel: "Auctions", headerShown: false }}
      />
      <Drawer.Screen
        name="banks"
        options={{ title: "Bank Pledge", drawerLabel: "Bank Pledge", headerShown: false }}
      />
      <Drawer.Screen
        name="cash"
        options={{ title: "Cash & Expenses", drawerLabel: "Cash & Expenses", headerShown: false }}
      />
      <Drawer.Screen
        name="employees"
        options={{ title: "Employees", drawerLabel: "Employees", headerShown: false }}
      />
      <Drawer.Screen name="gold-rates" options={{ title: "Gold Rates", drawerLabel: "Gold Rates" }} />
      <Drawer.Screen
        name="schemes"
        options={{ title: "Schemes", drawerLabel: "Schemes", headerShown: false }}
      />
      <Drawer.Screen
        name="purity-standards"
        options={{ title: "Purity Standards", drawerLabel: "Purity Standards" }}
      />
      <Drawer.Screen
        name="ornament-types"
        options={{ title: "Ornament Types", drawerLabel: "Ornament Types" }}
      />
      <Drawer.Screen
        name="lockers"
        options={{ title: "Lockers", drawerLabel: "Lockers", headerShown: false }}
      />
      <Drawer.Screen
        name="packets"
        options={{ title: "Packets", drawerLabel: "Packets", headerShown: false }}
      />
      <Drawer.Screen name="reminders" options={{ title: "Reminders", drawerLabel: "Reminders" }} />
      <Drawer.Screen name="reports" options={{ title: "Reports", drawerLabel: "Reports" }} />
      <Drawer.Screen
        name="settings"
        options={{ title: "Settings", drawerLabel: "Settings", headerShown: false }}
      />
      <Drawer.Screen
        name="branches"
        options={{ title: "Branches", drawerLabel: "Branches", headerShown: false }}
      />
    </Drawer>
  );
}
