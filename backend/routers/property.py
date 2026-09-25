from fastapi import APIRouter, HTTPException

from .. import queries
from ..db import get_connection

router = APIRouter(prefix="/api/property", tags=["property"])


@router.get("/lookup")
def property_lookup(address: str):
    data = queries.property_lookup(get_connection(), address)
    if data is None:
        raise HTTPException(
            status_code=404,
            detail=(
                f'No assessor record matches "{address.strip()}". '
                "Pick an address from the suggestions as you type, or double-check the "
                "spelling and street type (Rd/St/Ave/Dr)."
            ),
        )
    return data


@router.get("/suggest")
def property_suggest(q: str):
    return {"suggestions": queries.suggest(get_connection(), q)}


@router.get("/nearby")
def property_nearby(lat: float, lng: float):
    return {"homes": queries.nearby(get_connection(), lat, lng)}
