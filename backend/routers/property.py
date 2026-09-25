from fastapi import APIRouter, HTTPException

from .. import queries
from ..db import get_connection

router = APIRouter(prefix="/api/property", tags=["property"])


@router.get("/lookup")
def property_lookup(address: str):
    con = get_connection()
    data = queries.property_lookup(con, address)
    if data is None:
        street = address.split(",")[0].strip()
        parts = queries.split_house_number(queries.normalize_address(street))
        nearby = queries.closest_on_street(queries.street_entries(con, parts[1]), parts[0]) if parts else []
        raise HTTPException(
            status_code=404,
            detail={"message": queries.lookup_miss_message(street, bool(nearby)), "nearby": nearby},
        )
    return data


@router.get("/suggest")
def property_suggest(q: str):
    return {"suggestions": queries.suggest(get_connection(), q)}


@router.get("/nearby")
def property_nearby(lat: float, lng: float):
    return {"homes": queries.nearby(get_connection(), lat, lng)}
