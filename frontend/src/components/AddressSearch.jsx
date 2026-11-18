import { useEffect, useRef, useState } from "react";
import { suggestAddresses } from "../api";

const SUGGEST_DEBOUNCE_MS = 150;

// Every piece of a suggestion is its own element, so nothing outside React (iOS Safari's address
// and phone detection, Google Translate, extensions) rewrites a bare text node React then edits in
// place on the next keystroke, which throws NotFoundError.
function highlightMatch(text, query) {
  const needle = query.trim();
  const i = needle ? text.toUpperCase().indexOf(needle.toUpperCase()) : -1;
  if (i === -1) return <span>{text}</span>;
  return (
    <>
      <span>{text.slice(0, i)}</span>
      <b>{text.slice(i, i + needle.length)}</b>
      <span>{text.slice(i + needle.length)}</span>
    </>
  );
}

/**
 * The address box: an input with address, street and owner suggestions, and a Search button.
 * Used on the home page and on Property Lookup. The parent owns the text (value/onChange) and
 * decides what a pick or a submit does; this component owns only the suggestion list.
 *
 * onPick(suggestion)  a suggestion was chosen ({ kind?, address, full, slug? })
 * onSubmit(text)      Enter or the button with no suggestion highlighted
 */
export default function AddressSearch({ value, onChange, onPick, onSubmit, loading = false, boxRef, idPrefix = "address", size, autoFocus = false }) {
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const ownRef = useRef(null);
  const ref = boxRef || ownRef;
  const debounceRef = useRef(null);
  const seqRef = useRef(0);
  const listId = `${idPrefix}-suggestions`;

  useEffect(() => {
    function onClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [ref]);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  function onInput(v) {
    onChange(v);
    setActive(-1);
    clearTimeout(debounceRef.current);
    if (!v.trim()) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    const seq = ++seqRef.current;
    debounceRef.current = setTimeout(async () => {
      const results = await suggestAddresses(v).catch(() => []);
      if (seq !== seqRef.current) return; // a newer keystroke superseded this request
      setSuggestions(results);
      setOpen(results.length > 0);
    }, SUGGEST_DEBOUNCE_MS);
  }

  function pick(s) {
    setOpen(false);
    seqRef.current++; // drop any suggestion request still in flight
    onPick(s);
  }

  function submit() {
    setOpen(false);
    seqRef.current++;
    clearTimeout(debounceRef.current);
    if (value.trim()) onSubmit(value);
  }

  function onKeyDown(e) {
    if (open && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
        return;
      }
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e.key === "Enter" && active >= 0) {
        e.preventDefault();
        pick(suggestions[active]);
        return;
      }
    }
    if (e.key === "Enter") submit();
  }

  return (
    <div className={`search-row${size === "large" ? " search-row--large" : ""}`} ref={ref}>
      <div className="search-box">
        <input
          className="search-input"
          value={value}
          onChange={(e) => onInput(e.target.value)}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={size === "large" ? "Address, street or owner name" : "Address, street, owner name or parcel #"}
          aria-label="Address, street name, owner name or parcel number"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={active >= 0 ? `${idPrefix}-suggestion-${active}` : undefined}
          autoComplete="off"
          // The home page's one job is this box; focusing it there saves a click on desktop.
          autoFocus={autoFocus}
        />
        {open && (
          <div className="suggestions" id={listId} role="listbox">
            {suggestions.map((a, i) => (
              <div
                key={`${a.kind || "address"}-${a.address}`}
                id={`${idPrefix}-suggestion-${i}`}
                role="option"
                aria-selected={i === active}
                className={`suggestion${i === active ? " suggestion--active" : ""}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(a);
                }}
              >
                {highlightMatch(a.full, value)}
                {a.sub && <span className="suggestion-sub">{a.sub}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
      <button className="btn-primary" onClick={submit} disabled={loading}>
        {loading ? "Searching…" : "Search"}
      </button>
    </div>
  );
}
