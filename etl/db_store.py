"""Where the database lives: an asset on the repo's `data` GitHub Release, not in git.

etl/nola_housing.duckdb outgrew git. GitHub warns above 50 MB and rejects pushes of files over
100 MB; the file was 72 MB and every refresh committed another full copy into history. Now:

- Refresh jobs pull the current copy, run, then publish it back.
- The Pages deploy and CI pull it read-only.
- Local development pulls it once.

    python -m etl.db_store pull              # current copy -> etl/nola_housing.duckdb
    python -m etl.db_store pull --previous   # the copy it replaced, for a rollback
    python -m etl.db_store check             # table counts; exits non-zero if the file is unusable
    python -m etl.db_store publish --before PREV --notes "..."   # refresh jobs; needs GITHUB_TOKEN

Publishing never leaves the release without a database. The new file is uploaded under a
temporary name, then the assets are renamed (current -> previous, new -> current), so a failed
upload leaves the current copy untouched and the one before it is always a pull away. It also
refuses a file that is missing core tables or lost most of its parcels, which is what a refresh
that silently started from an empty database would look like.
"""

import argparse
import filecmp
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import requests

from . import config

REQUIRED_TABLES = ("assessor_parcels", "market_monthly", "parcel_market")
# Refuse to publish if assessor_parcels shrinks below this share of the copy being replaced.
MIN_PARCEL_RATIO = 0.5
UPLOADING_ASSET = config.DB_ASSET + ".uploading"
API_HEADERS = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}


class DatabaseCheckFailed(RuntimeError):
    pass


def download_url(asset: str = config.DB_ASSET) -> str:
    return f"https://github.com/{config.DB_REPO}/releases/download/{config.DB_RELEASE_TAG}/{asset}"


def check(path) -> dict[str, int]:
    """Row counts of the core tables; raises DatabaseCheckFailed if any is missing or empty."""
    try:
        con = duckdb.connect(str(path), read_only=True)
    except duckdb.Error as e:
        raise DatabaseCheckFailed(f"{path} is not a readable DuckDB file ({e})") from e
    try:
        have = {r[0] for r in con.execute("SELECT table_name FROM information_schema.tables").fetchall()}
        missing = [t for t in REQUIRED_TABLES if t not in have]
        if missing:
            raise DatabaseCheckFailed(f"{path} is missing {', '.join(missing)}")
        counts = {t: con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in REQUIRED_TABLES}
    finally:
        con.close()
    empty = [t for t, n in counts.items() if not n]
    if empty:
        raise DatabaseCheckFailed(f"{path} has no rows in {', '.join(empty)}")
    return counts


def pull(
    dest=config.DB_PATH, asset: str = config.DB_ASSET, session=None, attempts: int = 3, sleep=time.sleep
):
    """Download ``asset`` from the data release to ``dest``, replacing it only once it checks out."""
    session = session or requests.Session()
    dest = Path(dest)
    tmp = dest.with_name(dest.name + ".download")
    url = download_url(asset)
    for attempt in range(1, attempts + 1):
        try:
            resp = session.get(url, timeout=300)
            resp.raise_for_status()
            break
        except requests.RequestException:
            if attempt == attempts:
                raise
            sleep(5 * attempt)
    tmp.write_bytes(resp.content)
    try:
        counts = check(tmp)
    except DatabaseCheckFailed:
        tmp.unlink()
        raise
    os.replace(tmp, dest)
    print(f"Pulled {asset} ({dest.stat().st_size / 1e6:.1f} MB) -> {dest}: {_fmt_counts(counts)}")
    return counts


def _fmt_counts(counts: dict[str, int]) -> str:
    return ", ".join(f"{t} {n:,}" for t, n in counts.items())


class _GitHub:
    def __init__(self, token: str, session=None):
        self.session = session or requests.Session()
        self.headers = {**API_HEADERS, "Authorization": f"Bearer {token}"}
        self.repo = config.DB_REPO

    def _call(self, method: str, url: str, **kw):
        resp = self.session.request(
            method, url, headers={**self.headers, **kw.pop("headers", {})}, timeout=600, **kw
        )
        resp.raise_for_status()
        return resp

    def release(self) -> dict:
        return self._call(
            "GET", f"{config.GITHUB_API}/repos/{self.repo}/releases/tags/{config.DB_RELEASE_TAG}"
        ).json()

    def upload(self, release_id: int, name: str, path: Path) -> dict:
        with open(path, "rb") as f:
            return self._call(
                "POST",
                f"{config.GITHUB_UPLOADS}/repos/{self.repo}/releases/{release_id}/assets",
                params={"name": name},
                data=f,
                headers={"Content-Type": "application/octet-stream"},
            ).json()

    def rename(self, asset_id: int, name: str) -> None:
        self._call(
            "PATCH", f"{config.GITHUB_API}/repos/{self.repo}/releases/assets/{asset_id}", json={"name": name}
        )

    def delete(self, asset_id: int) -> None:
        self._call("DELETE", f"{config.GITHUB_API}/repos/{self.repo}/releases/assets/{asset_id}")

    def set_notes(self, release_id: int, body: str) -> None:
        self._call(
            "PATCH", f"{config.GITHUB_API}/repos/{self.repo}/releases/{release_id}", json={"body": body}
        )


def publish(
    path=config.DB_PATH, before=None, notes: str = "", token: str | None = None, session=None
) -> bool:
    """Replace the release's database with ``path``. ``before`` is the copy this run started from.

    Returns False (and uploads nothing) when the file is byte-identical to ``before``.
    """
    path = Path(path)
    counts = check(path)
    if before and Path(before).exists():
        if filecmp.cmp(path, before, shallow=False):
            print("No data changes; nothing published.")
            return False
        old = check(before)["assessor_parcels"]
        if counts["assessor_parcels"] < old * MIN_PARCEL_RATIO:
            raise DatabaseCheckFailed(
                f"refusing to publish: assessor_parcels fell from {old:,} to {counts['assessor_parcels']:,}"
            )
    token = token or os.environ.get("GITHUB_TOKEN")
    if not token:
        raise RuntimeError("publishing needs GITHUB_TOKEN (contents: write)")

    gh = _GitHub(token, session)
    release = gh.release()
    assets = {a["name"]: a["id"] for a in release.get("assets", [])}
    if UPLOADING_ASSET in assets:  # left behind by a run that died mid-upload
        gh.delete(assets.pop(UPLOADING_ASSET))
    new_id = gh.upload(release["id"], UPLOADING_ASSET, path)["id"]
    # Upload succeeded; now swap names. Each step leaves a usable current or previous copy.
    if config.DB_PREVIOUS_ASSET in assets:
        gh.delete(assets[config.DB_PREVIOUS_ASSET])
    if config.DB_ASSET in assets:
        gh.rename(assets[config.DB_ASSET], config.DB_PREVIOUS_ASSET)
    gh.rename(new_id, config.DB_ASSET)

    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    gh.set_notes(
        release["id"],
        f"Database used by the site and the refresh jobs. Updated by the workflows; don't edit by hand.\n\n"
        f"**{config.DB_ASSET}**: {stamp}{f' — {notes}' if notes else ''}\n"
        f"{_fmt_counts(counts)}; {path.stat().st_size / 1e6:.1f} MB\n\n"
        f"**{config.DB_PREVIOUS_ASSET}**: the copy it replaced, for a rollback "
        f"(`python -m etl.db_store pull --previous`).",
    )
    print(f"Published {path} ({path.stat().st_size / 1e6:.1f} MB): {_fmt_counts(counts)}")
    return True


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("pull", help="download the database from the data release")
    p.add_argument("--dest", default=str(config.DB_PATH))
    p.add_argument("--previous", action="store_true", help="the copy the latest one replaced")
    c = sub.add_parser("check", help="verify core tables exist and aren't empty")
    c.add_argument("path", nargs="?", default=str(config.DB_PATH))
    u = sub.add_parser("publish", help="upload the database to the data release (refresh jobs)")
    u.add_argument("--db", default=str(config.DB_PATH))
    u.add_argument("--before", help="the copy this run started from, to detect no-ops and data loss")
    u.add_argument("--notes", default="", help="what the refresh covered")
    args = ap.parse_args(argv)

    try:
        if args.cmd == "pull":
            pull(args.dest, config.DB_PREVIOUS_ASSET if args.previous else config.DB_ASSET)
        elif args.cmd == "check":
            print(_fmt_counts(check(args.path)))
        else:
            publish(args.db, args.before, args.notes)
    except (DatabaseCheckFailed, requests.RequestException, RuntimeError) as e:
        print(f"db_store {args.cmd}: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
