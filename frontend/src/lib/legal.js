// Who operates the site, and the Terms of Use and Privacy Policy text (data/legal.json). Until the
// LLC is registered, operator and contact are null and the text names the site itself; filling in
// those fields in legal.json changes every page at once. etl/prerender.py fills the same
// placeholders the same way (legal_fill): keep the two in step.
import legal from "../data/legal.json" with { type: "json" };

export { legal };

/** The placeholder values for the current operator. */
export function legalValues(l = legal) {
  const op = l.operator;
  return {
    operated_by: l.operator_full ? ` is operated by ${l.operator_full}` : " is an independent project based in Louisiana",
    owner: op || "NOLA Atlas",
    parties: op ? `${op} and its members, managers and contributors` : "NOLA Atlas and the people who build it",
    same_operator: op ? `also operated by ${op}` : "by the same independent builder",
  };
}

/** A legal.json sentence with its {placeholders} filled in. */
export function legalFill(text, l = legal) {
  const v = legalValues(l);
  return String(text).replace(/\{(operated_by|owner|parties|same_operator)\}/g, (_, k) => v[k]);
}
