"""Generate the native tab-bar icons for the department/quest theme."""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "icons"
SCALE = 4
SIZE = 81
COLORS = {
    "muted": "#9D8A6B",
    "active": "#E3BB63",
}


def scaled(box):
    return tuple(value * SCALE for value in box)


def draw_quest(draw, color):
    """A department quest shield with an exclamation mark."""
    points = [
        (40.5, 11),
        (64, 20),
        (62, 43),
        (40.5, 70),
        (19, 43),
        (17, 20),
    ]
    draw.polygon([(x * SCALE, y * SCALE) for x, y in points], outline=color, width=4 * SCALE)
    draw.rounded_rectangle(
        scaled((37, 25, 45, 47)),
        radius=4 * SCALE,
        fill=color,
    )
    draw.rounded_rectangle(
        scaled((37, 52, 45, 61)),
        radius=4 * SCALE,
        fill=color,
    )


def draw_profile(draw, color):
    """A hooded adventurer bust."""
    draw.ellipse(scaled((29, 14, 53, 38)), fill=color)
    draw.rounded_rectangle(scaled((17, 43, 64, 70)), radius=24 * SCALE, fill=color)
    draw.polygon(
        [
            (24 * SCALE, 22 * SCALE),
            (40.5 * SCALE, 7 * SCALE),
            (57 * SCALE, 22 * SCALE),
            (50 * SCALE, 25 * SCALE),
            (31 * SCALE, 25 * SCALE),
        ],
        fill=color,
    )


def make_icon(name, color, painter):
    canvas = Image.new("RGBA", (SIZE * SCALE, SIZE * SCALE), (0, 0, 0, 0))
    painter(ImageDraw.Draw(canvas), color)
    canvas.resize((SIZE, SIZE), Image.Resampling.LANCZOS).save(OUT / name)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    make_icon("board.png", COLORS["muted"], draw_quest)
    make_icon("board-active.png", COLORS["active"], draw_quest)
    make_icon("profile.png", COLORS["muted"], draw_profile)
    make_icon("profile-active.png", COLORS["active"], draw_profile)
    print("Generated department tab icons in", OUT)


if __name__ == "__main__":
    main()
