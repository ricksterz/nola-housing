from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import queries
from .db import get_connection
from .routers import market, property

app = FastAPI(title="NOLA Housing Pulse API — New Orleans & Metairie housing")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(market.router)
app.include_router(property.router)


@app.get("/api/macro/snapshot")
def macro_snapshot():
    return queries.macro_snapshot(get_connection())


@app.get("/api/meta")
def meta():
    return queries.meta(get_connection())
