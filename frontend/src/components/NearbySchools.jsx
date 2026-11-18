import { useEffect, useState } from "react";
import { getSchools } from "../api";
import { EVENTS, trackEvent } from "../lib/metrics";
import { SCHOOL_RADIUS_MI, admissionLabel, kindLabel, nearbySchools, schoolLink, schoolsForZipLink } from "../lib/schools";
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

// Schools near the address, public and private side by side, from School Finder's list. It shows
// who is close and how each takes new students; whether this child can get in (grade, age, seats,
// zones, the citywide match) is School Finder's job, linked per school and for the whole ZIP.
export default function NearbySchools({ p }) {
  const [schools, setSchools] = useState(undefined);

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
  const near = nearbySchools(schools, p.lat, p.lng);
  const anyZoned = near.public.some((s) => s.admission === "zoned");
  const groups = [
    ["Public", near.public],
    ["Private and Catholic", near.private],
  ];
  return (
    <div className="panel">
      <h3 className="panel-title">Schools near this address</h3>
      <div className="panel-subtitle" style={{ marginBottom: 12 }}>{`Within ${SCHOOL_RADIUS_MI} miles in a straight line, nearest first. From NOLA School Finder.`}</div>
      <div className="school-groups">
        {groups.map(([title, list]) => (
          <div key={title} className="school-group">
            <div className="stat-section-title">{title}</div>
            {list.length > 0 ? (
              <ul className="school-list">
                {list.map((s) => (
                  <SchoolRow key={s.slug} s={s} zip={zip} />
                ))}
              </ul>
            ) : (
              <div className="stat-note">{`None within ${SCHOOL_RADIUS_MI} miles.`}</div>
            )}
          </div>
        ))}
      </div>
      <div className="method-note" style={{ marginTop: 10 }}>
        {anyZoned && "Close by isn't the same as zoned: Jefferson Parish Schools assigns attendance-zone schools by address. "}
        {p.parish === "orleans" && "Most New Orleans public schools take students citywide through the NCAP application, wherever they live. "}
        {allLink}
      </div>
    </div>
  );
}
