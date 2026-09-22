"""Polite HTTP session for assessor sites: rate limit, retry/backoff, robots.txt, budget, raw cache.

Both assessors serve their data through public search UIs with no published
bulk export, so the batch pull has to behave: identify itself, respect
robots.txt, never exceed a fixed request rate, back off on 429/5xx, and stop
at a per-run budget so a full-parish pull is spread across the refresh window.
Every response body is written to the raw landing directory so re-parsing never
requires re-fetching.
"""

import hashlib
import logging
import time
import urllib.robotparser
from pathlib import Path
from urllib.parse import urlparse

import requests

from .. import config

log = logging.getLogger(__name__)


class BudgetExhausted(RuntimeError):
    """Raised when the per-run request budget has been spent."""


class RobotsDisallowed(RuntimeError):
    """Raised when robots.txt disallows the requested URL for our user agent."""


class PoliteSession:
    def __init__(
        self,
        min_interval: float = config.ASSESSOR_MIN_INTERVAL_SECONDS,
        max_requests: int = config.ASSESSOR_MAX_REQUESTS_PER_RUN,
        timeout: int = config.ASSESSOR_TIMEOUT_SECONDS,
        user_agent: str = config.ASSESSOR_USER_AGENT,
        raw_dir: Path | None = None,
        respect_robots: bool = True,
        max_retries: int = 4,
        session: requests.Session | None = None,
        sleep=time.sleep,
    ):
        self.min_interval = min_interval
        self.max_requests = max_requests
        self.timeout = timeout
        self.raw_dir = Path(raw_dir) if raw_dir else None
        self.respect_robots = respect_robots
        self.max_retries = max_retries
        self._sleep = sleep
        self._last_request_at = 0.0
        self._robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}
        self.requests_made = 0
        self.session = session or requests.Session()
        self.session.headers.update(
            {"User-Agent": user_agent, "Accept": "text/html,application/json;q=0.9,*/*;q=0.8"}
        )
        self.user_agent = user_agent

    # -- robots -------------------------------------------------------------
    def _robots_for(self, url: str):
        origin = "{0.scheme}://{0.netloc}".format(urlparse(url))
        if origin not in self._robots:
            rp = urllib.robotparser.RobotFileParser()
            try:
                r = self.session.get(origin + "/robots.txt", timeout=self.timeout)
                if r.status_code == 200:
                    rp.parse(r.text.splitlines())
                    self._robots[origin] = rp
                else:
                    self._robots[origin] = None  # no robots.txt -> allowed
            except requests.RequestException as e:
                log.warning("robots.txt fetch failed for %s (%s); proceeding cautiously", origin, e)
                self._robots[origin] = None
        return self._robots[origin]

    def allowed(self, url: str) -> bool:
        if not self.respect_robots:
            return True
        rp = self._robots_for(url)
        return True if rp is None else rp.can_fetch(self.user_agent, url)

    # -- pacing -------------------------------------------------------------
    def _pace(self):
        if self.requests_made >= self.max_requests:
            raise BudgetExhausted(f"request budget of {self.max_requests} spent")
        wait = self.min_interval - (time.monotonic() - self._last_request_at)
        if wait > 0:
            self._sleep(wait)

    # -- fetch --------------------------------------------------------------
    def get(self, url: str, params: dict | None = None, cache_key: str | None = None) -> requests.Response:
        if not self.allowed(url):
            raise RobotsDisallowed(url)
        backoff = self.min_interval
        for attempt in range(self.max_retries + 1):
            self._pace()
            self._last_request_at = time.monotonic()
            self.requests_made += 1
            try:
                resp = self.session.get(url, params=params, timeout=self.timeout)
            except requests.RequestException as e:
                if attempt == self.max_retries:
                    raise
                log.warning("GET %s failed (%s); retry %d", url, e, attempt + 1)
                self._sleep(backoff)
                backoff *= 2
                continue
            if resp.status_code in (429, 500, 502, 503, 504) and attempt < self.max_retries:
                retry_after = resp.headers.get("Retry-After")
                delay = float(retry_after) if retry_after and retry_after.isdigit() else backoff
                log.warning("GET %s -> %s; sleeping %.1fs", url, resp.status_code, delay)
                self._sleep(delay)
                backoff *= 2
                continue
            self._cache(resp, cache_key)
            return resp
        raise RuntimeError("unreachable")

    def get_json(self, url: str, params: dict | None = None, cache_key: str | None = None):
        resp = self.get(url, params=params, cache_key=cache_key)
        resp.raise_for_status()
        return resp.json()

    # -- raw landing --------------------------------------------------------
    def _cache(self, resp: requests.Response, cache_key: str | None) -> None:
        if not self.raw_dir:
            return
        key = cache_key or hashlib.sha1(resp.url.encode(), usedforsecurity=False).hexdigest()
        ext = ".json" if "json" in resp.headers.get("Content-Type", "") else ".html"
        path = self.raw_dir / (key + ext)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(resp.content)
