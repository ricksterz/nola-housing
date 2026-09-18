from fastapi import APIRouter, HTTPException

from .. import queries
from ..db import get_connection

router = APIRouter(prefix="/api/property", tags=["property"])


@router.get("/lookup")
def property_lookup(address: str):
    data = queries.property_lookup(get_connection(), address)
    if data is None:
        raise HTTPException(
            status_code=404, detail=f"No assessor record found for address '{address.strip()}'"
        )
    return data


@router.get("/suggest")
def property_suggest(q: str):
    return {"suggestions": queries.suggest(get_connection(), q)}
