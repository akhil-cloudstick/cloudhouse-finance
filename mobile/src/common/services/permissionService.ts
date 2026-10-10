import { apiRequestEnveloped } from "./httpClient";
import type { PermissionMap } from "@/common/types/permission-types";

export function fetchMyPermissions(employeeId: number): Promise<PermissionMap> {
  return apiRequestEnveloped<PermissionMap>(`/employees/${employeeId}/permissions/by-employee`);
}
