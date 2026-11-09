"use client";

import { fmt } from "@/common/utils/format";
import { TableCols } from "@/common/components/ui/TableCols";

export type FollowingEntryView = { id: number; paidOn: string; reference?: string; type?: string; current: number; suggested: number; needsChange?: boolean };

type Props = {
	entries: FollowingEntryView[];
	values: Record<number, string>; // what each entry becomes, as typed
	onChange: (id: number, value: string) => void;
};

/* The payments after an edited one that no longer fit the new balance: each is lowered to what it can still be (filled
 * in), and the amount can be lowered further — 0 removes the payment. Shown after the preview, before confirming. */
export function FollowingEntriesTable({ entries, values, onChange }: Props) {
	return (
		<div style={{ marginTop: 14 }}>
			<label className="f">Payments after this one</label>
			<p className="ccheck-hint" style={{ margin: "0 0 8px" }}>
				Nothing here changes unless you change it. Look at each payment and lower an amount if this edit means it should be different (0 removes it).
				{entries.some((f) => f.needsChange) ? " A payment marked in red no longer fits and has to be lowered before you can confirm." : ""}
			</p>
			<div className="tbl-wrap"><table className="tbl"><TableCols widths={[16, 44, 20, 20]} />
				<thead><tr><th>Date</th><th>Entry</th><th className="num">Now</th><th className="num">New amount</th></tr></thead>
				<tbody>
					{entries.map((f) => (
						<tr key={f.id}>
							<td>{(f.paidOn || "").slice(0, 10)}</td>
							<td>{f.type || f.reference || "—"}{f.needsChange && <span style={{ display: "block", color: "var(--red)", fontSize: "0.85em" }}>No longer fits — at most {fmt(f.suggested)}</span>}</td>
							<td className="num">{fmt(f.current)}</td>
							<td className="num" style={{ width: 120 }}>
								<input className="inp" type="number" min={0} max={f.current} value={values[f.id] ?? ""} style={{ textAlign: "right" }}
									onChange={(e) => onChange(f.id, e.target.value)} />
							</td>
						</tr>
					))}
				</tbody>
			</table></div>
		</div>
	);
}
