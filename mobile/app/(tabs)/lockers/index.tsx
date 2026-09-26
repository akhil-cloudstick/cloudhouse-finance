import { Redirect } from "expo-router";

// Lockers now live on the Packets & Lockers page (Lockers tab). This route
// only remains so older links to "/lockers" (e.g. the release review
// panel's "Check In to Locker" fallback) still land somewhere useful.
export default function LockersRedirect() {
  return <Redirect href={"/packets?tab=lockers" as never} />;
}
