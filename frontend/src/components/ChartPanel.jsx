import { useState } from "react";
import { ResponsiveContainer } from "recharts";
import Table from "./Table";

// Every chart ships with its table twin (the WCAG-clean equivalent) behind a toggle.
export default function ChartPanel({ title, subtitle, children, rows, columns, actions, height, wide, className = "" }) {
  const [mode, setMode] = useState("chart");
  return (
    <div className={`panel${wide ? " panel--wide" : ""} ${className}`}>
      <div className="panel-head">
        <div>
          <h3 className="panel-title">{title}</h3>
          {subtitle && <div className="panel-subtitle">{subtitle}</div>}
        </div>
        <div className="chart-actions">
          {actions}
          {rows && columns && (
            <div className="seg" role="group" aria-label="View as">
              <button className={`seg-btn${mode === "chart" ? " is-active" : ""}`} onClick={() => setMode("chart")} aria-pressed={mode === "chart"}>
                Chart
              </button>
              <button className={`seg-btn${mode === "table" ? " is-active" : ""}`} onClick={() => setMode("table")} aria-pressed={mode === "table"}>
                Table
              </button>
            </div>
          )}
        </div>
      </div>
      {mode === "table" ? (
        <div style={{ maxHeight: 360, overflow: "auto" }}>
          <Table columns={columns} rows={rows} />
        </div>
      ) : (
        <div className="chart-box" style={height ? { height } : undefined}>
          <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
