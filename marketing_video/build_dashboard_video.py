from __future__ import annotations

import json
import math
import subprocess
from pathlib import Path

import imageio_ffmpeg
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

from dashboard_scenes import SCENES


ROOT = Path(__file__).resolve().parent
CAPTURES = ROOT / "dashboard_captures"
VOICE_DIR = ROOT / "dashboard_voice"
SCENE_DIR = ROOT / "dashboard_scenes"
CLIP_DIR = ROOT / "dashboard_clips"
METADATA_PATH = ROOT / "dashboard-voice-metadata.json"
OUTPUT = ROOT / "portfolio-tracker-dashboard-guide.mp4"

WIDTH = 1920
HEIGHT = 1080
FPS = 30

ACCENT = (51, 174, 255)
GREEN = (55, 232, 156)
CYAN = (12, 194, 222)
ORANGE = (255, 150, 55)
WHITE = (244, 249, 255)
MUTED = (174, 198, 225)


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(Path("C:/Windows/Fonts") / name), size=size)


FONT_BOLD_76 = font("segoeuib.ttf", 76)
FONT_BOLD_48 = font("segoeuib.ttf", 48)
FONT_BOLD_26 = font("segoeuib.ttf", 26)
FONT_REG_32 = font("segoeui.ttf", 32)
FONT_REG_25 = font("segoeui.ttf", 25)
FONT_REG_21 = font("segoeui.ttf", 21)


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


def accent_for(index: int) -> tuple[int, int, int]:
    return [ACCENT, GREEN, CYAN, ORANGE][index % 4]


def lower_third(image: Image.Image, scene: dict, accent: tuple[int, int, int]) -> Image.Image:
    canvas = image.convert("RGBA")
    overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    start = 810
    for y in range(start, HEIGHT):
        progress = (y - start) / (HEIGHT - start)
        alpha = int(20 + 226 * (progress ** 1.25))
        draw.line((0, y, WIDTH, y), fill=(3, 8, 20, alpha))
    canvas = Image.alpha_composite(canvas, overlay)
    draw = ImageDraw.Draw(canvas, "RGBA")
    draw.rounded_rectangle((62, 838, 62 + 325, 884), radius=23, fill=(*accent, 238))
    draw.text((82, 847), scene["eyebrow"], font=FONT_BOLD_21, fill=(4, 13, 28, 255))
    draw.text((62, 900), scene["title"], font=FONT_BOLD_48, fill=WHITE)
    draw.text((64, 969), scene["subtitle"], font=FONT_REG_25, fill=MUTED)
    return canvas.convert("RGB")


FONT_BOLD_21 = font("segoeuib.ttf", 21)


def title_card(source: Image.Image, scene: dict) -> Image.Image:
    background = source.filter(ImageFilter.GaussianBlur(17))
    background = ImageEnhance.Brightness(background).enhance(0.24).convert("RGBA")
    card = Image.alpha_composite(background, Image.new("RGBA", background.size, (4, 10, 28, 165)))
    draw = ImageDraw.Draw(card, "RGBA")
    icon_path = ROOT.parent / "public" / "app-icon.png"
    if icon_path.exists():
        icon = Image.open(icon_path).convert("RGBA")
        icon.thumbnail((138, 138), Image.Resampling.LANCZOS)
        card.alpha_composite(icon, (104, 126))
    draw.text((104, 310), "Portfolio Dashboard", font=FONT_BOLD_76, fill=WHITE)
    draw.text((108, 416), "A complete guide to every section, control, and view.", font=FONT_REG_32, fill=MUTED)
    draw.rounded_rectangle((104, 530, 1325, 620), radius=26, fill=(11, 27, 61, 225), outline=(*ACCENT, 165), width=2)
    draw.text((140, 555), "PERFORMANCE  •  INCOME  •  RISK  •  ALLOCATION  •  HOLDINGS", font=FONT_BOLD_26, fill=ACCENT)
    draw.text((108, 936), "Portfolio Tracker detailed screen guide", font=FONT_REG_21, fill=(145, 177, 212))
    return card.convert("RGB")


def outro_card(source: Image.Image, scene: dict) -> Image.Image:
    background = source.filter(ImageFilter.GaussianBlur(18))
    background = ImageEnhance.Brightness(background).enhance(0.22).convert("RGBA")
    card = Image.alpha_composite(background, Image.new("RGBA", background.size, (3, 9, 26, 180)))
    draw = ImageDraw.Draw(card, "RGBA")
    draw.text((116, 220), "Monitor the account.", font=FONT_BOLD_76, fill=WHITE)
    draw.text((116, 335), "Understand the drivers.", font=FONT_BOLD_76, fill=ACCENT)
    draw.text((116, 450), "Review every holding.", font=FONT_BOLD_76, fill=WHITE)
    draw.rounded_rectangle((116, 626, 860, 730), radius=28, fill=(13, 62, 111, 230), outline=(*ACCENT, 220), width=2)
    draw.text((158, 651), "Portfolio Tracker", font=FONT_BOLD_48, fill=WHITE)
    draw.text((116, 956), "For informational purposes only. Not financial advice.", font=FONT_REG_21, fill=(145, 174, 207))
    return card.convert("RGB")


def prepare_scenes() -> list[Path]:
    SCENE_DIR.mkdir(parents=True, exist_ok=True)
    paths = []
    for index, scene in enumerate(SCENES):
        capture_path = CAPTURES / scene["capture"]
        if not capture_path.exists():
            raise FileNotFoundError(f"Missing dashboard capture: {capture_path}")
        source = fit_1080(Image.open(capture_path))
        if scene.get("kind") == "title":
            composed = title_card(source, scene)
        elif scene.get("kind") == "outro":
            composed = outro_card(source, scene)
        else:
            composed = lower_third(source, scene, accent_for(index))
        destination = SCENE_DIR / f"{index:02d}-{scene['id']}.png"
        composed.save(destination, quality=96)
        paths.append(destination)
    return paths


def render_clip(ffmpeg: str, scene_path: Path, audio_path: Path, duration: float, destination: Path) -> None:
    frames = max(1, round(duration * FPS))
    video_filter = (
        f"scale={WIDTH}:{HEIGHT},"
        f"zoompan=z='1+0.012*on/{frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
        f"d={frames}:s={WIDTH}x{HEIGHT}:fps={FPS},setsar=1,format=yuv420p[v]"
    )
    audio_filter = f"[1:a]adelay=500|500,aresample=48000,apad,atrim=duration={duration:.3f}[a]"
    command = [
        ffmpeg, "-y",
        "-loop", "1", "-framerate", str(FPS), "-i", str(scene_path),
        "-i", str(audio_path),
        "-filter_complex", f"[0:v]{video_filter};{audio_filter}",
        "-map", "[v]", "-map", "[a]",
        "-t", f"{duration:.3f}",
        "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
        "-movflags", "+faststart",
        str(destination),
    ]
    subprocess.run(command, check=True)


def concatenate(ffmpeg: str, clips: list[Path]) -> None:
    list_path = CLIP_DIR / "concat.txt"
    list_path.write_text(
        "\n".join(f"file '{clip.resolve().as_posix()}'" for clip in clips),
        encoding="utf-8",
    )
    subprocess.run([
        ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", str(list_path),
        "-c", "copy", "-movflags", "+faststart", str(OUTPUT),
    ], check=True)


def main() -> None:
    metadata = json.loads(METADATA_PATH.read_text(encoding="utf-8"))
    timing = {item["id"]: item for item in metadata["scenes"]}
    scene_paths = prepare_scenes()
    CLIP_DIR.mkdir(parents=True, exist_ok=True)
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    clips = []

    for index, (scene, scene_path) in enumerate(zip(SCENES, scene_paths), start=1):
        item = timing[scene["id"]]
        audio_path = VOICE_DIR / item["audio"]
        if not audio_path.exists():
            raise FileNotFoundError(f"Missing narration clip: {audio_path}")
        destination = CLIP_DIR / f"{index:02d}-{scene['id']}.mp4"
        print(f"Rendering scene {index}/{len(SCENES)}: {scene['title']} ({item['scene_duration']:.1f}s)", flush=True)
        render_clip(ffmpeg, scene_path, audio_path, item["scene_duration"], destination)
        clips.append(destination)

    concatenate(ffmpeg, clips)
    print(f"Created {OUTPUT} ({metadata['total_duration']:.1f}s).")


if __name__ == "__main__":
    main()

