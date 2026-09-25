import os

import duckdb

DB_PATH = os.environ.get(
    "NOLA_DB_PATH",
    os.path.join(os.path.dirname(__file__), "..", "etl", "nola_housing.duckdb"),
)

_con = None


def get_connection() -> duckdb.DuckDBPyConnection:
    global _con
    if _con is None:
        if not os.path.exists(DB_PATH):
            raise RuntimeError(f"No database at {DB_PATH}. Download it with: python -m etl.db_store pull")
        _con = duckdb.connect(DB_PATH, read_only=True)
    return _con
