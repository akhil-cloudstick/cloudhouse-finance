import { AppShell } from "@/product/layout/AppShell";

// Static route, not a dynamic segment — see app/app/layout.tsx for why.
// Every business/route/arg combination the rewrites and webstatic's
// sluggedPage funnel here renders this exact same shell; AppShell reads the
// real route from window.location via useAppRoute()/parsePath(), not from
// anything Next knows about this page.
export default function AppPage() {
  return <AppShell />;
}
