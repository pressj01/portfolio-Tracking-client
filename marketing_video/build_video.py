from __future__ import annotations

import math
import subprocess
import sys
import textwrap
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont
import imageio_ffmpeg


ROOT = Path(__file__).resolve().parent
CAPTURES = ROOT / "captures"
SCENES = ROOT / "scenes"
OUTPUT = ROOT / "portfolio-tracker-marketing-demo.mp4"
NARRATION = ROOT / "narration.mp3"

WIDTH = 1920
HEIGHT = 1080
FPS = 30
TRANSITION_SECONDS = 0.8

ACCENT = (51, 174, 255)
CYAN = (12, 194, 222)
INK = (7, 12, 27)
WHITE = (244, 249, 255)
MUTED = (172, 197, 224)


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    path = Path("C:/Windows/Fonts") / name
    return ImageFont.truetype(str(path), size=size)


FONT_BOLD_74 = font("segoeuib.ttf", 74)
FONT_BOLD_58 = font("segoeuib.ttf", 58)
FONT_BOLD_48 = font("segoeuib.ttf", 48)
FONT_BOLD_30 = font("segoeuib.ttf", 30)
FONT_REG_32 = font("segoeui.ttf", 32)
FONT_REG_27 = font("segoeui.ttf", 27)
FONT_REG_22 = font("segoeui.ttf", 22)


def fit_1080(image: Image.Image) -> Image.Image:
    image = image.convert("RGB")
    ratio = max(WIDTH / image.width, HEIGHT / image.height)
    resized = image.resize(
        (math.ceil(image.width * ratio), math.ceil(image.height * ratio)),
        Image.Resampling.LANCZOS,
    )
    left = (resized.width - WIDTH) // 2
    top = (resized.height - HEIGHT) // 2
    return resized.crop((left, top, left + WIDTH, top + HEIGHT))


def add_footer_gradient(canvas: Image.Image) -> Image.Image:
    overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    start = 760
    for y in range(start, HEIGHT):
        p = (y - start) / (HEIGHT - start)
        alpha = int(30 + 210 * (p ** 1.45))
        draw.line((0, y, WIDTH, y), fill=(3, 8, 20, alpha))
    return Image.alpha_composite(canvas.convert("RGBA"), overlay)


def add_scene_copy(
    source: Path,
    destination: Path,
    eyebrow: str,
    title: str,
    subtitle: str,
    accent: tuple[int, int, int] = ACCENT,
) -> None:
    base = fit_1080(Image.open(source))
    base = ImageEnhance.Color(base).enhance(1.04)
    base = add_footer_gradient(base)
    draw = ImageDraw.Draw(base, "RGBA")

    x = 64
    draw.rounded_rectangle((x, 812, x + 255, 858), radius=22, fill=(*accent, 235))
    draw.text((x + 20, 821), eyebrow.upper(), font=FONT_BOLD_22, fill=(5, 15, 30, 255))
    draw.text((x, 873), title, font=FONT_BOLD_48, fill=WHITE)
    draw.text((x, 943), subtitle, font=FONT_REG_27, fill=MUTED)

    destination.parent.mkdir(parents=True, exist_ok=True)
    base.convert("RGB").save(destination, quality=96)


FONT_BOLD_22 = font("segoeuib.ttf", 22)


def make_title_card(destination: Path) -> None:
    background = fit_1080(Image.open(CAPTURES / "01-dashboard.png"))
    background = background.filter(ImageFilter.GaussianBlur(15))
    background = ImageEnhance.Brightness(background).enhance(0.28).convert("RGBA")

    tint = Image.new("RGBA", background.size, (5, 12, 31, 135))
    card = Image.alpha_composite(background, tint)
    draw = ImageDraw.Draw(card, "RGBA")

    icon_path = ROOT.parent / "public" / "app-icon.png"
    if icon_path.exists():
        icon = Image.open(icon_path).convert("RGBA")
        icon.thumbnail((140, 140), Image.Resampling.LANCZOS)
        card.alpha_composite(icon, (104, 150))

    draw.text((104, 325), "Portfolio Tracker", font=FONT_BOLD_74, fill=WHITE)
    draw.text((108, 426), "See the whole portfolio. Understand every position.", font=FONT_REG_32, fill=MUTED)

    draw.rounded_rectangle((104, 518, 895, 610), radius=24, fill=(11, 27, 61, 225), outline=(*ACCENT, 150), width=2)
    draw.text((140, 544), "DASHBOARD  •  HOLDINGS  •  ETF COMPARER", font=FONT_BOLD_30, fill=ACCENT)

    chips = [("SPYI", ACCENT), ("TSPY", (255, 140, 38)), ("GPIX", CYAN)]
    cx = 108
    for label, color in chips:
        draw.rounded_rectangle((cx, 682, cx + 152, 744), radius=24, fill=(7, 16, 38, 235), outline=(*color, 230), width=3)
        draw.text((cx + 34, 695), label, font=FONT_BOLD_30, fill=color)
        cx += 176

    draw.text((108, 915), "A one-minute product tour", font=FONT_REG_22, fill=(139, 172, 211))
    destination.parent.mkdir(parents=True, exist_ok=True)
    card.convert("RGB").save(destination, quality=96)


def make_outro_card(destination: Path) -> None:
    background = fit_1080(Image.open(CAPTURES / "03-etf-comparer.png"))
    background = background.filter(ImageFilter.GaussianBlur(18))
    background = ImageEnhance.Brightness(background).enhance(0.22).convert("RGBA")
    card = Image.alpha_composite(background, Image.new("RGBA", background.size, (4, 10, 27, 175)))
    draw = ImageDraw.Draw(card, "RGBA")

    draw.text((116, 258), "See clearly.", font=FONT_BOLD_74, fill=WHITE)
    draw.text((116, 365), "Research with context.", font=FONT_BOLD_74, fill=ACCENT)
    draw.text((116, 472), "Compare with confidence.", font=FONT_BOLD_74, fill=WHITE)
    draw.rounded_rectangle((116, 620, 800, 722), radius=26, fill=(13, 62, 111, 230), outline=(*ACCENT, 220), width=2)
    draw.text((154, 642), "Portfolio Tracker", font=FONT_BOLD_48, fill=WHITE)
    draw.text((116, 958), "For informational purposes only. Not financial advice.", font=FONT_REG_22, fill=(137, 166, 198))

    destination.parent.mkdir(parents=True, exist_ok=True)
    card.convert("RGB").save(destination, quality=96)


def prepare_scenes() -> list[tuple[Path, float, float, int]]:
    SCENES.mkdir(parents=True, exist_ok=True)
    make_title_card(SCENES / "00-title.png")

    add_scene_copy(
        CAPTURES / "01-dashboard.png",
        SCENES / "01-dashboard.png",
        "One connected view",
        "The full portfolio story — at a glance",
        "Value, income, performance, and risk stay in the same frame.",
    )
    add_scene_copy(
        CAPTURES / "02-spyi-holding.png",
        SCENES / "02-holding.png",
        "Position intelligence",
        "Go from a holding to the context behind it",
        "SPYI: position, yield, NAV trend, coverage, checklist, and risk.",
        (55, 232, 156),
    )
    add_scene_copy(
        CAPTURES / "03-etf-comparer.png",
        SCENES / "03-comparer.png",
        "Side-by-side research",
        "Compare SPYI, TSPY, and GPIX on one timeline",
        "Change the window, switch return views, and keep every fund aligned.",
        CYAN,
    )
    add_scene_copy(
        CAPTURES / "04-etf-comparer-details.png",
        SCENES / "04-details.png",
        "Comparable context",
        "Go beyond a single return number",
        "Yield, assets, costs, common history, and inception — in one screen.",
        (255, 140, 38),
    )
    make_outro_card(SCENES / "05-outro.png")

    return [
        (SCENES / "00-title.png", 5.5, 0.012, 1),
        (SCENES / "01-dashboard.png", 13.5, 0.032, -1),
        (SCENES / "02-holding.png", 17.0, 0.028, 1),
        (SCENES / "03-comparer.png", 13.0, 0.032, -1),
        (SCENES / "04-details.png", 8.0, 0.025, 1),
        (SCENES / "05-outro.png", 7.0, 0.012, -1),
    ]


def render_motion(base: Image.Image, progress: float, zoom_amount: float, direction: int) -> Image.Image:
    eased = 0.5 - 0.5 * math.cos(math.pi * max(0.0, min(1.0, progress)))
    scale = 1.0 + zoom_amount * eased
    resized = base.resize((math.ceil(WIDTH * scale), math.ceil(HEIGHT * scale)), Image.Resampling.BICUBIC)
    max_x = resized.width - WIDTH
    max_y = resized.height - HEIGHT
    x_center = max_x / 2
    y_center = max_y / 2
    x_shift = direction * max_x * 0.28 * (eased - 0.5)
    y_shift = max_y * 0.12 * (0.5 - eased)
    left = int(max(0, min(max_x, x_center + x_shift)))
    top = int(max(0, min(max_y, y_center + y_shift)))
    return resized.crop((left, top, left + WIDTH, top + HEIGHT))


def render_video(scenes: list[tuple[Path, float, float, int]]) -> None:
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    total_duration = sum(scene[1] for scene in scenes)
    fade_out_start = 58.3
    command = [
        ffmpeg,
        "-y",
        "-f", "rawvideo",
        "-pix_fmt", "rgb24",
        "-s", f"{WIDTH}x{HEIGHT}",
        "-r", str(FPS),
        "-i", "pipe:0",
        "-i", str(NARRATION),
        "-filter_complex", f"[1:a]afade=t=in:st=0:d=0.35,afade=t=out:st={fade_out_start}:d=1.2,apad=pad_dur=8[a]",
        "-map", "0:v:0",
        "-map", "[a]",
        "-t", f"{total_duration:.3f}",
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "192k",
        "-movflags", "+faststart",
        str(OUTPUT),
    ]

    images = [Image.open(scene[0]).convert("RGB") for scene in scenes]
    transition_frames = round(TRANSITION_SECONDS * FPS)

    process = subprocess.Popen(command, stdin=subprocess.PIPE)
    assert process.stdin is not None
    try:
        for scene_index, (_, duration, zoom_amount, direction) in enumerate(scenes):
            frame_count = round(duration * FPS)
            print(f"Rendering scene {scene_index + 1}/{len(scenes)} ({duration:.1f}s)", flush=True)
            for frame_index in range(frame_count):
                progress = frame_index / max(1, frame_count - 1)
                frame = render_motion(images[scene_index], progress, zoom_amount, direction)

                if scene_index < len(scenes) - 1 and frame_index >= frame_count - transition_frames:
                    transition_progress = (frame_index - (frame_count - transition_frames)) / max(1, transition_frames - 1)
                    next_scene = scenes[scene_index + 1]
                    next_frame = render_motion(images[scene_index + 1], transition_progress * 0.08, next_scene[2], next_scene[3])
                    smooth = transition_progress * transition_progress * (3 - 2 * transition_progress)
                    frame = Image.blend(frame, next_frame, smooth)

                process.stdin.write(frame.tobytes())
    finally:
        process.stdin.close()

    return_code = process.wait()
    if return_code != 0:
        raise SystemExit(f"ffmpeg failed with exit code {return_code}")


def main() -> None:
    if not NARRATION.exists():
        raise SystemExit(f"Missing narration: {NARRATION}")
    scenes = prepare_scenes()
    render_video(scenes)
    print(f"Created {OUTPUT}")


if __name__ == "__main__":
    main()
