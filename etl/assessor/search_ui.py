"""Batch-pull parcel detail pages from an assessor's public search UI, politely and resumably.

Used only when no official bulk option answers. Each parish adapter supplies a
detail-URL template and a parser; this module supplies the loop: seed parcel
IDs -> paced fetch -> raw HTML landed on disk -> parsed ParcelRecord -> JSON
checkpoint so an interrupted or budget-capped run picks up where it stopped.
"""

import csv
import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Iterable, Protocol

from .. import config
from .base import ParcelRecord
from .http import BudgetExhausted, PoliteSession, RobotsDisallowed

log = logging.getLogger(__name__)


class SearchUiAdapter(Protocol):
    parish: str
    parish_fips: str

    def detail_url(self, parcel_id: str) -> str: ...

    def parse_detail(self, html: str, parcel_id: str) -> ParcelRecord | None: ...


@dataclass
class PullStats:
    attempted: int = 0
    parsed: int = 0
    not_found: int = 0
    errors: int = 0
    stopped_reason: str | None = None


def load_seed_ids(parish: str, seed_file: str | None = None, existing: Iterable[str] = ()) -> list[str]:
    """Parcel IDs to pull: ASSESSOR_SEED_FILE rows (csv: parcel_id[, parish]) plus already-known IDs."""
    ids: list[str] = []
    seen: set[str] = set()
    path = seed_file or config.ASSESSOR_SEED_FILE
    if path and Path(path).exists():
        with open(path, newline="") as f:
            for row in csv.DictReader(f):
                if row.get("parish") and row["parish"].strip().lower() != parish:
                    continue
                pid = (row.get("parcel_id") or "").strip()
                if pid and pid not in seen:
                    seen.add(pid)
                    ids.append(pid)
    for pid in existing:
        if pid and pid not in seen:
            seen.add(pid)
            ids.append(pid)
    return ids


class Checkpoint:
    def __init__(self, path: Path):
        self.path = path
        self.done: dict[str, str] = {}
        if path.exists():
            self.done = json.loads(path.read_text()).get("done", {})

    def mark(self, parcel_id: str, status: str) -> None:
        self.done[parcel_id] = status

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(
            json.dumps({"updated": datetime.now(timezone.utc).isoformat(), "done": self.done})
        )


def pull_parcels(
    adapter: SearchUiAdapter,
    parcel_ids: Iterable[str],
    session: PoliteSession,
    raw_dir: Path,
    on_record: Callable[[ParcelRecord, str], None],
    checkpoint: Checkpoint | None = None,
    reset: bool = False,
) -> PullStats:
    stats = PullStats()
    checkpoint = checkpoint or Checkpoint(raw_dir / adapter.parish / "checkpoint.json")
    if reset:
        checkpoint.done = {}
    try:
        for i, pid in enumerate(parcel_ids):
            if pid in checkpoint.done and checkpoint.done[pid] in ("parsed", "not_found"):
                continue
            stats.attempted += 1
            url = adapter.detail_url(pid)
            try:
                resp = session.get(url, cache_key=f"{adapter.parish}/detail_{pid}")
            except RobotsDisallowed:
                stats.stopped_reason = f"robots.txt disallows {url}"
                break
            except BudgetExhausted:
                raise
            except Exception as e:  # noqa: BLE001
                stats.errors += 1
                checkpoint.mark(pid, f"error: {e}")
                continue
            if resp.status_code == 404:
                stats.not_found += 1
                checkpoint.mark(pid, "not_found")
                continue
            if resp.status_code != 200:
                stats.errors += 1
                checkpoint.mark(pid, f"http {resp.status_code}")
                continue
            try:
                rec = adapter.parse_detail(resp.text, pid)
            except Exception as e:  # noqa: BLE001
                stats.errors += 1
                checkpoint.mark(pid, f"parse error: {e}")
                continue
            if rec is None:
                stats.not_found += 1
                checkpoint.mark(pid, "not_found")
                continue
            on_record(rec, url)
            stats.parsed += 1
            checkpoint.mark(pid, "parsed")
            if i % 50 == 0:
                checkpoint.save()
    except BudgetExhausted as e:
        stats.stopped_reason = str(e)
    finally:
        checkpoint.save()
    log.info("%s search-ui pull: %s", adapter.parish, stats)
    return stats
