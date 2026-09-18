"""Generic HTML label/value extraction (stdlib only) for assessor detail pages.

Assessor detail pages are overwhelmingly rendered as two-column tables
(``<th>Label</th><td>Value</td>`` or ``<td class=label>``) or definition lists.
Rather than pin brittle CSS selectors we collect every label/value pair on the
page and let each parish adapter map labels to normalized fields via aliases.

Tables whose first row is entirely ``<th>`` cells are treated as data tables
(value history, sales) and are exposed through ``parse_table_rows`` /
``find_labeled_table`` instead of contributing label/value pairs.
"""

import re
from html.parser import HTMLParser


class _PairCollector(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.pairs: list[tuple[str, str]] = []
        self.rows: list[list[str]] = []
        self._cells: list[tuple[str, str]] | None = None
        self._buf: list[str] | None = None
        self._dt: str | None = None
        self._skip = 0
        # per-table state: (first_row_seen, is_data_table)
        self._tables: list[dict] = []

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self._skip += 1
        elif tag == "table":
            self._tables.append({"first_row_seen": False, "is_data": False})
        elif tag == "tr":
            self._cells = []
        elif tag in ("td", "th", "dt", "dd") and self._skip == 0:
            self._buf = []
        elif tag == "br" and self._buf is not None:
            self._buf.append(" ")

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self._skip = max(0, self._skip - 1)
        elif tag == "table" and self._tables:
            self._tables.pop()
        elif tag in ("td", "th") and self._buf is not None:
            text = _clean(" ".join(self._buf))
            if self._cells is not None:
                self._cells.append((tag, text))
            self._buf = None
        elif tag == "tr" and self._cells is not None:
            self._end_row()
        elif tag == "dt" and self._buf is not None:
            self._dt = _clean(" ".join(self._buf)).rstrip(":")
            self._buf = None
        elif tag == "dd" and self._buf is not None:
            if self._dt:
                self.pairs.append((self._dt, _clean(" ".join(self._buf))))
            self._dt = None
            self._buf = None

    def _end_row(self):
        cells = self._cells or []
        self._cells = None
        if len(cells) < 2:
            return
        texts = [c[1] for c in cells]
        self.rows.append(texts)
        table = self._tables[-1] if self._tables else {"first_row_seen": True, "is_data": False}
        if not table["first_row_seen"]:
            table["first_row_seen"] = True
            if all(tag == "th" for tag, _ in cells):
                table["is_data"] = True
                return
        if table["is_data"]:
            return
        # Two-column rows (or 4-col "L V L V" rows) become label/value pairs.
        for i in range(0, len(texts) - 1, 2):
            if texts[i]:
                self.pairs.append((texts[i].rstrip(":"), texts[i + 1]))

    def handle_data(self, data):
        if self._buf is not None and self._skip == 0:
            self._buf.append(data)


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def parse_label_pairs(html: str) -> dict[str, str]:
    """Return {label: value} for every label/value pair found; first occurrence wins."""
    p = _PairCollector()
    p.feed(html)
    out: dict[str, str] = {}
    for label, value in p.pairs:
        if label and label not in out:
            out[label] = value
    return out


def parse_table_rows(html: str) -> list[list[str]]:
    """All table rows with >= 2 cells, for multi-row value/sale history tables."""
    p = _PairCollector()
    p.feed(html)
    return p.rows


def find_labeled_table(rows: list[list[str]], required_headers: tuple[str, ...]) -> list[dict]:
    """Locate a table whose header row contains all ``required_headers`` (case-insensitive)
    and return its subsequent rows as dicts until the column count changes."""
    req = [h.lower() for h in required_headers]
    for i, row in enumerate(rows):
        lowered = [c.lower() for c in row]
        if all(any(r in cell for cell in lowered) for r in req):
            header = row
            out = []
            for data in rows[i + 1 :]:
                if len(data) != len(header):
                    break
                out.append(dict(zip(header, data, strict=False)))
            return out
    return []
