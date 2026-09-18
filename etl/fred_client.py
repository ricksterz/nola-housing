"""FRED API client for New Orleans–Metairie macro context.

Same client/auth pattern as the Houston job's ``backend/fred_client.py``: the key
comes from FRED_API_KEY (env or project-root .env), latest values are cached
in-process for an hour, and every series failure is captured per-series so one
bad series never blanks the whole snapshot. Adds ``fetch_observations`` for the
full-history load into DuckDB.
"""

import os
import time
from pathlib import Path

import requests

from .config import FRED_OBSERVATION_START, FRED_SERIES

FRED_API = "https://api.stlouisfed.org/fred/series/observations"


def _load_dotenv() -> None:
    """Load KEY=VALUE pairs from the project-root .env, without overriding real env vars."""
    env_file = Path(__file__).resolve().parent.parent / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


_load_dotenv()

CACHE_TTL_SECONDS = 60 * 60  # 1 hour
_cache = {"data": None, "fetched_at": 0.0}


def api_key() -> str:
    return os.environ.get("FRED_API_KEY", "")


def _get(params: dict, timeout: int = 20) -> dict:
    r = requests.get(FRED_API, params={**params, "api_key": api_key(), "file_type": "json"}, timeout=timeout)
    r.raise_for_status()
    return r.json()


def fetch_latest(series_id: str) -> dict:
    obs = _get({"series_id": series_id, "sort_order": "desc", "limit": 1})["observations"][0]
    return {
        "value": float(obs["value"]) if obs["value"] != "." else None,
        "date": obs["date"],
        "series": series_id,
    }


def fetch_observations(series_id: str, observation_start: str = FRED_OBSERVATION_START) -> list[dict]:
    """Full observation history as [{'date': 'YYYY-MM-DD', 'value': float|None}, ...]."""
    out: list[dict] = []
    offset = 0
    while True:
        page = _get(
            {
                "series_id": series_id,
                "observation_start": observation_start,
                "sort_order": "asc",
                "limit": 100000,
                "offset": offset,
            }
        )
        rows = page.get("observations", [])
        for obs in rows:
            out.append({"date": obs["date"], "value": None if obs["value"] == "." else float(obs["value"])})
        offset += len(rows)
        if offset >= int(page.get("count", 0)) or not rows:
            return out


def get_macro_snapshot() -> dict:
    """Latest value per configured series, shaped like the Houston macro.json."""
    now = time.time()
    if _cache["data"] is not None and (now - _cache["fetched_at"]) < CACHE_TTL_SECONDS:
        return _cache["data"]

    result = {}
    for key, (sid, geo_level, geo_id, freq) in FRED_SERIES.items():
        meta = {"series": sid, "geo_level": geo_level, "geo_id": geo_id, "frequency": freq}
        if not api_key():
            result[key] = {"value": None, "date": None, **meta, "error": "FRED_API_KEY not set"}
            continue
        try:
            result[key] = {**fetch_latest(sid), **meta}
        except Exception as e:  # noqa: BLE001 - surface per-series errors, keep going
            result[key] = {"value": None, "date": None, **meta, "error": str(e)}

    _cache["data"] = result
    _cache["fetched_at"] = now
    return result
