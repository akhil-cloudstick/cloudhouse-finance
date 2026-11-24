"use client";

import { useEffect } from "react";

/* Gives every plain `.tbl` a per-cell `data-label` (read from its header) and
 * the `tbl-auto` class, so at phone widths app.css can lay each row out as a
 * card with the column name on the left and the value on the right.
 *
 * Tables that already ship their own responsive layout (`tbl-cards`,
 * `tbl-stack`), the ornament entry grid (`orn-table`, full of inputs) and
 * tables without a header row are left alone. One observer mounted once in
 * the app shell, since tables are rendered by many pages and modals. */
const SKIP = ".tbl-cards, .tbl-stack, .orn-table, .tbl-no-cards";

function enhance(table: HTMLTableElement) {
	if (table.matches(SKIP)) return;
	const headRow = table.tHead?.rows[0];
	if (!headRow) return;
	const labels = Array.from(headRow.cells).map((th) => (th.textContent || "").trim());
	if (!labels.some(Boolean)) return;
	for (const tbody of Array.from(table.tBodies)) {
		for (const row of Array.from(tbody.rows)) {
			let col = 0;
			for (const td of Array.from(row.cells)) {
				const span = td.colSpan || 1;
				if (span === 1 && labels[col] && td.getAttribute("data-label") !== labels[col]) {
					td.setAttribute("data-label", labels[col]);
				}
				col += span;
			}
		}
	}
	table.classList.add("tbl-auto");
}

export function TableCardsObserver() {
	useEffect(() => {
		let raf = 0;
		function run() {
			raf = 0;
			document.querySelectorAll<HTMLTableElement>("table.tbl").forEach(enhance);
		}
		function schedule() {
			if (!raf) raf = requestAnimationFrame(run);
		}
		run();
		const mo = new MutationObserver(schedule);
		mo.observe(document.body, { childList: true, subtree: true });
		return () => {
			mo.disconnect();
			if (raf) cancelAnimationFrame(raf);
		};
	}, []);
	return null;
}
