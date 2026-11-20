import { useEffect, useState } from "react";
import { getSchools } from "../api";
import { EVENTS, trackEvent } from "../lib/metrics";
import { SCHOOL_KINDS, SCHOOL_RADIUS_MI, SCHOOLS_SHOWN, admissionLabel, kindLabel, matchesKind, schoolLink, schoolsByDistance, schoolsForZipLink } from "../lib/schools";
import { fmt } from "../lib/theme";

function tuitionText(t) {
  if (!t) return null;
  const range = t.low === t.high ? fmt.currency(t.low) : `${fmt.currency(t.low)}–${fmt.currency(t.high)}`;
  return `Tuition ${range}${t.year ? ` (${t.year})` : ""}`;
}

function SchoolRow({ s, zip }) {
  const facts = [
    kindLabel(s),
    s.grades && `Grades ${s.grades}`,
    admissionLabel(s),
    s.letter_grade && `State grade ${s.letter_grade}`,
    tuitionText(s.tuition),
  ].filter(Boolean);
  return (
    <li className="school-row">
      <div className="school-main">
        <a href={schoolLink(s, zip)} target="_blank" rel="noreferrer" onClick={() => trackEvent(EVENTS.openSchools)}>
          {s.name} ↗
        </a>
        <span className="school-facts">{facts.join(" · ")}</span>
      </div>
      <span className="school-dist num">{`${s.miles < 0.1 ? "<0.1" : s.miles.toFixed(1)} mi`}</span>
    </li>
  );
}

// Every school near the address, filterable by kind (public, private, Catholic), from School Finder's list. It shows
// who is close and how each takes new students; whether this child can get in (grade, age, seats,
// zones, the citywide match) is School Finder's job, linked per school and for the whole ZIP.
export default function NearbySchools({ p }) {
  const [schools, setSchools] = useState(undefined);
  const [kind, setKind] = useState("all");
  const [shown, setShown] = useState(SCHOOLS_SHOWN);

  useEffect(() => {
    let live = true;
    getSchools().then((d) => live && setSchools(d?.schools || null));
    return () => {
      live = false;
    };
  }, []);

  if (schools === undefined || p.lat == null || p.lng == null) return null;
  const zip = p.zip_code;
  const all = schoolsForZipLink(zip);
  const allLink = (
    <a href={all} target="_blank" rel="noreferrer" onClick={() => trackEvent(EVENTS.openSchools)}>
      {zip ? `Every school near ${zip}, with your chances and key dates ↗` : "Open School Finder ↗"}
    </a>
  );
  if (!schools) {
    return (
      <div className="panel">
        <h3 className="panel-title">Schools</h3>
        <div className="stat-note">Seats, chances of getting in and tuition: {allLink}</div>
      </div>
    );
  }
  const ranked = schoolsByDistance(schools, p.lat, p.lng);
  const near = ranked.filter((s) => s.miles <= SCHOOL_RADIUS_MI);
  const counts = Object.fromEntries(SCHOOL_KINDS.map(([k]) => [k, near.filter((s) => matchesKind(s, k)).length]));
  const list = near.filter((s) => matchesKind(s, kind));
  // Nothing of this kind close by: name the nearest one anyway, so the answer isn't just "none".
  const nearest = list.length === 0 ? ranked.find((s) => matchesKind(s, kind)) : null;
  const anyZoned = list.some((s) => s.admission === "zoned");
  const kindWord = (SCHOOL_KINDS.find(([k]) => k === kind)?.[1] || "").toLowerCase();
  return (
    <div className="panel">
      <h3 className="panel-title">Schools near this address</h3>
      <div className="panel-subtitle" style={{ marginBottom: 10 }}>{`Within ${SCHOOL_RADIUS_MI} miles in a straight line, nearest first. From NOLA School Finder.`}</div>
      <div className="btn-row" role="tablist" aria-label="Kind of school" style={{ marginBottom: 6 }}>
        {SCHOOL_KINDS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={kind === k}
            className={`btn btn-sm${kind === k ? " is-active" : ""}`}
            onClick={() => {
              setKind(k);
              setShown(SCHOOLS_SHOWN);
            }}
          >
            {`${label} (${counts[k]})`}
          </button>
        ))}
      </div>
      {list.length > 0 ? (
        <ul className="school-list">
          {list.slice(0, shown).map((s) => (
            <SchoolRow key={`${s.slug}@${s.lat},${s.lng}`} s={s} zip={zip} />
          ))}
        </ul>
      ) : (
        <>
          <div className="stat-note">{`No ${kind === "all" ? "" : `${kindWord} `}schools within ${SCHOOL_RADIUS_MI} miles.${nearest ? " The nearest:" : ""}`}</div>
          {nearest && (
            <ul className="school-list">
              <SchoolRow s={nearest} zip={zip} />
            </ul>
          )}
        </>
      )}
      {list.length > shown && (
        <button type="button" className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => setShown(list.length)}>
          {`Show all ${list.length}`}
        </button>
      )}
      <div className="method-note" style={{ marginTop: 10 }}>
        {anyZoned && "Close by isn't the same as zoned: Jefferson Parish Schools assigns attendance-zone schools by address. "}
        {p.parish === "orleans" && "Most New Orleans public schools take students citywide through the NCAP application, wherever they live. "}
        {allLink}
      </div>
    </div>
  );
}
