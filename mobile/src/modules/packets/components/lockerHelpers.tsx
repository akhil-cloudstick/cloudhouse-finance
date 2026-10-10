
import { C, Txt } from "@/common/components/ui";
import type { Locker } from "@/modules/lockers/types/locker-types";

// Locker detail (prototype #locker-detail-modal) and the create/edit locker
// form the old Lockers screen had, both as rise-up sheets.

export const errText = (msg: string | null) => (msg ? <Txt style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{msg}</Txt> : null);
export const lockerStatus = (l: Locker) => (!l.isActive ? "Inactive" : (l.occupied ?? 0) >= l.capacity ? "Full" : "Active");
