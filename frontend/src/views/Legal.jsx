import { legal, legalFill } from "../lib/legal";
import { fmt } from "../lib/theme";

// The Terms of Use and Privacy Policy, from data/legal.json (the same text etl/prerender.py builds
// into /terms/ and /privacy/ for readers without JavaScript and for search engines).
export default function Legal({ doc }) {
  const d = legal[doc];
  return (
    <article className="panel legal">
      <h2 className="panel-title">{d.title}</h2>
      <p className="stat-note">{`Last updated ${fmt.date(legal.updated)}`}</p>
      <p className="text-block">{legalFill(d.intro)}</p>
      {d.sections.map((s) => (
        <section key={s.heading}>
          <h3>{s.heading}</h3>
          {s.paragraphs.map((p) => (
            <p key={p.slice(0, 40)} className="text-block">
              {legalFill(p)}
            </p>
          ))}
        </section>
      ))}
      {legal.contact && (
        <section>
          <h3>Contact</h3>
          <p className="text-block">
            {`${legal.operator_full || "NOLA Atlas"}. Questions about these terms or this policy: `}
            <a href={`mailto:${legal.contact}`}>{legal.contact}</a>.
          </p>
        </section>
      )}
    </article>
  );
}
