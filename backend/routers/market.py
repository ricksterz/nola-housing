from fastapi import APIRouter, HTTPException

from .. import queries
from ..db import get_connection

router = APIRouter(prefix="/api/market", tags=["market"])

VALID = {(g["geo_level"], g["geo_id"]) for g in queries.geos()}


@router.get("/trend")
def market_trend(geo_id: str, geo_level: str = "zip"):
    if (geo_level, geo_id) not in VALID:
        raise HTTPException(status_code=400, detail=f"unknown geography {geo_level}/{geo_id}")
    return queries.trend(get_connection(), geo_level, geo_id)


@router.get("/compare")
def market_compare():
    return queries.compare(get_connection())


@router.get("/scorecard")
def market_scorecard():
    return queries.scorecard(get_connection())


@router.get("/costs")
def market_costs():
    return queries.ownership_costs(get_connection())


@router.get("/macro_index")
def market_macro_index():
    return {"series": queries.macro_index(get_connection())}
