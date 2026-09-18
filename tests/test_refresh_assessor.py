from datetime import date

from etl.refresh_assessor import parishes_in_window


def test_orleans_open_rolls_window():
    assert parishes_in_window(date(2026, 7, 15)) == ["orleans"]
    assert parishes_in_window(date(2026, 8, 1)) == ["orleans"]
    assert parishes_in_window(date(2026, 8, 15)) == ["jefferson", "orleans"]


def test_jefferson_annual_window():
    assert parishes_in_window(date(2026, 8, 20)) == ["jefferson"]
    assert parishes_in_window(date(2026, 9, 20)) == ["jefferson"]
    assert parishes_in_window(date(2026, 6, 1)) == []
    assert parishes_in_window(date(2026, 10, 5)) == []
