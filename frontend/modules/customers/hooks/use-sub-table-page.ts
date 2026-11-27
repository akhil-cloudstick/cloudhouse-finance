"use client";

import { useCallback, useEffect, useState } from "react";

// `range` is the shared from/to opened-date window; changing it resets the table back to page 1.
export function useSubTablePage<T>(
	fetchPage: (page: number, range?: { from?: string; to?: string; search?: string }) => Promise<{ items: T[]; hasMore: boolean; total: number }>,
	range: { from?: string; to?: string; search?: string },
	ready: boolean
) {
	const [items, setItems] = useState<T[]>([]);
	const [loading, setLoading] = useState(true);
	const [page, setPage] = useState(1);
	const [hasMore, setHasMore] = useState(false);
	const [total, setTotal] = useState(0);
	const from = range.from;
	const to = range.to;
	const search = range.search;

	const refresh = useCallback(() => {
		if (!ready) return;
		setLoading(true);
		fetchPage(page, { from, to, search })
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
	}, [fetchPage, page, from, to, search, ready]);

	useEffect(() => {
		refresh();
	}, [refresh]);

	// eslint-disable-next-line react-hooks/exhaustive-deps
	useEffect(() => setPage(1), [from, to, search]);

	return { items, loading, page, setPage, hasMore, total, refresh };
}
