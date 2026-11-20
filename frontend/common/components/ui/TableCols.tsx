type TableColsProps = {
  /** One entry per column, left to right: a number is a percentage of the table's width, a string
   * any CSS width ("120px"), and null leaves the column to its own CSS width (the ledger amount
   * columns) or an even share of whatever is left. */
  widths: (number | string | null)[];
};

/** A `.tbl` table's column widths. Every `.tbl` uses fixed layout (see `table.tbl` in app.css), so
 * these — not the rows on screen — decide how wide each column is: the columns hold still whatever
 * data a page, filter or refresh brings, and as percentages they scale with the screen. Goes first
 * inside the <table>, before <thead>. A table shown as stacked cards on small screens ignores it. */
export function TableCols({ widths }: TableColsProps) {
  return (
    <colgroup>
      {widths.map((w, i) => (
        <col key={i} style={w == null ? undefined : { width: typeof w === "number" ? `${w}%` : w }} />
      ))}
    </colgroup>
  );
}
