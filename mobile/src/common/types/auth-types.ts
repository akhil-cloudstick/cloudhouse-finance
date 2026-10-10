import { Employee } from "@/modules/employees/types/employee-types";

export type LoginResponse = { token: string; employee: Employee };
export type QrLoginSession = { token: string; employee: Employee; businessCode: string };
