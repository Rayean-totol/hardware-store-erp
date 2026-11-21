"""Generates the PWA icons in public/icons. Run: python3 scripts/generate-icons.py

Outputs: icon-192.png, icon-512.png (rounded "AQ" tile), icon-maskable-512.png (full bleed, content
inside the 80% safe zone), apple-touch-icon.png (180 px, full bleed; iOS applies its own corners).
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

BG = (7, 13, 26)          # #070d1a, the app background
TOP = (251, 191, 36)      # amber-400
BOTTOM = (249, 115, 22)   # orange-500
INK = (11, 18, 32)
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
OUT = Path(__file__).resolve().parent.parent / "public" / "icons"


def tile(size: int, radius: int) -> Image.Image:
    """Gradient rounded square with the AQ monogram, on a transparent background."""
    tile_img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gradient = Image.new("RGBA", (size, size))
    px = gradient.load()
    for y in range(size):
        t = y / max(1, size - 1)
        color = tuple(int(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3)) + (255,)
        for x in range(size):
            px[x, y] = color
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    tile_img.paste(gradient, (0, 0), mask)
    font = ImageFont.truetype(FONT, int(size * 0.38))
    draw = ImageDraw.Draw(tile_img)
    draw.text((size / 2, size / 2), "AQ", font=font, fill=INK, anchor="mm")
    return tile_img


def on_background(content: Image.Image, canvas: int) -> Image.Image:
    base = Image.new("RGBA", (canvas, canvas), BG + (255,))
    offset = (canvas - content.width) // 2
    base.alpha_composite(content, (offset, offset))
    return base.convert("RGB")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    # Regular: rounded tile on the app background colour, transparent corners kept.
    icon512 = tile(512, 112)
    icon512.save(OUT / "icon-512.png", optimize=True)
    icon512.resize((192, 192), Image.LANCZOS).save(OUT / "icon-192.png", optimize=True)
    # Maskable: full-bleed background, tile at 56% so everything sits inside the 80% safe zone.
    maskable = on_background(tile(288, 64), 512)
    maskable.save(OUT / "icon-maskable-512.png", optimize=True)
    # Apple touch icon: opaque, full bleed, tile at 72%.
    apple = on_background(tile(130, 30), 180)
    apple.save(OUT / "apple-touch-icon.png", optimize=True)
    print("icons written to", OUT)


if __name__ == "__main__":
    main()
