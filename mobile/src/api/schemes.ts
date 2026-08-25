import { apiRequestEnveloped as apiRequest } from "./client";
import { Scheme } from "../types/scheme";

export function listSchemes(q?: string) {
  return apiRequest<Scheme[]>("/schemes", { params: { q } });
}

export function getScheme(id: number) {
  return apiRequest<Scheme>(`/schemes/${id}`);
}

export type SchemeInput = {
  name: string;
  branchId: number;
  interestRate: number;
  durationMonths: number;
  ltvPercent: number;
  interestMethod?: string;
  penalRate?: number;
  conditions?: string;
  isActive?: boolean;
};

export function createScheme(input: SchemeInput) {
  return apiRequest<Scheme>("/schemes", { method: "POST", body: input });
}

export function updateScheme(id: number, input: SchemeInput) {
  return apiRequest<Scheme>(`/schemes/${id}`, { method: "PUT", body: input });
}

export function toggleSchemeActive(id: number) {
  return apiRequest<Scheme>(`/schemes/${id}/toggle-active`, { method: "POST" });
}

export function calculateSchemeEligibility(id: number, goldWeight: number, goldRate: number) {
  return apiRequest<{ eligibleAmount: number }>(`/schemes/${id}/calculate`, {
    method: "POST",
    body: { goldWeight, goldRate },
  });
}
