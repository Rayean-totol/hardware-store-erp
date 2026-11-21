"""Generates the ten DEMO product illustrations in docs/demo-products/images.

Run: python3 scripts/demo-products/generate_images.py
Simple drawn illustrations, not photographs. Each carries a "DEMO" band so it can never be
mistaken for a real product photo.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

SIZE = 800
BG = (244, 246, 249)
STEEL = (120, 130, 145)
DARK = (40, 46, 56)
OUT = Path(__file__).resolve().parents[2] / "docs" / "demo-products" / "images"
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def canvas():
    img = Image.new("RGB", (SIZE, SIZE), BG)
    return img, ImageDraw.Draw(img)


def demo_band(d, label):
    d.rectangle((0, SIZE - 110, SIZE, SIZE), fill=(200, 60, 40))
    f = ImageFont.truetype(FONT, 56)
    d.text((SIZE / 2, SIZE - 55), f"DEMO - {label}", font=f, fill=(255, 255, 255), anchor="mm")


def pvc_pipe(d):
    d.rounded_rectangle((120, 330, 680, 470), radius=30, fill=(235, 235, 235), outline=DARK, width=6)
    d.ellipse((90, 300, 150, 500), fill=(210, 210, 210), outline=DARK, width=5)


def pvc_elbow(d):
    d.rounded_rectangle((250, 200, 400, 600), radius=40, fill=(235, 235, 235), outline=DARK, width=6)
    d.rounded_rectangle((250, 450, 600, 600), radius=40, fill=(235, 235, 235), outline=DARK, width=6)
    d.rectangle((300, 260, 350, 540), fill=BG)


def led_bulb(d):
    d.ellipse((250, 120, 550, 420), fill=(255, 236, 150), outline=DARK, width=6)
    d.rounded_rectangle((300, 400, 500, 560), radius=20, fill=STEEL, outline=DARK, width=5)
    for y in (430, 470, 510):
        d.line((300, y, 500, y), fill=DARK, width=4)


def electrical_cable(d):
    for r in (220, 180, 140):
        d.ellipse((400 - r, 380 - r, 400 + r, 380 + r), outline=(30, 30, 30), width=34)
    d.line((400, 160, 620, 160), fill=(230, 120, 30), width=28)


def cement_bag(d):
    d.rounded_rectangle((180, 170, 620, 620), radius=36, fill=(170, 170, 165), outline=DARK, width=6)
    f = ImageFont.truetype(FONT, 58)
    d.text((400, 400), "CEMENT", font=f, fill=DARK, anchor="mm")
    d.text((400, 470), "50 kg", font=ImageFont.truetype(FONT, 44), fill=DARK, anchor="mm")


def hammer(d):
    d.rounded_rectangle((120, 230, 480, 330), radius=20, fill=STEEL, outline=DARK, width=6)
    d.rounded_rectangle((440, 170, 520, 390), radius=12, fill=STEEL, outline=DARK, width=6)
    d.rounded_rectangle((360, 330, 400, 680), radius=18, fill=(170, 110, 60), outline=DARK, width=5)


def adjustable_wrench(d):
    d.rounded_rectangle((120, 360, 620, 440), radius=40, fill=STEEL, outline=DARK, width=6)
    d.ellipse((560, 290, 740, 470), fill=STEEL, outline=DARK, width=6)
    d.rectangle((600, 340, 690, 420), fill=BG)
    d.rectangle((500, 320, 560, 360), fill=BG)


def measuring_tape(d):
    d.ellipse((220, 200, 580, 560), fill=(230, 180, 40), outline=DARK, width=6)
    d.ellipse((320, 300, 480, 460), fill=BG, outline=DARK, width=5)
    d.rectangle((560, 470, 720, 510), fill=(240, 240, 240), outline=DARK, width=4)


def bolt_and_nut(d):
    d.rectangle((370, 200, 430, 620), fill=STEEL, outline=DARK, width=4)
    d.regular_polygon((400, 220, 110), 6, fill=STEEL, outline=DARK)
    d.regular_polygon((400, 560, 110), 6, fill=(150, 160, 175), outline=DARK)
    d.ellipse((380, 380, 420, 420), fill=BG)


def plastic_bucket(d):
    d.polygon([(200, 250), (600, 250), (560, 600), (240, 600)], fill=(60, 130, 210), outline=DARK)
    d.arc((170, 150, 630, 400), 180, 360, fill=DARK, width=14)


ITEMS = [
    ("demo-pvc-pipe.png", pvc_pipe, "PVC PIPE"),
    ("demo-pvc-elbow.png", pvc_elbow, "PVC ELBOW"),
    ("demo-led-bulb.png", led_bulb, "LED BULB"),
    ("demo-electrical-cable.png", electrical_cable, "CABLE"),
    ("demo-cement-bag.png", cement_bag, "CEMENT"),
    ("demo-hammer.png", hammer, "HAMMER"),
    ("demo-adjustable-wrench.png", adjustable_wrench, "WRENCH"),
    ("demo-measuring-tape.png", measuring_tape, "TAPE"),
    ("demo-bolt-and-nut.png", bolt_and_nut, "BOLT & NUT"),
    ("demo-plastic-bucket.png", plastic_bucket, "BUCKET"),
]

if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name, draw, label in ITEMS:
        img, d = canvas()
        draw(d)
        demo_band(d, label)
        img.save(OUT / name, optimize=True)
        print("wrote", OUT / name)
