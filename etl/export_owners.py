"""Owner pages, owner-name search and ownership statistics for the static site.

Owner names are public record: the parish Assessors publish them and offer owner search. Owners
are matched by ``backend.owners.owner_key`` (the name as written, punctuation and word order set
aside) and sorted by ``owner_kind`` into individuals, organizations and public bodies.

  owner/{slug}.json   an owner with two or more records: every one (address, page, flood zone,
                      where), with totals
  ownidx/{xxxx}.json  owner-name search: each owner under the first four letters of every word of
                      their name, so "Gloria Sexton" and "Sexton Gloria" both find SEXTON GLORIA M.
                      [owner slug or null, name, records, kind, page, label]; an owner with one
                      record points at its property page instead of an owner page.
  ownership.json      per area (metro, parish, ZIP): records by owner kind, by how many records the
                      owner holds metro-wide, the share the 10 largest owners hold, the largest
                      owners, and (Jefferson, which publishes exemptions) the share of buildings
                      with a homestead exemption, i.e. lived in by their owner.

Each property page of an owner with other records carries a "same owner" reference. A record is a
parcel or a condo unit (each unit is its own tax bill), as on the rolls. Names match as written,
so different people with one name share a page, and one owner spelled two ways gets two.
"""

import re
from collections import Counter, defaultdict

from backend import queries
from backend.owners import owner_key, owner_kind

TOP_OWNERS = 8
# Name words too common to search by on their own; the search uses another word typed with them.
INDEX_SKIP = {"LLC", "INC", "THE", "OF", "AND", "TRUST", "CO", "JR", "SR", "II", "III", "IV", "CORP", "LP"}
CONCENTRATION_TOP_N = 10
HOLDER_BUCKETS = (("1", 1, 1), ("2-9", 2, 9), ("10+", 10, None))

_CAPS = {
    "LLC",
    "LLP",
    "LP",
    "INC",
    "II",
    "III",
    "IV",
    "USA",
    "US",
    "HUD",
    "NOLA",
    "LSU",
    "DOTD",
    "NA",
    "PLLC",
    "CCC",
}
_SMALL = {"OF", "THE", "AND", "FOR", "AT", "IN", "ON", "TO", "A"}


def display_name(name: str) -> str:
    """An owner key read out: "CITY OF NEW ORLEANS" -> "City of New Orleans", "STATE OF
    LOUISIANA-DOTD" -> "State of Louisiana-DOTD", company forms and suffixes in capitals."""

    def word(w: str, first: bool) -> str:
        if w in _CAPS:
            return w
        if w in _SMALL and not first:
            return w.lower()
        return "-".join(part if part in _CAPS else part[:1] + part[1:].lower() for part in w.split("-"))

    words = owner_key(name).split(" ")
    return " ".join(word(w, i == 0) for i, w in enumerate(words))


def name_prefix(word: str) -> str:
    """The search file a name word is filed under: its first four letters, or the whole word when
    shorter. Four letters keep the busiest files (MARY, JOHN) small enough to fetch on a phone as
    someone types. Must match frontend/src/api.js ownerPrefix()."""
    return word[:4]


class Owners:
    """Built from every parcel before the property pages are written (owner names may be dropped
    from the pages afterwards); then told each record's page as it's written."""

    def __init__(self, parcels: list[dict], enabled: bool = True):
        self.enabled = enabled
        self.key_of: dict[tuple, str] = {}
        self.count: Counter = Counter()
        spellings: dict[str, Counter] = defaultdict(Counter)
        for p in parcels:
            key = owner_key(p.get("owner_name"))
            if not key:
                continue
            self.key_of[(p["parish"], p["parcel_id"])] = key
            self.count[key] += 1
            spellings[key][re.sub(r"\s+", " ", p["owner_name"].strip())] += 1
        self.kind = {k: owner_kind(k) for k in self.count}
        self.name = {k: display_name(k) for k in spellings}
        # Other ways the rolls write it, when they differ by more than punctuation and order.
        self.variants = {
            k: sorted({v.title() for v in s} - {self.name[k].title()})
            for k, s in spellings.items()
            if len({re.sub(r"[^A-Z0-9]", "", v.upper()) for v in s}) > 1
        }
        self.slug: dict[str, str] = {}
        taken: set[str] = set()
        for key, n in self.count.most_common():
            if n >= 2:
                slug = queries.slugify(key)[:80].strip("-") or "owner"
                base, i = slug, 2
                while slug in taken:
                    slug, i = f"{base}-{i}", i + 1
                taken.add(slug)
                self.slug[key] = slug
        self.records: dict[str, list] = defaultdict(list)
        self._parcels = parcels

    def ref(self, parcel: dict) -> dict | None:
        """The "same owner" reference for a property page whose owner has other records."""
        key = self.key_of.get((parcel["parish"], parcel["parcel_id"]))
        if not self.enabled or key not in self.slug:
            return None
        return {
            "slug": self.slug[key],
            "name": self.name[key],
            "kind": self.kind[key],
            "count": self.count[key],
        }

    def add_page(self, parcel: dict, slug: str, label: str) -> None:
        key = self.key_of.get((parcel["parish"], parcel["parcel_id"]))
        if not self.enabled or not key:
            return
        self.records[key].append(
            {
                "slug": slug,
                "label": label,
                "parish": parcel["parish"],
                "zip": parcel.get("zip_code"),
                "lat": parcel.get("lat"),
                "lng": parcel.get("lng"),
                "zone": parcel.get("flood_zone"),
                "sfha": parcel.get("flood_sfha"),
            }
        )

    def pages(self) -> dict[str, dict]:
        """slug -> owner page."""
        out = {}
        for key, slug in self.slug.items():
            recs = sorted(self.records[key], key=lambda r: (r["parish"], r["label"] or ""))
            zoned = [r for r in recs if r["sfha"] is not None]
            out[slug] = {
                "slug": slug,
                "name": self.name[key],
                "kind": self.kind[key],
                "also_written": self.variants.get(key, []),
                "count": len(recs),
                "addresses": len({r["label"].split(",")[0].split(" Unit ")[0] for r in recs if r["label"]}),
                "parishes": dict(Counter(r["parish"] for r in recs)),
                "zips": Counter(r["zip"] for r in recs if r["zip"]).most_common(),
                "sfha_share": round(sum(1 for r in zoned if r["sfha"]) / len(zoned), 3) if zoned else None,
                "records": recs,
            }
        return out

    def name_index(self) -> dict[str, list]:
        """``name_prefix`` of each name word -> [owner slug or None, name, records, kind, page slug,
        label]."""
        shards: dict[str, list] = defaultdict(list)
        for key, n in self.count.items():
            recs = self.records.get(key)
            if not recs:
                continue
            slug = self.slug.get(key)
            first = recs[0] if not slug else None
            entry = [
                slug,
                self.name[key],
                n,
                self.kind[key],
                first and first["slug"],
                first and first["label"],
            ]
            prefixes = {
                name_prefix(w) for w in re.findall(r"[A-Z0-9]+", key) if len(w) >= 2 and w not in INDEX_SKIP
            }
            for prefix in prefixes:
                shards[prefix].append(entry)
        return {k: sorted(v, key=lambda e: (-e[2], e[1])) for k, v in shards.items()}

    def stats(self, areas: list[dict]) -> dict:
        """Ownership breakdown per area. ``areas`` are backend.queries.geos() entries."""
        by_area: dict[str, list] = defaultdict(list)
        parish_fips = {a["parish"]: a["geo_id"] for a in areas if a["geo_level"] == "county"}
        zips = {a["geo_id"] for a in areas if a["geo_level"] == "zip"}
        metro = next(a["geo_id"] for a in areas if a["geo_level"] == "metro")
        for p in self._parcels:
            ids = [f"metro:{metro}"]
            if p["parish"] in parish_fips:
                ids.append(f"county:{parish_fips[p['parish']]}")
            if p.get("zip_code") in zips:
                ids.append(f"zip:{p['zip_code']}")
            for geo in ids:
                by_area[geo].append(p)
        out = {}
        for a in areas:
            geo = f"{a['geo_level']}:{a['geo_id']}"
            out[geo] = self._area_stats(by_area.get(geo, []))
        return out

    def _area_stats(self, parcels: list[dict]) -> dict:
        keys = [self.key_of.get((p["parish"], p["parcel_id"])) for p in parcels]
        owned = [k for k in keys if k]
        kinds = Counter(self.kind[k] for k in owned)
        holders = Counter()
        for k in owned:
            n = self.count[k]
            holders[next(b for b, lo, hi in HOLDER_BUCKETS if n >= lo and (hi is None or n <= hi))] += 1
        here = Counter(owned)
        top_n = sum(n for _, n in here.most_common(CONCENTRATION_TOP_N))
        largest = [
            [self.slug.get(k), self.name[k], n, self.kind[k]]
            for k, n in here.most_common(TOP_OWNERS)
            if n >= 2
        ]
        # Homestead exemptions are only published by Jefferson; Orleans parcels carry no values.
        buildings = [p for p in parcels if (p.get("bld_val") or 0) > 0]
        homestead = sum(1 for p in buildings if (p.get("homestead_exempt_val") or 0) > 0)
        return {
            "records": len(parcels),
            "with_owner": len(owned),
            "owners": len(here),
            "by_kind": {k: kinds.get(k, 0) for k in ("individual", "organization", "government")},
            "by_holder_size": {b: holders.get(b, 0) for b, _, _ in HOLDER_BUCKETS},
            "top_owners_share": round(top_n / len(owned), 4) if owned else None,
            "top_owners": largest if self.enabled else [],
            "buildings": len(buildings),
            "homestead_share": round(homestead / len(buildings), 4) if buildings else None,
        }
