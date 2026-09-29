import json

from backend import queries


def _square(x0, y0, size=0.01):
    return {
        "type": "Polygon",
        "coordinates": [[[x0, y0], [x0 + size, y0], [x0 + size, y0 + size], [x0, y0 + size], [x0, y0]]],
    }


def _tracts(tmp_path, monkeypatch):
    doc = {
        "type": "FeatureCollection",
        "floodlens": {"model": "FloodLens v4", "rates": {"top_vs_rest": 2.88}},
        "features": [
            # A 2010 tract and a 2020 tract covering the same ground: 2010 wins, as in the backtest.
            {
                "type": "Feature",
                "properties": {"geoid": "A2010", "vintage": "2010", "quintile": 5, "score": 70.0},
                "geometry": _square(-90.2, 29.9),
            },
            {
                "type": "Feature",
                "properties": {"geoid": "B2020", "vintage": "2020", "quintile": 1, "score": 30.0},
                "geometry": _square(-90.2, 29.9),
            },
            {
                "type": "Feature",
                "properties": {"geoid": "C2010", "vintage": "2010", "quintile": 2, "score": 40.0},
                "geometry": _square(-90.1, 29.9),
            },
        ],
    }
    path = tmp_path / "floodlens_tracts.geojson"
    path.write_text(json.dumps(doc))
    monkeypatch.setattr(queries, "FLOODLENS_TRACTS", path)


def test_flags_only_a_zone_parcels_in_evaluated_tracts(con, tmp_path, monkeypatch):
    _tracts(tmp_path, monkeypatch)
    con.execute("CREATE TABLE parcel_market (parcel_id VARCHAR, lat DOUBLE, lng DOUBLE, flood_zone VARCHAR)")
    con.execute(
        "INSERT INTO parcel_market VALUES"
        " ('top', 29.905, -90.195, 'AE'),"  # in the overlapping tracts: 2010 (top fifth) wins
        " ('lower', 29.905, -90.095, 'AO'),"
        " ('zone_x', 29.905, -90.195, 'X'),"  # same spot, but Zone X: no statement
        " ('v_zone', 29.905, -90.195, 'VE'),"  # V zones were tested apart from A zones
        " ('outside', 29.5, -90.5, 'AE')"  # A zone, but in no evaluated tract
    )
    assert queries.floodlens_flags(con) == {
        "top": {"quintile": 5, "geoid": "A2010"},
        "lower": {"quintile": 2, "geoid": "C2010"},
    }
    assert queries.floodlens_flags(con, "lower") == {"lower": {"quintile": 2, "geoid": "C2010"}}
    assert queries.floodlens_summary()["rates"]["top_vs_rest"] == 2.88
