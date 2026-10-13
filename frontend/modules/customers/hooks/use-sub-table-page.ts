"use client";

import { useCallback, useEffect, useState } from "react";

/* Server-side pager for the 360 view's sub-tables: each of the 5 tables
 * below fetches its own page (limit 10) from its own
 * GET /customers/:id/{...} endpoint (see customerService.ts) rather than
 * slicing rows already pulled in by getCustomer360 — a real network
 * round-trip per page, following the same limit/offset + {items, hasMore}
 * convention as Requests.tsx. `range` is the shared from/to opened-date
 * window; changing it resets the table back to page 1. */
export function useSubTablePage<T>(
  fetchPage: (page: number, range?: { from?: string; to?: string }) => Promise<{ items: T[]; hasMore: boolean; total: number }>,
  range: { from?: string; to?: string },
  ready: boolean
) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const from = range.from;
  const to = range.to;

  const refresh = useCallback(() => {
    if (!ready) return;
    setLoading(true);
    fetchPage(page, { from, to })
      .then((res) => {
        setItems(res.items);
        setHasMore(res.hasMore);
        setTotal(res.total);
      })
      .catch(() => {
        setItems([]);
        setHasMore(false);
        setTotal(0);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchPage, page, from, to, ready]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setPage(1), [from, to]);

  return { items, loading, page, setPage, hasMore, total, refresh };
}
