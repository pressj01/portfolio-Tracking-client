from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
PUBLIC_DIR = ROOT / "public"
PNG_PATH = PUBLIC_DIR / "app-icon.png"
ICO_PATH = PUBLIC_DIR / "app-icon.ico"


def hex_points(cx, cy, radius):
    return [
        (cx, cy - radius),
        (cx + radius * 0.866, cy - radius * 0.5),
        (cx + radius * 0.866, cy + radius * 0.5),
        (cx, cy + radius),
        (cx - radius * 0.866, cy + radius * 0.5),
        (cx - radius * 0.866, cy - radius * 0.5),
    ]


def scaled(points, scale):
    return [(round(x * scale), round(y * scale)) for x, y in points]


def make_icon(size=512):
    base = 512
    scale = size / base
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image, "RGBA")

    cx = cy = base / 2
    radius = 172
    top, upper_right, lower_right, bottom, lower_left, upper_left = hex_points(cx, cy, radius)
    center = (cx, cy)

    shadow = [(x, y + 18) for x, y in hex_points(cx, cy, radius)]
    left_face = [top, center, bottom, lower_left, upper_left]
    right_face = [top, upper_right, lower_right, bottom, center]
    top_face = [top, upper_right, center, upper_left]

    draw.polygon(scaled(shadow, scale), fill=(15, 58, 35, 46))
    draw.polygon(scaled(left_face, scale), fill=(74, 163, 73, 255))
    draw.polygon(scaled(right_face, scale), fill=(35, 128, 52, 255))
    draw.polygon(scaled(top_face, scale), fill=(111, 195, 91, 255))

    ridge = [(cx, cy - radius * 0.9), (cx, cy + radius * 0.86)]
    draw.line(scaled(ridge, scale), fill=(25, 96, 43, 120), width=max(1, round(10 * scale)))

    return image


def main():
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    icon = make_icon()
    icon.save(PNG_PATH)
    icon.save(ICO_PATH, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print(f"Wrote {PNG_PATH}")
    print(f"Wrote {ICO_PATH}")


if __name__ == "__main__":
    main()
