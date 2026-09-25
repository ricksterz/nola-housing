import { fmt, fmtCompactCurrency } from "../lib/theme";

// When each parish's assessment rolls are open for review. Month is 0-based.
const REVIEW = {
  jefferson: { name: "Jefferson Parish", open: [7, 15], close: [8, 15], label: "Aug 15 – Sep 15" },
  orleans: { name: "Orleans Parish", open: [6, 15], close: [7, 15], label: "Jul 15 – Aug 15" },
};

function reviewStatus(parish, today = new Date()) {
  const r = REVIEW[parish];
  if (!r) return null;
  const y = today.getFullYear();
  const open = new Date(y, ...r.open);
  const close = new Date(y, r.close[0], r.close[1], 23, 59);
  if (today >= open && today <= close) return `${r.name}'s rolls are open for review now, through ${r.label.split("– ")[1]}.`;
  const next = today < open ? y : y + 1;
  return `${r.name}'s rolls are open for review ${r.label} each year; the next window opens ${r.label.split(" –")[0]}, ${next}.`;
}

/**
 * One distribution as a strip: whiskers at the 10th–90th percentile, a band for the middle half,
 * a median tick, and this parcel as a gold dot. The numbers are also in the table below it.
 */
function RangeStrip({ q, value, label }) {
  const [p10, p25, p50, p75, p90] = q;
  const lo = Math.min(p10, value);
  const hi = Math.max(p90, value);
  const pad = (hi - lo) * 0.04 || 1;
  const x = (v) => `${((v - (lo - pad)) / (hi - lo + 2 * pad)) * 100}%`;
  return (
    <div className="range-strip" role="img" aria-label={`${label}: this parcel ${fmt.currency(value)}; median ${fmt.currency(p50)}; middle half ${fmt.currency(p25)} to ${fmt.currency(p75)}.`}>
      <div className="range-track">
        <div className="range-whisker" style={{ left: x(p10), width: `calc(${x(p90)} - ${x(p10)})` }} title={`10th–90th percentile: ${fmt.currency(p10)} – ${fmt.currency(p90)}`} />
        <div className="range-band" style={{ left: x(p25), width: `calc(${x(p75)} - ${x(p25)})` }} title={`Middle half: ${fmt.currency(p25)} – ${fmt.currency(p75)}`} />
        <div className="range-median" style={{ left: x(p50) }} title={`Median: ${fmt.currency(p50)}`} />
        <div className="range-dot" style={{ left: x(value) }} title={`This parcel: ${fmt.currency(value)}`} />
      </div>
      <div className="range-axis">
        <span>{fmtCompactCurrency(p10)}</span>
        <span>{fmtCompactCurrency(p90)}</span>
      </div>
    </div>
  );
}

function feet(m) {
  const ft = m * 3.28084;
  return ft < 1000 ? `${Math.max(50, Math.round(ft / 50) * 50)} ft` : `${(ft / 5280).toFixed(1)} mi`;
}

function middle(q) {
  if (!q) return "—";
  const [p25, p50, p75] = q.length === 5 ? q.slice(1, 4) : q;
  return (
    <>
      <span className="compare-median">{fmt.currency(p50)}</span>
      <span className="compare-range">{`${fmtCompactCurrency(p25)}–${fmtCompactCurrency(p75)}`}</span>
    </>
  );
}

/** A parcel's assessed value against similar parcels nearby and in its subdivision. */
export default function AssessmentComparison({ p, comparison }) {
  const c = comparison;
  if (!c || !(c.nearby || c.subdivision) || !p.assessed_val) return null;
  const peers = `${c.zoning ? `other ${c.zoning}-zoned parcels` : "other parcels with no published zoning"} ${
    c.improved ? "that also have a building" : "that are also vacant land"
  }`;
  const groups = [
    c.nearby && {
      key: "nearby",
      title: `${c.nearby.n} nearest similar parcels`,
      sub: `within ${feet(c.nearby.reach_m)}`,
      g: c.nearby,
    },
    c.subdivision && {
      key: "subdivision",
      title: c.subdivision.name,
      sub: `${c.subdivision.n.toLocaleString()} similar parcels in the subdivision`,
      g: c.subdivision,
    },
  ].filter(Boolean);
  const residential = /^R/i.test(c.zoning || "");
  const review = reviewStatus(p.parish);

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h3 className="panel-title">How this assessment compares</h3>
          <div className="panel-subtitle">{`Against ${peers}.`}</div>
        </div>
      </div>

      {groups.map(({ key, title, sub, g }) => (
        <div key={key} className="compare-group">
          <div className="compare-title">
            <span>{title}</span>
            <span className="compare-sub">{sub}</span>
          </div>
          <p className="compare-headline">
            <span>{`Assessed at ${fmt.currency(p.assessed_val)}, higher than `}</span>
            <b>{`${g.below_pct}%`}</b>
            <span>{` of them.`}</span>
          </p>
          <RangeStrip q={g.assessed} value={p.assessed_val} label={title} />
        </div>
      ))}
      <div className="legend-inline compare-legend">
        <span><i className="legend-swatch range-key-dot" />This parcel</span>
        <span><i className="legend-swatch range-key-band" />Middle half</span>
        <span><i className="legend-swatch range-key-median" />Median</span>
        <span><i className="legend-swatch range-key-whisker" />10th–90th percentile</span>
      </div>

      <div className="table-wrap">
        <table className="data-table compare-table">
          <thead>
            <tr>
              <th />
              <th className="num">This parcel</th>
              {groups.map(({ key }) => (
                <th key={key} className="num">{key === "nearby" ? "Nearest" : "Subdivision"}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              ["Assessed", p.assessed_val, "assessed"],
              ["Land", p.land_val, "land"],
              ["Building", p.bld_val, "building"],
            ].map(([label, own, field]) => (
              <tr key={field}>
                <td>{label}</td>
                <td className="num">{own != null ? fmt.currency(own) : "—"}</td>
                {groups.map(({ key, g }) => (
                  <td key={key} className="num">{middle(g[field])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="stat-note" style={{ marginTop: 6 }}>Neighbor columns: median, then the middle half.</div>

      <ul className="text-list compare-notes">
        {residential && (
          <li>{`At Louisiana's 10% residential assessment ratio, ${fmt.currency(p.assessed_val)} assessed means the Assessor values this property at about ${fmt.currency(p.assessed_val * 10)}.`}</li>
        )}
        <li>These compare assessed values only. The Assessor doesn't publish living area or condition here, so a higher value can simply mean a bigger or newer building. Land values are the fairer like-for-like check, since lots in one subdivision tend to be valued alike.</li>
        {review && (
          <li>{`${review} To question a value, contact the Assessor's office while the rolls are open; recent sales of comparable homes carry the most weight. A formal appeal then goes to the parish Board of Review and, after that, the Louisiana Tax Commission.`}</li>
        )}
      </ul>
    </div>
  );
}
