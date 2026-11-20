/* Report / statement exports made on this PC while the server cannot be reached. A module hands over a title, the column
 * headings and the rows it can read from the saved copy; this prints them (PDF through the print dialog) or saves them as an
 * Excel file (SpreadsheetML 2003 .xls: one worksheet, no extra libraries). Online the server makes every export as before. */

import { getBusinessProfile } from "@/modules/settings/services/businessProfileService";
import { downloadBlob } from "@/common/utils/print";
import { printHtml } from "./documents";

export type ExportCell = string | number | null | undefined;

export type ExportTable = {
	title: string;
	headers: string[];
	rows: ExportCell[][];
	/* a row shown bold under the table (e.g. Total), same width as the headers */
	totalsRow?: ExportCell[];
	/* "label: value" lines shown above the table */
	summary?: string[];
	/* e.g. "For the period 01-Nov-2026 to 06-Nov-2026" */
	subtitle?: string;
	/* file name without extension */
	filename?: string;
	/* false when the figures are not from a live answer; the header then says "Offline copy as of <date>" (default true) */
	offlineNote?: boolean;
};

const xml = (s: unknown) =>
	String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const isNum = (v: ExportCell): v is number => typeof v === "number" && Number.isFinite(v);

function dateLabel(): string {
	return new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function safeName(t: ExportTable): string {
	return (t.filename || t.title).replace(/[\\/:*?"<>|]+/g, "-").trim() || "export";
}

async function businessName(): Promise<string> {
	try {
		const p = await getBusinessProfile();
		return p.name || p.legalName || "";
	} catch {
		return "";
	}
}

function noteLine(t: ExportTable): string {
	return t.offlineNote === false ? "" : `Offline copy as of ${dateLabel()}`;
}

function fmtNum(n: number): string {
	return n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export async function printTable(t: ExportTable): Promise<void> {
	const name = await businessName();
	const numericCol = t.headers.map((_, c) => t.rows.length > 0 && t.rows.every((r) => r[c] == null || r[c] === "" || isNum(r[c])));
	const cell = (v: ExportCell, c: number, tag = "td") =>
		`<${tag}${numericCol[c] ? ' class="n"' : ""}>${isNum(v) ? xml(fmtNum(v)) : xml(v)}</${tag}>`;
	const head = `<tr>${t.headers.map((h, c) => cell(h, c, "th")).join("")}</tr>`;
	const body = t.rows.map((r) => `<tr>${t.headers.map((_, c) => cell(r[c], c)).join("")}</tr>`).join("")
		|| `<tr><td colspan="${Math.max(1, t.headers.length)}" class="e">No data.</td></tr>`;
	const total = t.totalsRow ? `<tr class="t">${t.headers.map((_, c) => cell(t.totalsRow![c], c)).join("")}</tr>` : "";
	const note = noteLine(t);
	const html = `<!doctype html><html><head><meta charset="utf-8"><title>${xml(t.title)}</title><style>
@page{size:A4 ${t.headers.length > 7 ? "landscape" : "portrait"};margin:12mm}
body{font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#111;margin:0}
h1{font-size:16px;margin:0 0 2px}h2{font-size:13px;margin:0 0 2px}.m{color:#555;margin:0 0 3px}
table{width:100%;border-collapse:collapse;margin-top:8px}
th,td{border:1px solid #999;padding:3px 5px;text-align:left;vertical-align:top}
th{background:#eee;font-weight:bold}.n{text-align:right}.t td{font-weight:bold;background:#f6f6f6}.e{text-align:center;color:#777}
thead{display:table-header-group}tr{page-break-inside:avoid}
</style></head><body>
${name ? `<h1>${xml(name)}</h1>` : ""}<h2>${xml(t.title)}</h2>
${t.subtitle ? `<p class="m">${xml(t.subtitle)}</p>` : ""}
${(t.summary ?? []).map((s) => `<p class="m">${xml(s)}</p>`).join("")}
<p class="m">Generated ${xml(dateLabel())}${note ? ` &middot; ${xml(note)}` : ""}</p>
<table><thead>${head}</thead><tbody>${body}${total}</tbody></table>
</body></html>`;
	await printHtml(html);
}

export function downloadExcelTable(t: ExportTable): void {
	const c = (v: ExportCell, bold = false) => {
		const s = bold ? ' ss:StyleID="b"' : "";
		if (v === null || v === undefined || v === "") return `<Cell${s}/>`;
		if (isNum(v)) return `<Cell${s}><Data ss:Type="Number">${v}</Data></Cell>`;
		return `<Cell${s}><Data ss:Type="String">${xml(v)}</Data></Cell>`;
	};
	const row = (cells: ExportCell[], bold = false) => `<Row>${cells.map((v) => c(v, bold)).join("")}</Row>`;
	const pre: string[] = [];
	const note = noteLine(t);
	pre.push(row([t.title], true));
	if (t.subtitle) pre.push(row([t.subtitle]));
	for (const s of t.summary ?? []) pre.push(row([s]));
	if (note) pre.push(row([note]));
	if (pre.length > 1 || note) pre.push("<Row/>");
	const sheet = (t.title.replace(/[\\/?*\[\]:]/g, " ").slice(0, 31).trim()) || "Report";
	const doc = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles><Style ss:ID="b"><Font ss:Bold="1"/></Style></Styles>
<Worksheet ss:Name="${xml(sheet)}"><Table>
${pre.join("\n")}
${row(t.headers, true)}
${t.rows.map((r) => row(r)).join("\n")}
${t.totalsRow ? row(t.totalsRow, true) : ""}
</Table></Worksheet></Workbook>`;
	downloadBlob(new Blob([doc], { type: "application/vnd.ms-excel" }), `${safeName(t)}.xls`);
}

/* PDF -> print dialog, xlsx -> .xls download. */
export async function exportTable(format: "pdf" | "xlsx", t: ExportTable): Promise<void> {
	if (format === "pdf") await printTable(t);
	else downloadExcelTable(t);
}

/* "loanNumber" -> "Loan Number" for a heading made from a field name. */
export function headingOf(key: string): string {
	return key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/^\w/, (m) => m.toUpperCase()).replace(/\s+\w/g, (m) => m.toUpperCase());
}

/* Rows that are plain objects -> a table with a heading per field (ids dropped, like the server's exports). */
export function tableFromObjects(title: string, rows: Record<string, unknown>[], opts: Partial<ExportTable> & { skip?: string[]; keys?: string[] } = {}): ExportTable {
	const skip = new Set(opts.skip ?? []);
	const keys = opts.keys ?? Object.keys(rows[0] ?? {}).filter((k) => !skip.has(k) && !/(^id$|Id$)/.test(k) && typeof (rows[0] as Record<string, unknown>)[k] !== "object");
	return {
		...opts,
		title,
		headers: keys.map(headingOf),
		rows: rows.map((r) => keys.map((k) => {
			const v = r[k];
			return typeof v === "number" || typeof v === "string" ? v : v == null ? "" : typeof v === "boolean" ? (v ? "Yes" : "No") : String(v);
		})),
	};
}
