import { useMemo, useState } from "react";
import { keepPreviousData, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useDebouncedValue } from "./use-debounced-value";
import { useRefetchOnFocus } from "./use-refetch-on-focus";
import { usePersistedState } from "./use-persisted-state";

export type ServerPage<T> = { items: T[] | null; hasMore: boolean; total?: number };

export const PAGE_SIZE = 10;

/**
 * One hook for every table in the staff app. Pages come from the backend
 * (`limit`/`offset`, house opt-in paging) and search + filters are sent as
 * query params — nothing is ever filtered on the phone (see src/common/services/httpClient.ts).
 *
 * The search text is debounced (350 ms) and sent as `q`; any change to it or
 * to `filters` restarts from page one (both are part of the query key).
 */
export function useServerList<T, F extends Record<string, unknown> = Record<string, unknown>>({
  key,
  fetchPage,
  filters,
  enabled = true,
  pageSize = PAGE_SIZE,
  fresh = false,
  persistKey,
}: {
  key: unknown[];
  fetchPage: (params: F & { q?: string; limit: number; offset: number }) => Promise<ServerPage<T>>;
  filters?: F;
  enabled?: boolean;
  pageSize?: number;
  /** Drop any cached pages when this list mounts, so it always loads fresh
   * (with the buffering spinner) instead of flashing stale rows. */
  fresh?: boolean;
  /** Keep the search text under this key so it survives leaving the screen. */
  persistKey?: string;
}) {
  const qc = useQueryClient();
  // Runs once, before the query subscribes.
  useState(() => {
    if (fresh) qc.removeQueries({ queryKey: key });
    return null;
  });
  const [search, setSearch] = usePersistedState<string>(persistKey ? `search:${persistKey}` : null, "");
  const q = useDebouncedValue(search.trim());

  const query = useInfiniteQuery({
    queryKey: [...key, "page", q, filters ?? {}],
    enabled,
    initialPageParam: 0,
    // Keep the previous rows on screen (dimmed, with the buffering spinner)
    // while a new search/filter result loads, instead of flashing empty.
    placeholderData: keepPreviousData,
    queryFn: ({ pageParam }) =>
      fetchPage({ ...(filters ?? ({} as F)), ...(q ? { q } : {}), limit: pageSize, offset: pageParam as number }),
    getNextPageParam: (last, all) => (last?.hasMore ? all.length * pageSize : undefined),
  });

  useRefetchOnFocus(query.refetch);

  const items = useMemo(() => query.data?.pages.flatMap((p) => p?.items ?? []) ?? [], [query.data]);
  const total = query.data?.pages[0]?.total;

  return {
    items,
    total,
    search,
    setSearch,
    /** First load, or a search/filter change still resolving. */
    isLoading: query.isLoading || (query.isFetching && query.isPlaceholderData),
    isRefreshing: query.isRefetching && !query.isFetchingNextPage && !query.isPlaceholderData,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: !!query.hasNextPage,
    fetchNextPage: () => {
      if (query.hasNextPage && !query.isFetchingNextPage) query.fetchNextPage();
    },
    refetch: query.refetch,
    error: query.error,
  };
}

export type ServerList<T> = ReturnType<typeof useServerList<T>>;
