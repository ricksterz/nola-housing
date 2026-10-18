"""Link-preview images (1200×630, Open Graph) for the pre-built pages: etl/prerender.py draws one
per page, so a shared link shows the page's headline and its key numbers, not just text.

Colors are the site's dark theme (frontend/src/index.css). Fonts are DejaVu, installed on the
deploy runner; NOLA_OG_FONT_DIR points elsewhere for a local run, and Pillow's built-in font is
the last resort so a missing font never breaks a deploy.
"""

import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT = 1200, 630
MARGIN = 72
BG = "#0a0e17"
PANEL = "#10151f"
BORDER = "#222a3a"
TEXT_BRIGHT = "#eef2f8"
TEXT_DIM = "#8b98ac"
GOLD = "#d4922a"
UP = "#0ca30c"
DOWN = "#e66767"
TAGLINE = "Every address in New Orleans and Metairie, explained."

# (sans, sans bold, serif bold) per font family; the first family found wins.
_FONT_SETS = [
    ("DejaVuSans.ttf", "DejaVuSans-Bold.ttf", "DejaVuSerif-Bold.ttf"),
    ("Arial.ttf", "Arial Bold.ttf", "Georgia Bold.ttf"),
]
_FONT_DIRS = [
    os.environ.get("NOLA_OG_FONT_DIR", ""),
    "/usr/share/fonts/truetype/dejavu",
    "/System/Library/Fonts/Supplemental",
]


def _font_files() -> tuple[str, str, str] | None:
    for names in _FONT_SETS:
        for d in filter(None, _FONT_DIRS):
            paths = tuple(str(Path(d) / n) for n in names)
            if all(Path(p).exists() for p in paths):
                return paths
    return None


_FILES = _font_files()


def _font(kind: int, size: int):
    """kind 0 = sans, 1 = sans bold, 2 = serif bold."""
    if _FILES:
        return ImageFont.truetype(_FILES[kind], size)
    return ImageFont.load_default(size=size)


def _wrap(draw: ImageDraw.ImageDraw, text: str, font, width: int, max_lines: int) -> list[str]:
    words, lines, line = text.split(), [], ""
    for w in words:
        trial = f"{line} {w}".strip()
        if draw.textlength(trial, font=font) <= width:
            line = trial
            continue
        if line:
            lines.append(line)
        line = w
    if line:
        lines.append(line)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        while draw.textlength(lines[-1] + "…", font=font) > width and " " in lines[-1]:
            lines[-1] = lines[-1].rsplit(" ", 1)[0]
        lines[-1] += "…"
    return lines


def card(
    path: Path, title: str, kicker: str = "", stats: list[tuple[str, str]] | None = None, subtitle: str = ""
) -> None:
    """Draw a preview card: wordmark, kicker, a title of up to two lines, up to three stat tiles.
    A signed value ("+3.2%", "-15.6%") shows green or red, as on the site. Without stats, the
    subtitle (the page's description) fills the space under the title."""
    img = Image.new("RGB", (WIDTH, HEIGHT), BG)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, WIDTH, 8], fill=GOLD)
    d.text((MARGIN, 52), "NOLA Atlas", font=_font(2, 46), fill=GOLD)
    site = "nolaatlas.com"
    site_font = _font(0, 26)
    d.text((WIDTH - MARGIN - d.textlength(site, font=site_font), 66), site, font=site_font, fill=TEXT_DIM)

    y = 150
    if kicker:
        d.text((MARGIN, y), kicker.upper(), font=_font(1, 24), fill=TEXT_DIM)
        y += 44
    stats = [s for s in (stats or []) if s[1]][:3]
    title_font = _font(1, 62 if stats else 72)
    for line in _wrap(d, title, title_font, WIDTH - 2 * MARGIN, 2 if stats else 3):
        d.text((MARGIN, y), line, font=title_font, fill=TEXT_BRIGHT)
        y += int(title_font.size * 1.18)

    if not stats and subtitle:
        sub_font = _font(0, 32)
        y += 16
        for line in _wrap(d, subtitle, sub_font, WIDTH - 2 * MARGIN, 4):
            d.text((MARGIN, y), line, font=sub_font, fill=TEXT_DIM)
            y += 46
    if stats:
        gap = 24
        tile_w = (WIDTH - 2 * MARGIN - gap * (len(stats) - 1)) // len(stats)
        top, bottom = HEIGHT - 250, HEIGHT - 100
        label_font, value_font = _font(0, 24), _font(1, 50)
        for i, (label, value) in enumerate(stats):
            x = MARGIN + i * (tile_w + gap)
            d.rounded_rectangle([x, top, x + tile_w, bottom], radius=14, fill=PANEL, outline=BORDER, width=2)
            label = _wrap(d, label, label_font, tile_w - 48, 1)[0]
            d.text((x + 24, top + 24), label, font=label_font, fill=TEXT_DIM)
            value = _wrap(d, value, value_font, tile_w - 48, 1)[0]
            color = UP if value.startswith("+") else DOWN if value.startswith("-") else TEXT_BRIGHT
            d.text((x + 24, top + 66), value, font=value_font, fill=color)

    d.text((MARGIN, HEIGHT - 66), TAGLINE, font=_font(0, 26), fill=TEXT_DIM)
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "PNG", optimize=True)
