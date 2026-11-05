from __future__ import annotations

import json
import math
import subprocess
from pathlib import Path

import imageio_ffmpeg
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

from gumroad_overview_scenes import SCENES


PROJECT = Path(__file__).resolve().parent.parent
ROOT = Path(__file__).resolve().parent
FRAME_DIR = ROOT / "gumroad_overview_scenes"
CLIP_DIR = ROOT / "gumroad_overview_clips"
VOICE_DIR = ROOT / "gumroad_overview_voice"
METADATA = ROOT / "gumroad-overview-voice-metadata.json"
OUTPUT = ROOT / "portfolio-tracker-gumroad-overview.mp4"
CONTACT_SHEET = ROOT / "gumroad-overview-contact-sheet.jpg"

WIDTH = 1920
HEIGHT = 1080
FPS = 30
ACCENT = (69, 181, 255)
CYAN = (31, 211, 238)
GREEN = (69, 238, 155)
ORANGE = (255, 164, 73)
INK = (4, 10, 25)
WHITE = (244, 249, 255)
MUTED = (176, 199, 225)


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(Path("C:/Windows/Fonts") / name), size=size)


FONT_BOLD_76 = font("segoeuib.ttf", 76)
FONT_BOLD_58 = font("segoeuib.ttf", 58)
FONT_BOLD_32 = font("segoeuib.ttf", 32)
FONT_BOLD_22 = font("segoeuib.ttf", 22)
FONT_REG_36 = font("segoeui.ttf", 36)
FONT_REG_28 = font("segoeui.ttf", 28)
FONT_REG_24 = font("segoeui.ttf", 24)


def protect_values(image: Image.Image, boxes: list[tuple[int, int, int, int]]) -> Image.Image:
    protected = image.copy()
    for left, top, right, bottom in boxes:
        box = (max(0, left), max(0, top), min(protected.width, right), min(protected.height, bottom))
        if box[2] <= box[0] or box[3] <= box[1]:
            continue
        region = protected.crop(box)
        tiny = region.resize((max(1, region.width // 24), max(1, region.height // 16)), Image.Resampling.BILINEAR)
        region = tiny.resize(region.size, Image.Resampling.NEAREST).filter(ImageFilter.GaussianBlur(12))
        protected.paste(region, box)
    return protected


def cover_1080(image: Image.Image) -> Image.Image:
    image = image.convert("RGB")
    ratio = max(WIDTH / image.width, HEIGHT / image.height)
    resized = image.resize((math.ceil(image.width * ratio), math.ceil(image.height * ratio)), Image.Resampling.LANCZOS)
    left = (resized.width - WIDTH) // 2
    top = (resized.height - HEIGHT) // 2
    return resized.crop((left, top, left + WIDTH, top + HEIGHT))


def screen_frame(source_path: Path, privacy_boxes, label: str, destination: Path) -> None:
    source = protect_values(Image.open(source_path).convert("RGB"), privacy_boxes)
    background = cover_1080(source).filter(ImageFilter.GaussianBlur(22))
    background = ImageEnhance.Brightness(background).enhance(0.20).convert("RGBA")
    canvas = Image.alpha_composite(background, Image.new("RGBA", (WIDTH, HEIGHT), (2, 7, 20, 118)))

    foreground = source.copy()
    foreground.thumbnail((WIDTH - 32, HEIGHT - 32), Image.Resampling.LANCZOS)
    x = (WIDTH - foreground.width) // 2
    y = (HEIGHT - foreground.height) // 2
    canvas.alpha_composite(foreground.convert("RGBA"), (x, y))

    draw = ImageDraw.Draw(canvas, "RGBA")
    draw.rounded_rectangle((x - 2, y - 2, x + foreground.width + 2, y + foreground.height + 2),
                           radius=8, outline=(92, 150, 210, 150), width=2)
    label_width = max(190, int(draw.textlength(label, font=FONT_BOLD_22)) + 54)
    label_box = (WIDTH - label_width - 30, 24, WIDTH - 30, 70)
    draw.rounded_rectangle(label_box, radius=23, fill=(5, 18, 42, 226), outline=(*ACCENT, 190), width=2)
    draw.text((label_box[0] + 26, label_box[1] + 9), label, font=FONT_BOLD_22, fill=ACCENT)
    canvas.convert("RGB").save(destination, quality=96)


def dashboard_background() -> Image.Image:
    return cover_1080(Image.open(PROJECT / "marketing_video/dashboard_captures/01-headline-metrics.png").convert("RGB"))


def title_frame(scene: dict, destination: Path) -> None:
    background = dashboard_background().filter(ImageFilter.GaussianBlur(17))
    background = ImageEnhance.Brightness(background).enhance(0.23).convert("RGBA")
    canvas = Image.alpha_composite(background, Image.new("RGBA", background.size, (3, 9, 25, 166)))
    draw = ImageDraw.Draw(canvas, "RGBA")
    icon_path = PROJECT / "public/app-icon.png"
    if icon_path.exists():
        icon = Image.open(icon_path).convert("RGBA")
        icon.thumbnail((150, 150), Image.Resampling.LANCZOS)
        canvas.alpha_composite(icon, (108, 130))
    draw.text((108, 326), scene["title"], font=FONT_BOLD_76, fill=WHITE)
    draw.text((112, 438), scene["subtitle"], font=FONT_REG_36, fill=MUTED)
    draw.rounded_rectangle((108, 570, 1370, 668), radius=28, fill=(11, 33, 70, 228), outline=(*ACCENT, 180), width=2)
    draw.text((150, 596), "DASHBOARD  •  RETURNS  •  GROWTH  •  WATCHLISTS  •  INCOME", font=FONT_BOLD_32, fill=ACCENT)
    draw.text((112, 944), "A screen-first Portfolio Tracker walkthrough", font=FONT_REG_24, fill=(147, 176, 210))
    canvas.convert("RGB").save(destination, quality=96)


def watchlist_home_frame(destination: Path) -> None:
    source = cover_1080(Image.open(PROJECT / "public/help-screenshots/watchlist/list.png").convert("RGB"))
    background = ImageEnhance.Brightness(source.filter(ImageFilter.GaussianBlur(8))).enhance(0.27).convert("RGBA")
    canvas = Image.alpha_composite(background, Image.new("RGBA", background.size, (4, 10, 25, 110)))
    draw = ImageDraw.Draw(canvas, "RGBA")
    draw.rounded_rectangle((140, 120, 1780, 810), radius=32, fill=(11, 25, 53, 247), outline=(*ACCENT, 210), width=3)
    draw.text((220, 178), "Show the watchlist on the Dashboard", font=FONT_BOLD_58, fill=WHITE)
    draw.text((224, 260), "The same Watchlists setting controls whether the Home card is visible.", font=FONT_REG_28, fill=MUTED)

    draw.rounded_rectangle((220, 350, 910, 680), radius=24, fill=(22, 48, 91, 245), outline=(64, 124, 186, 220), width=2)
    draw.text((270, 398), "ON", font=FONT_BOLD_32, fill=GREEN)
    draw.rounded_rectangle((716, 390, 846, 450), radius=30, fill=(*GREEN, 235))
    draw.ellipse((794, 398, 838, 442), fill=WHITE)
    draw.text((270, 494), "Home watchlist card is visible", font=FONT_BOLD_32, fill=WHITE)
    draw.text((270, 560), "Use the card picker to change lists.", font=FONT_REG_24, fill=MUTED)

    draw.rounded_rectangle((1010, 350, 1700, 680), radius=24, fill=(22, 48, 91, 245), outline=(64, 124, 186, 220), width=2)
    draw.text((1060, 398), "OFF", font=FONT_BOLD_32, fill=ORANGE)
    draw.rounded_rectangle((1506, 390, 1636, 450), radius=30, fill=(58, 72, 99, 235))
    draw.ellipse((1514, 398, 1558, 442), fill=WHITE)
    draw.text((1060, 494), "Home watchlist card is removed", font=FONT_BOLD_32, fill=WHITE)
    draw.text((1060, 560), "Your saved lists and notes remain.", font=FONT_REG_24, fill=MUTED)
    canvas.convert("RGB").save(destination, quality=96)


def outro_frame(destination: Path) -> None:
    background = dashboard_background().filter(ImageFilter.GaussianBlur(19))
    background = ImageEnhance.Brightness(background).enhance(0.20).convert("RGBA")
    canvas = Image.alpha_composite(background, Image.new("RGBA", background.size, (2, 8, 24, 184)))
    draw = ImageDraw.Draw(canvas, "RGBA")
    draw.text((122, 240), "Monitor the complete picture.", font=FONT_BOLD_76, fill=WHITE)
    draw.text((122, 358), "Understand what is driving it.", font=FONT_BOLD_76, fill=ACCENT)
    draw.text((122, 476), "Plan the growth and income ahead.", font=FONT_BOLD_76, fill=WHITE)
    draw.rounded_rectangle((122, 660, 860, 770), radius=30, fill=(13, 63, 112, 232), outline=(*ACCENT, 220), width=2)
    draw.text((172, 686), "Portfolio Tracker", font=FONT_BOLD_58, fill=WHITE)
    draw.text((122, 954), "For informational purposes only. Not financial advice.", font=FONT_REG_24, fill=(151, 180, 211))
    canvas.convert("RGB").save(destination, quality=96)


def prepare_frames() -> list[list[Path]]:
    FRAME_DIR.mkdir(parents=True, exist_ok=True)
    scene_frames: list[list[Path]] = []
    for scene in SCENES:
        frames: list[Path] = []
        if scene.get("kind") == "title":
            destination = FRAME_DIR / f"{scene['id']}-00.jpg"
            title_frame(scene, destination)
            frames.append(destination)
        elif scene.get("kind") == "outro":
            destination = FRAME_DIR / f"{scene['id']}-00.jpg"
            outro_frame(destination)
            frames.append(destination)
        else:
            for index, item in enumerate(scene["shots"]):
                destination = FRAME_DIR / f"{scene['id']}-{index:02d}.jpg"
                if item.get("kind") == "watchlist-home-graphic":
                    watchlist_home_frame(destination)
                else:
                    screen_frame(PROJECT / item["path"], item.get("privacy_boxes", []), scene["eyebrow"], destination)
                frames.append(destination)
        scene_frames.append(frames)
    return scene_frames


def render_contact_sheet(scene_frames: list[list[Path]]) -> None:
    frames = [frame for group in scene_frames for frame in group]
    thumb_w, thumb_h = 384, 216
    columns = 4
    rows = math.ceil(len(frames) / columns)
    sheet = Image.new("RGB", (thumb_w * columns, thumb_h * rows), INK)
    for index, frame in enumerate(frames):
        thumb = Image.open(frame).convert("RGB").resize((thumb_w, thumb_h), Image.Resampling.LANCZOS)
        sheet.paste(thumb, ((index % columns) * thumb_w, (index // columns) * thumb_h))
    sheet.save(CONTACT_SHEET, quality=92)


def render_transition_clip(ffmpeg: str, before: Path, after: Path, frame_count: int, destination: Path) -> None:
    first = Image.open(before).convert("RGB")
    second = Image.open(after).convert("RGB")
    command = [
        ffmpeg, "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{WIDTH}x{HEIGHT}",
        "-r", str(FPS), "-i", "-", "-an", "-c:v", "libx264", "-preset", "medium",
        "-crf", "18", "-pix_fmt", "yuv420p", "-r", str(FPS), str(destination),
    ]
    process = subprocess.Popen(command, stdin=subprocess.PIPE)
    if process.stdin is None:
        raise RuntimeError("Could not open ffmpeg transition input")
    try:
        for index in range(frame_count):
            progress = (index + 1) / frame_count
            eased = progress * progress * (3 - 2 * progress)
            offset = round(eased * HEIGHT)
            canvas = Image.new("RGB", (WIDTH, HEIGHT), INK)
            canvas.paste(first, (0, -offset))
            canvas.paste(second, (0, HEIGHT - offset))
            process.stdin.write(canvas.tobytes())
    finally:
        process.stdin.close()
    if process.wait() != 0:
        raise subprocess.CalledProcessError(process.returncode, command)


def render_scene_clip(ffmpeg: str, scene: dict, frames: list[Path], item: dict, metadata: dict, clip: Path) -> None:
    duration = float(item["scene_duration"])
    target_frames = max(1, round(duration * FPS))
    lead_ms = round(float(metadata["lead_seconds"]) * 1000)
    audio = VOICE_DIR / item["audio"]
    count = len(frames)
    transition_frames = 21 if count > 1 else 0
    hold_total = target_frames - transition_frames * (count - 1)
    if hold_total < count:
        raise RuntimeError(f"Scene {scene['id']} is too short for its visual sequence")

    if scene.get("shots"):
        weights = [float(shot_item.get("weight", 1.0)) for shot_item in scene["shots"]]
    else:
        weights = [1.0]
    hold_frames = []
    remaining = hold_total
    remaining_weight = sum(weights)
    for index, weight in enumerate(weights):
        if index == len(weights) - 1:
            frame_count = remaining
        else:
            frame_count = max(1, round(remaining * weight / remaining_weight))
        hold_frames.append(frame_count)
        remaining -= frame_count
        remaining_weight -= weight

    segment_dir = CLIP_DIR / scene["id"]
    segment_dir.mkdir(parents=True, exist_ok=True)
    visual_parts: list[Path] = []
    for index, (frame, frame_count) in enumerate(zip(frames, hold_frames)):
        hold_clip = segment_dir / f"{index:02d}-hold.mp4"
        subprocess.run([
            ffmpeg, "-y", "-loop", "1", "-framerate", str(FPS), "-i", str(frame),
            "-frames:v", str(frame_count), "-an", "-c:v", "libx264", "-preset", "medium",
            "-crf", "18", "-pix_fmt", "yuv420p", "-r", str(FPS), str(hold_clip),
        ], check=True)
        visual_parts.append(hold_clip)
        if index < count - 1:
            transition_clip = segment_dir / f"{index:02d}-scroll.mp4"
            render_transition_clip(ffmpeg, frame, frames[index + 1], transition_frames, transition_clip)
            visual_parts.append(transition_clip)

    visual_list = segment_dir / "visual-concat.txt"
    visual_list.write_text("\n".join(f"file '{part.as_posix()}'" for part in visual_parts), encoding="utf-8")
    visual = segment_dir / "visual.mp4"
    subprocess.run([
        ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", str(visual_list),
        "-an", "-c:v", "copy", str(visual),
    ], check=True)

    actual_duration = target_frames / FPS
    subprocess.run([
        ffmpeg, "-y", "-i", str(visual), "-i", str(audio),
        "-filter_complex", f"[1:a]adelay={lead_ms}|{lead_ms},apad,atrim=duration={actual_duration:.3f}[a]",
        "-map", "0:v:0", "-map", "[a]", "-t", f"{actual_duration:.3f}",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "144k", "-movflags", "+faststart", str(clip),
    ], check=True)


def render_video(scene_frames: list[list[Path]]) -> None:
    if not METADATA.exists():
        raise SystemExit(f"Missing narration metadata: {METADATA}")
    metadata = json.loads(METADATA.read_text(encoding="utf-8"))
    items = metadata["scenes"]
    if len(items) != len(scene_frames):
        raise SystemExit("Narration metadata and scene counts do not match")

    CLIP_DIR.mkdir(parents=True, exist_ok=True)
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    clip_paths = []
    for index, (scene, frames, item) in enumerate(zip(SCENES, scene_frames, items)):
        clip = CLIP_DIR / f"{index:02d}-{item['id']}.mp4"
        print(f"Rendering show-and-tell section {index + 1}/{len(scene_frames)}: {item['id']}", flush=True)
        render_scene_clip(ffmpeg, scene, frames, item, metadata, clip)
        clip_paths.append(clip)

    concat_file = CLIP_DIR / "concat.txt"
    concat_file.write_text("\n".join(f"file '{path.as_posix()}'" for path in clip_paths), encoding="utf-8")
    subprocess.run([
        ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", str(concat_file),
        "-fflags", "+genpts", "-c:v", "libx264", "-preset", "fast", "-crf", "18",
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "144k", "-movflags", "+faststart", str(OUTPUT),
    ], check=True)
    print(f"Created {OUTPUT}")


def main() -> None:
    scene_frames = prepare_frames()
    render_contact_sheet(scene_frames)
    render_video(scene_frames)


if __name__ == "__main__":
    main()
