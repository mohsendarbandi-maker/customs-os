from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "pwa"
OUT.mkdir(parents=True, exist_ok=True)

PRIMARY = "#0F4C81"
CYAN = "#18B6C9"
WHITE = "#FFFFFF"

def render(size: int, maskable: bool = False, monochrome: bool = False) -> Image.Image:
    image = Image.new("RGBA", (size, size), PRIMARY)
    draw = ImageDraw.Draw(image)
    scale = size / 1024.0
    margin = 80 if maskable else 32
    radius = 145 if maskable else 220
    draw.rounded_rectangle(
        (margin * scale, margin * scale, size - margin * scale, size - margin * scale),
        radius=radius * scale,
        fill=PRIMARY,
    )
    stroke = max(2, round(30 * scale))
    accent = WHITE if monochrome else CYAN

    def line(points, fill):
        draw.line([(round(x * scale), round(y * scale)) for x, y in points], fill=fill, width=stroke, joint="curve")

    line([(190,760),(190,300),(512,155),(834,300),(834,760)], WHITE)
    line([(190,300),(834,300)], WHITE)
    for y in (405,510,615,720):
        line([(300,y),(724,y)], WHITE)
    line([(342,300),(342,242),(512,166),(682,242),(682,300)], WHITE)
    line([(512,166),(512,105)], WHITE)
    line([(145,824),(879,824)], accent)
    line([(365,760),(365,655)], accent)
    line([(512,760),(512,570)], accent)
    line([(659,760),(659,655)], accent)
    return image

for filename, size, maskable, monochrome in [
    ("icon-192.png", 192, False, False),
    ("icon-512.png", 512, False, False),
    ("icon-192-maskable.png", 192, True, False),
    ("icon-512-maskable.png", 512, True, False),
    ("monochrome-96.png", 96, False, True),
    ("apple-touch-icon-180.png", 180, False, False),
]:
    render(size, maskable, monochrome).save(OUT / filename, "PNG", optimize=True)

badge = Image.new("RGBA", (96, 96), PRIMARY)
d = ImageDraw.Draw(badge)
d.line([(14,68),(82,68)], fill=WHITE, width=8)
d.line([(30,30),(30,60)], fill=WHITE, width=8)
d.line([(48,22),(48,60)], fill=WHITE, width=8)
d.line([(66,30),(66,60)], fill=WHITE, width=8)
badge.save(OUT / "badge-96.png", "PNG", optimize=True)

print(f"Generated PWA icons in {OUT}")
