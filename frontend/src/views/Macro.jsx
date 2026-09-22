import { useEffect, useMemo, useState } from "react";
import { Line, LineChart } from "recharts";
import { getCompare, getMacroIndex } from "../api";
import ChartPanel from "../components/ChartPanel";
import RangeToggle from "../components/RangeToggle";
import { Frame, lineProps, yAxisProps } from "../components/charts";
import { filterRange, monthLabel } from "../lib/rangeUtils";
import { fmt, seriesColor } from "../lib/theme";

const AREAS = [
  { id: "35380", label: "New Orleans–Metairie metro" },
  { id: "22051", label: "Jefferson Parish" },
  { id: "22071", label: "Orleans Parish" },
];

export default function Macro({ ctx }) {
  const { theme, meta } = ctx;
  const [range, setRange] = useState("10y");
  const [fred, setFred] = useState(null);
  const [compare, setCompare] = useState(null);

  useEffect(() => {
    getMacroIndex().then((r) => setFred(r.series || []));
    getCompare().then(setCompare).catch(() => setCompare({ geos: {} }));
  }, []);

  // Metro vs parish typical home values and rents, rebased to 100 so the three
  // can share one axis (a dual-axis chart would invent a correlation).
  const indexed = useMemo(() => {
    if (!compare) return { zhvi: [], zori: [] };
    const build = (key) => {
      const months = new Set();
      AREAS.forEach((a) => (compare.geos[a.id] || []).forEach((d) => d[key] != null && months.add(d.month)));
      const rows = filterRange(Array.from(months).sort().map((m) => ({ month: m })), range);
      const base = {};
      return rows.map(({ month }) => {
        const row = { month, monthLabel: monthLabel(month) };
        for (const a of AREAS) {
          const pt = (compare.geos[a.id] || []).find((d) => d.month === month);
          const v = pt?.[key];
          if (v != null) {
            if (base[a.id] == null) base[a.id] = v;
            row[a.id] = (v / base[a.id]) * 100;
          }
        }
        return row;
      });
    };
    return { zhvi: build("zhvi"), zori: build("zori") };
  }, [compare, range]);

  const fredRows = useMemo(() => {
    if (!fred) return [];
    return filterRange(fred.map((d) => ({ ...d, month: d.date.slice(0, 7), monthLabel: d.date.slice(0, 7) })), range);
  }, [fred, range]);
  const hasFred = fredRows.length > 0;
  const hpi = useMemo(() => {
    const base = {};
    const keys = ["nola_metro_hpi", "jefferson_hpi", "orleans_hpi"];
    return fredRows
      .filter((d) => keys.some((k) => d[k] != null))
      .map((d) => {
        const row = { month: d.month, monthLabel: d.monthLabel };
        for (const k of keys) {
          if (d[k] != null) {
            if (base[k] == null) base[k] = d[k];
            row[k] = (d[k] / base[k]) * 100;
          }
        }
        return row;
      });
  }, [fredRows]);
  const mortgage = fredRows.filter((d) => d.mortgage_rate_30yr != null);
  const idxCols = [{ key: "month", label: "Month", type: "monthYear" }, ...AREAS.map((a) => ({ key: a.id, label: a.label, type: "num" }))];

  return (
    <div>
      <div className="btn-row">
        <div className="stat-note">Metro and parish context. Indexed charts rebase every series to 100 at the start of the range.</div>
        <RangeToggle value={range} onChange={setRange} />
      </div>

      {!hasFred && (
        <div className="empty" style={{ marginBottom: 16 }}>
          <b>FRED series not loaded yet.</b> The mortgage rate, FHFA house price indexes (metro, Jefferson, Orleans) and
          realtor.com listing series appear here after the monthly refresh runs with a <code>FRED_API_KEY</code>{" "}
          repository secret. {meta?.sources?.fred?.fetched_at ? `Last fetch ${meta.sources.fred.fetched_at}.` : ""}
        </div>
      )}

      <div className="panel-grid">
        <ChartPanel title="Typical home value · indexed" subtitle="Zillow ZHVI, metro vs each parish, = 100 at range start" rows={indexed.zhvi} columns={idxCols}>
          <LineChart data={indexed.zhvi}>
            <Frame yFormat="num" yAxis={{ ...yAxisProps, domain: ["auto", "auto"] }} series={3} tooltipFormatter={(v) => fmt.num(v)} />
            {AREAS.map((a, i) => (
              <Line key={a.id} {...lineProps} dataKey={a.id} name={a.label} stroke={seriesColor(i, theme)} />
            ))}
          </LineChart>
        </ChartPanel>
        <ChartPanel title="Typical rent · indexed" subtitle="Zillow ZORI, metro vs each parish, = 100 at range start" rows={indexed.zori} columns={idxCols}>
          <LineChart data={indexed.zori}>
            <Frame yFormat="num" yAxis={{ ...yAxisProps, domain: ["auto", "auto"] }} series={3} tooltipFormatter={(v) => fmt.num(v)} />
            {AREAS.map((a, i) => (
              <Line key={a.id} {...lineProps} dataKey={a.id} name={a.label} stroke={seriesColor(i, theme)} />
            ))}
          </LineChart>
        </ChartPanel>

        {hasFred && (
          <>
            <ChartPanel title="30-year mortgage rate" subtitle="Freddie Mac PMMS weekly average (FRED MORTGAGE30US)" rows={mortgage} columns={[{ key: "date", label: "Week", type: "date" }, { key: "mortgage_rate_30yr", label: "Rate", type: "pct" }]}>
              <LineChart data={mortgage}>
                <Frame yFormat="pct" yAxis={{ ...yAxisProps, domain: ["auto", "auto"] }} series={1} tooltipFormatter={(v) => fmt.pct(v, 2)} />
                <Line {...lineProps} dataKey="mortgage_rate_30yr" name="30-yr rate" stroke={seriesColor(0, theme)} />
              </LineChart>
            </ChartPanel>
            <ChartPanel title="FHFA house price index · indexed" subtitle="All-transactions HPI: metro (quarterly), Jefferson & Orleans (annual), = 100 at range start" rows={hpi} columns={[{ key: "month", label: "Period", type: "monthYear" }, { key: "nola_metro_hpi", label: "Metro", type: "num" }, { key: "jefferson_hpi", label: "Jefferson", type: "num" }, { key: "orleans_hpi", label: "Orleans", type: "num" }]}>
              <LineChart data={hpi}>
                <Frame yFormat="num" yAxis={{ ...yAxisProps, domain: ["auto", "auto"] }} series={3} tooltipFormatter={(v) => fmt.num(v)} />
                <Line {...lineProps} dataKey="nola_metro_hpi" name="Metro" stroke={seriesColor(0, theme)} />
                <Line {...lineProps} dataKey="jefferson_hpi" name="Jefferson Parish" stroke={seriesColor(1, theme)} />
                <Line {...lineProps} dataKey="orleans_hpi" name="Orleans Parish" stroke={seriesColor(2, theme)} />
              </LineChart>
            </ChartPanel>
            <ChartPanel title="Metro listings · realtor.com via FRED" subtitle="Active listings and median days on market for the MSA" rows={fredRows.filter((d) => d.nola_active_listings != null)} columns={[{ key: "month", label: "Month", type: "monthYear" }, { key: "nola_active_listings", label: "Active", type: "int" }, { key: "nola_median_dom", label: "Median DOM", type: "days" }]}>
              <LineChart data={fredRows.filter((d) => d.nola_active_listings != null)}>
                <Frame yFormat="int" series={1} />
                <Line {...lineProps} dataKey="nola_active_listings" name="Active listings" stroke={seriesColor(0, theme)} />
              </LineChart>
            </ChartPanel>
            <ChartPanel title="Metro median list price · realtor.com via FRED" subtitle="Median listing price for the MSA" rows={fredRows.filter((d) => d.nola_median_list_price != null)} columns={[{ key: "month", label: "Month", type: "monthYear" }, { key: "nola_median_list_price", label: "Median list", type: "currency" }]}>
              <LineChart data={fredRows.filter((d) => d.nola_median_list_price != null)}>
                <Frame yFormat="currency" yAxis={{ ...yAxisProps, domain: ["auto", "auto"], tickFormatter: (v) => `$${Math.round(v / 1000)}K`, width: 54 }} series={1} />
                <Line {...lineProps} dataKey="nola_median_list_price" name="Median list price" stroke={seriesColor(1, theme)} />
              </LineChart>
            </ChartPanel>
          </>
        )}
      </div>
    </div>
  );
}
