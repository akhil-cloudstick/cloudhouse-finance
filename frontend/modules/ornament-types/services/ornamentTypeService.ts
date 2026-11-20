import { apiFetchEnveloped as apiFetch } from "@/common/services/httpClient";
import { enqueueAndWait, newEntry, offlineReady } from "@/common/offline";
import { currentActor } from "@/common/offline/actor";
import { localRequestId } from "@/common/offline/requestRef";
import type { BackendOrnamentType } from "@/modules/ornament-types/types/ornament-type-types";

/* Server-side search (by name) — backs the ornament-type SearchableSelect
 * in NewLoan.tsx. */
export async function searchOrnamentTypes(q: string): Promise<BackendOrnamentType[]> {
	const rec = await apiFetch<BackendOrnamentType[]>(`/ornament-types?q=${encodeURIComponent(q)}`);
	return rec || [];
}

/* Page-shaped wrapper for SearchableSelect's fetchFn contract. The
 * ornament-type list is unpaginated on the backend (it's typically small),
 * so this always returns everything on page 0 and reports no further
 * pages — SearchableSelect's infinite scroll simply never fires here. */
export async function searchOrnamentTypesPage(q: string, page: number): Promise<{ items: BackendOrnamentType[]; hasMore: boolean }> {
	if (page > 0) return { items: [], hasMore: false };
	return { items: await searchOrnamentTypes(q), hasMore: false };
}

/* Creates a new ornament type, or — if one with the same name (case
 * insensitive) already exists — returns the existing row instead (the
 * backend's find-or-create behaviour). */
export async function createOrnamentType(name: string): Promise<BackendOrnamentType> {
	// Desktop with offline mode running: an existing type of that name is reused; otherwise the type is queued for the server
	// and offered at once under a local id (loans carry the ornament's name, not the type's id, so nothing depends on it).
	if (offlineReady()) {
		const clean = name.trim();
		const existing = (await searchOrnamentTypes(clean).catch(() => [] as BackendOrnamentType[])).find((t) => t.name.toLowerCase() === clean.toLowerCase());
		if (existing) return existing;
		const entry = newEntry("POST", "/ornament-types", { name: clean }, currentActor());
		await enqueueAndWait(entry, () => undefined, () => undefined);
		const now = new Date().toISOString();
		return { id: localRequestId(entry.id), name: clean, createdAt: now, updatedAt: now };
	}
	return apiFetch<BackendOrnamentType>("/ornament-types", {
		method: "POST",
		body: JSON.stringify({ name }),
	});
}

/* Removes a type from the master list; loans already pledged with it keep their ornament. */
export async function deleteOrnamentType(id: number): Promise<void> {
  await apiFetch<{ deleted: boolean }>(`/ornament-types/${id}`, { method: "DELETE" });
}
