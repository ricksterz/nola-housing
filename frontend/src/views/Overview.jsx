import { useEffect, useState } from "react";
import { LineChart } from "recharts";
import { getTrend } from "../api";
import ChartPanel from "../components/ChartPanel";
import GeoPicker from "../components/GeoPicker";
import RangeToggle from "../components/RangeToggle";
import StatTile from "../components/StatTile";
import { Frame, MetricLine, currencyAxis } from "../components/charts";
import { geoKey, geoLabel, parseGeo } from "../lib/geo";
import { filterRange, monthLabel } from "../lib/rangeUtils";
import { fmt, fmtCompactCurrency } from "../lib/theme";

const DEFAULT_GEO = { geo_level: "zip", geo_id: "70005" };

export default function Overview({ ctx }) {
  const { geos, theme, scorecard, navigate, url } = ctx;
  const geo = parseGeo(url.geo) || DEFAULT_GEO;
  const [range, setRange] = useState(url.range || "2020");
  const [trend, setTrend] = useState(null);
  const [error, setError] = useState(null);
  // While a new geography loads, the previous render is held at reduced opacity
  // (no skeleton flash): "stale" is derived from the loaded series' own key.
  const stale = !!trend && (trend.geo_level !== geo.geo_level || trend.geo_id !== geo.geo_id);

  useEffect(() => {
    let alive = true;
    getTrend(geo.geo_level, geo.geo_id)
      .then((t) => {
        if (!alive) return;
        setTrend(t);
        setError(null);
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [geo.geo_level, geo.geo_id]);

  const row = scorecard?.rows?.find((r) => r.geo_level === geo.geo_level && r.geo_id === geo.geo_id);
  const data = trend ? filterRange(trend.series, range).map((d) => ({ ...d, monthLabel: monthLabel(d.month) })) : [];
  const label = geoLabel(geo, geos);

  return (
    <div>
      <GeoPicker geos={geos} selected={[geo]} onToggle={(g) => navigate({ geo: geoKey(g) })} />

      {row && (
        <div className="panel">
          <div className="panel-head">
            <div>
              <h3 className="panel-title">{label}</h3>
              <div className="panel-subtitle">
                Latest readings · Redfin {fmt.monthYear(row.price_month)} · Zillow {fmt.monthYear(row.zhvi_month)}
              </div>
            </div>
            <RangeToggle value={range} onChange={(r) => { setRange(r); navigate({ range: r }, { replace: true }); }} right={false} />
          </div>
          <div className="stat-grid">
            <StatTile label="Median sale price" value={fmtCompactCurrency(row.median_sale_price)} delta={row.price_yoy_pct} spark={row.spark_price} accent />
            <StatTile label="Typical home value" value={fmtCompactCurrency(row.zhvi)} delta={row.zhvi_yoy_pct} spark={row.spark_zhvi} note="Zillow ZHVI" />
            <StatTile label="Typical rent" value={row.zori != null ? `${fmt.currency(row.zori)}/mo` : "—"} delta={row.zori_yoy_pct} note="Zillow ZORI" />
            <StatTile label="Gross rent yield" value={fmt.pct(row.gross_yield_pct)} />
            <StatTile label="Homes sold" value={fmt.int(row.homes_sold)} delta={row.sold_yoy_pct} note="3-mo window" />
            <StatTile label="Median DOM" value={fmt.days(row.median_dom)} note={row.dom_yoy_delta != null ? `${row.dom_yoy_delta > 0 ? "+" : ""}${Math.round(row.dom_yoy_delta)} d YoY` : null} />
            <StatTile label="Active listings" value={fmt.int(row.active_listings)} delta={row.active_yoy_pct} upIsGood={false} spark={row.spark_active} />
            <StatTile label="Months of supply" value={fmt.num(row.months_supply)} />
            <StatTile label="Sale $/sqft" value={row.price_psf != null ? `$${Math.round(row.price_psf)}` : "—"} delta={row.psf_yoy_pct} />
            <StatTile label="Sale-to-list" value={fmt.pct(row.sale_to_list_ratio)} />
          </div>
        </div>
      )}

      {error && <div className="error">Error: {error}</div>}
      {!trend && !error && <div className="loading">Loading…</div>}

      {trend && (
        <div className={`panel-grid${stale ? " dim" : ""}`}>
          <ChartPanel
            title="Home value & sale price"
            subtitle="Zillow ZHVI (typical value) vs Redfin median sale price"
            rows={data}
            columns={[
              { key: "month", label: "Month", type: "monthYear" },
              { key: "zhvi", label: "ZHVI", type: "currency" },
              { key: "redfin_median_sale_price", label: "Median sale", type: "currency" },
            ]}
          >
            <LineChart data={data}>
              <Frame yFormat="currency" yAxis={currencyAxis} series={2} />
              <MetricLine metric="zhvi" name="Zillow ZHVI" theme={theme} />
              <MetricLine metric="redfin_median_sale_price" name="Redfin median sale" theme={theme} />
            </LineChart>
          </ChartPanel>

          <ChartPanel
            title="Typical rent"
            subtitle="Zillow Observed Rent Index (asking rents, smoothed)"
            rows={data}
            columns={[{ key: "month", label: "Month", type: "monthYear" }, { key: "zori", label: "ZORI", type: "currency" }]}
          >
            <LineChart data={data}>
              <Frame yFormat="currency" yAxis={{ ...currencyAxis, tickFormatter: (v) => `$${Math.round(v / 100) / 10}K` }} series={1} tooltipFormatter={(v) => `${fmt.currency(v)}/mo`} />
              <MetricLine metric="zori" name="ZORI" theme={theme} />
            </LineChart>
          </ChartPanel>

          <ChartPanel
            title="Days on market"
            subtitle="Median days from listing to contract (Redfin)"
            rows={data}
            columns={[{ key: "month", label: "Month", type: "monthYear" }, { key: "redfin_median_dom", label: "Median DOM", type: "days" }]}
          >
            <LineChart data={data}>
              <Frame yFormat="days" series={1} />
              <MetricLine metric="redfin_median_dom" name="Median DOM" theme={theme} />
            </LineChart>
          </ChartPanel>

          <ChartPanel
            title="New listings, pending & sold"
            subtitle="Monthly counts (Redfin, 3-month rolling window)"
            rows={data}
            columns={[
              { key: "month", label: "Month", type: "monthYear" },
              { key: "redfin_new_listings", label: "New", type: "int" },
              { key: "redfin_pending_sales", label: "Pending", type: "int" },
              { key: "redfin_homes_sold", label: "Sold", type: "int" },
            ]}
          >
            <LineChart data={data}>
              <Frame yFormat="int" series={3} />
              <MetricLine metric="redfin_new_listings" name="New listings" theme={theme} />
              <MetricLine metric="redfin_homes_sold" name="Homes sold" theme={theme} />
              <MetricLine metric="redfin_pending_sales" name="Pending sales" theme={theme} />
            </LineChart>
          </ChartPanel>

          <ChartPanel
            title="Active listings"
            subtitle="Inventory on the market at period end"
            rows={data}
            columns={[{ key: "month", label: "Month", type: "monthYear" }, { key: "redfin_active_listings", label: "Active", type: "int" }]}
          >
            <LineChart data={data}>
              <Frame yFormat="int" series={1} />
              <MetricLine metric="redfin_active_listings" name="Active listings" theme={theme} />
            </LineChart>
          </ChartPanel>

          <ChartPanel
            title="Months of supply"
            subtitle="Active listings ÷ monthly sales pace · under ~4 favors sellers, over ~6 favors buyers"
            rows={data}
            columns={[{ key: "month", label: "Month", type: "monthYear" }, { key: "redfin_months_supply", label: "Months", type: "num" }]}
          >
            <LineChart data={data}>
              <Frame yFormat="num" series={1} />
              <MetricLine metric="redfin_months_supply" name="Months of supply" theme={theme} />
            </LineChart>
          </ChartPanel>

          <ChartPanel
            title="Sale price per square foot"
            subtitle="Median $/sqft of closed sales (Redfin)"
            rows={data}
            columns={[{ key: "month", label: "Month", type: "monthYear" }, { key: "redfin_median_sale_price_psf", label: "$/sqft", type: "currency" }]}
          >
            <LineChart data={data}>
              <Frame yFormat="num" yAxis={{ ...currencyAxis, tickFormatter: (v) => `$${Math.round(v)}` }} series={1} tooltipFormatter={(v) => `$${Math.round(v)}/sqft`} />
              <MetricLine metric="redfin_median_sale_price_psf" name="$/sqft" theme={theme} />
            </LineChart>
          </ChartPanel>

          <ChartPanel
            title="Negotiation"
            subtitle="Sale-to-list ratio and share of sales above list price"
            rows={data}
            columns={[
              { key: "month", label: "Month", type: "monthYear" },
              { key: "redfin_sale_to_list_ratio", label: "Sale-to-list", type: "pct" },
              { key: "redfin_pct_sold_above_list", label: "Sold above list", type: "pct" },
            ]}
          >
            <LineChart data={data}>
              <Frame yFormat="pct" series={2} />
              <MetricLine metric="redfin_sale_to_list_ratio" name="Sale-to-list %" theme={theme} />
              <MetricLine metric="redfin_pct_sold_above_list" name="Sold above list %" theme={theme} />
            </LineChart>
          </ChartPanel>

          <ChartPanel
            title="Market heat"
            subtitle="Share of listings with a price cut vs. going under contract within 2 weeks (Redfin)"
            rows={data}
            columns={[
              { key: "month", label: "Month", type: "monthYear" },
              { key: "redfin_pct_price_drops", label: "Price cuts", type: "pct" },
              { key: "redfin_pct_off_market_2wk", label: "Off market in 2wk", type: "pct" },
            ]}
          >
            <LineChart data={data}>
              <Frame yFormat="pct" series={2} />
              <MetricLine metric="redfin_pct_price_drops" name="Price cuts %" theme={theme} />
              <MetricLine metric="redfin_pct_off_market_2wk" name="Off market in 2wk %" theme={theme} />
            </LineChart>
          </ChartPanel>
        </div>
      )}
    </div>
  );
}
