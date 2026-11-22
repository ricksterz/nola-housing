import { EVENTS, trackEvent } from "../lib/metrics";
import { MAX_ITEMS, useWatchlist } from "../lib/watchlist";

/** Save or unsave one address, ZIP or owner to the watchlist. The visible word carries the state
 *  ("Save" / "Saved") and the name says what a click does; a save is counted, never what was saved. */
export default function WatchButton({ type, id, label, className = "btn" }) {
  const { has, toggle, full } = useWatchlist();
  if (!id) return null;
  const saved = has(type, id);
  const blocked = full && !saved;
  return (
    <button
      type="button"
      className={`${className} watch-btn${saved ? " is-saved" : ""}`}
      aria-label={blocked ? "Save (watchlist full)" : saved ? "Saved. Remove from watchlist" : "Save to watchlist"}
      disabled={blocked}
      title={blocked ? `Your watchlist is full (${MAX_ITEMS} items). Remove one to save this.` : saved ? "Saved to your watchlist in this browser. Click to remove." : "Save to your watchlist in this browser"}
      onClick={() => {
        if (toggle({ type, id, label })) trackEvent(EVENTS.watchlistSave);
      }}
    >
      <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill={saved ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
        <path d="M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.85L12 16.9l-5.25 2.75 1-5.85L3.5 9.7l5.9-.9z" />
      </svg>
      {saved ? "Saved" : "Save"}
    </button>
  );
}
