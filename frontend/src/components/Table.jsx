import { fmt } from "../lib/theme";

// columns: [{ key, label, type: 'currency'|'compact'|'date'|'num'|'int'|'pct'|'raw', align }]
// `label` names the table for screen readers; its scroll box is focusable so a keyboard can
// scroll a table wider than the screen.
export default function Table({ columns, rows, onRowClick, label = "Data table" }) {
  if (!rows || rows.length === 0) {
    return <div className="loading">No data</div>;
  }
  const formatters = {
    currency: fmt.currency,
    compact: fmt.compact,
    date: fmt.date,
    monthYear: fmt.monthYear,
    num: fmt.num,
    int: fmt.int,
    pct: fmt.pct,
    signedPct: fmt.signedPct,
    days: fmt.days,
  };
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label={label}>
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.type && c.type !== "raw" && c.type !== "date" ? "num" : ""}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={onRowClick ? "clickable" : ""} onClick={onRowClick ? () => onRowClick(row) : undefined}>
              {columns.map((c) => {
                const f = formatters[c.type] || fmt.raw;
                return (
                  <td key={c.key} className={c.type && c.type !== "raw" && c.type !== "date" ? "num" : ""}>
                    {f(row[c.key])}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
