from __future__ import annotations

import math
import subprocess
from pathlib import Path

import imageio_ffmpeg
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parent
CAPTURES = ROOT / "overview_captures"
SCENES = ROOT / "overview_scenes"
NARRATION = ROOT / "overview-narration.mp3"
OUTPUT = ROOT / "portfolio-tracker-complete-overview.mp4"

WIDTH = 1920
HEIGHT = 1080
FPS = 30
TRANSITION = 0.65

ACCENT = (51, 174, 255)
CYAN = (12, 194, 222)
GREEN = (55, 232, 156)
ORANGE = (255, 150, 55)
INK = (5, 10, 24)
WHITE = (244, 249, 255)
MUTED = (174, 198, 225)


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(Path("C:/Windows/Fonts") / name), size=size)


FONT_BOLD_76 = font("segoeuib.ttf", 76)
FONT_BOLD_52 = font("segoeuib.ttf", 52)
FONT_BOLD_30 = font("segoeuib.ttf", 30)
FONT_BOLD_22 = font("segoeuib.ttf", 22)
FONT_REG_34 = font("segoeui.ttf", 34)
FONT_REG_27 = font("segoeui.ttf", 27)
FONT_REG_22 = font("segoeui.ttf", 22)


PRIVACY_BOXES = {
    "01-dashboard.png": [(32, 229, 275, 268)],
    "02-action-center.png": [(1088, 306, 1270, 344)],
    "06-diversification.png": [(204, 390, 365, 423)],
    "09-retirement-readiness.png": [(842, 889, 952, 925)],
    "11-split-view.png": [(58, 394, 255, 428)],
}


SCENE_DEFINITIONS = [
    ("01-dashboard.png", "Portfolio command center", "Performance, income, risk, and portfolio health in one view.", ACCENT),
    ("02-action-center.png", "From signals to next steps", "Bring the items that may deserve attention into one practical queue.", ORANGE),
    ("03-holdings.png", "The positions behind the portfolio", "Review holdings, lots, gains and losses, targets, and income sources.", GREEN),
    ("04-dividend-calendar.png", "See when income arrives", "Move from daily payments to monthly patterns, history, and reinvestment.", CYAN),
    ("05-etf-comparer.png", "Research on a shared timeline", "Compare returns, yield, costs, distributions, and NAV behavior in context.", ACCENT),
    ("06-diversification.png", "Understand concentration and exposure", "Explore allocation, sectors, correlations, portfolio risk, and macro context.", GREEN),
    ("09-retirement-readiness.png", "Model the road ahead", "Test income, withdrawals, targets, alternatives, and rebalancing plans.", ORANGE),
    ("07-option-dashboard.png", "Track the options overlay", "Keep open and closed trades, assignment risk, and strategy performance connected.", CYAN),
    ("08-strategy-lab.png", "Explore probability, payoff, and risk", "Learn strategies and scan setups without leaving the portfolio workspace.", ACCENT),
    ("10-tax-loss-harvest.png", "Bring tax decisions into view", "Review annual reporting, realized results, blended yield, and harvest candidates.", ORANGE),
    ("11-split-view.png", "Two workflows, side by side", "Compare screens or accounts while keeping the shared date range aligned.", CYAN),
    ("12-menu-control.png", "A workspace shaped around you", "Reorder or hide pages, choose a role preset, and keep help close at hand.", GREEN),
]

# These are final timeline lengths. Each non-final source clip receives the
# transition duration as extra material so crossfades do not shift narration.
DURATIONS = [
    7.5,   # title
    15.5,  # dashboard
    7.0,   # action center
    12.0,  # holdings
    10.5,  # dividend calendar
    18.5,  # comparer
    14.0,  # diversification
    8.5,   # planning
    8.0,   # options dashboard
    11.0,  # strategy lab
    7.0,   # taxes
    8.0,   # split view
    11.0,  # menu control
    12.0,  # outro
]


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


def protect_account_total(image: Image.Image, filename: str) -> Image.Image:
    protected = image.copy()
    for box in PRIVACY_BOXES.get(filename, []):
        region = protected.crop(box)
        # Downsample first so the digits cannot be recovered from a merely soft blur.
        tiny = region.resize((max(1, region.width // 18), max(1, region.height // 12)), Image.Resampling.BILINEAR)
        region = tiny.resize(region.size, Image.Resampling.NEAREST).filter(ImageFilter.GaussianBlur(10))
        protected.paste(region, box)
    return protected


def add_footer_gradient(canvas: Image.Image) -> Image.Image:
    overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    start = 790
    for y in range(start, HEIGHT):
        progress = (y - start) / (HEIGHT - start)
        alpha = int(30 + 220 * (progress ** 1.45))
        draw.line((0, y, WIDTH, y), fill=(3, 8, 20, alpha))
    return Image.alpha_composite(canvas.convert("RGBA"), overlay)


def make_feature_scene(
    source_name: str,
    destination: Path,
    title: str,
    subtitle: str,
    accent: tuple[int, int, int],
) -> None:
    base = fit_1080(Image.open(CAPTURES / source_name))
    base = protect_account_total(base, source_name)
    base = ImageEnhance.Color(base).enhance(1.03)
    base = add_footer_gradient(base)
    draw = ImageDraw.Draw(base, "RGBA")

    draw.rounded_rectangle((64, 820, 335, 866), radius=23, fill=(*accent, 235))
    draw.text((84, 829), "PORTFOLIO TRACKER", font=FONT_BOLD_22, fill=(4, 13, 28, 255))
    draw.text((64, 885), title, font=FONT_BOLD_52, fill=WHITE)
    draw.text((66, 958), subtitle, font=FONT_REG_27, fill=MUTED)

    destination.parent.mkdir(parents=True, exist_ok=True)
    base.convert("RGB").save(destination, quality=96)


def dashboard_background() -> Image.Image:
    source = fit_1080(Image.open(CAPTURES / "01-dashboard.png"))
    return protect_account_total(source, "01-dashboard.png")


def make_title_card(destination: Path) -> None:
    background = dashboard_background().filter(ImageFilter.GaussianBlur(16))
    background = ImageEnhance.Brightness(background).enhance(0.25).convert("RGBA")
    card = Image.alpha_composite(background, Image.new("RGBA", background.size, (4, 10, 28, 155)))
    draw = ImageDraw.Draw(card, "RGBA")

    icon_path = ROOT.parent / "public" / "app-icon.png"
    if icon_path.exists():
        icon = Image.open(icon_path).convert("RGBA")
        icon.thumbnail((142, 142), Image.Resampling.LANCZOS)
        card.alpha_composite(icon, (104, 130))

    draw.text((104, 315), "Portfolio Tracker", font=FONT_BOLD_76, fill=WHITE)
    draw.text((108, 420), "See the whole portfolio. Understand what is driving it.", font=FONT_REG_34, fill=MUTED)
    draw.rounded_rectangle((104, 535, 1060, 625), radius=26, fill=(11, 27, 61, 225), outline=(*ACCENT, 160), width=2)
    draw.text((140, 558), "MONITOR  •  RESEARCH  •  COMPARE  •  PLAN", font=FONT_BOLD_30, fill=ACCENT)
    draw.text((108, 930), "A complete high-level tour", font=FONT_REG_22, fill=(145, 177, 212))

    destination.parent.mkdir(parents=True, exist_ok=True)
    card.convert("RGB").save(destination, quality=96)


def make_outro_card(destination: Path) -> None:
    source = fit_1080(Image.open(CAPTURES / "05-etf-comparer.png"))
    background = source.filter(ImageFilter.GaussianBlur(18))
    background = ImageEnhance.Brightness(background).enhance(0.22).convert("RGBA")
    card = Image.alpha_composite(background, Image.new("RGBA", background.size, (3, 9, 26, 178)))
    draw = ImageDraw.Draw(card, "RGBA")

    draw.text((116, 236), "Monitor clearly.", font=FONT_BOLD_76, fill=WHITE)
    draw.text((116, 348), "Research with context.", font=FONT_BOLD_76, fill=ACCENT)
    draw.text((116, 460), "Plan with confidence.", font=FONT_BOLD_76, fill=WHITE)
    draw.rounded_rectangle((116, 625, 860, 728), radius=28, fill=(13, 62, 111, 230), outline=(*ACCENT, 220), width=2)
    draw.text((158, 650), "Portfolio Tracker", font=FONT_BOLD_52, fill=WHITE)
    draw.text((116, 958), "For informational purposes only. Not financial advice.", font=FONT_REG_22, fill=(145, 174, 207))

    destination.parent.mkdir(parents=True, exist_ok=True)
    card.convert("RGB").save(destination, quality=96)


def prepare_scenes() -> list[Path]:
    SCENES.mkdir(parents=True, exist_ok=True)
    paths = [SCENES / "00-title.png"]
    make_title_card(paths[0])

    for index, definition in enumerate(SCENE_DEFINITIONS, start=1):
        source_name, title, subtitle, accent = definition
        destination = SCENES / f"{index:02d}-{Path(source_name).stem}.png"
        make_feature_scene(source_name, destination, title, subtitle, accent)
        paths.append(destination)

    outro = SCENES / "13-outro.png"
    make_outro_card(outro)
    paths.append(outro)
    return paths


def render_video(scene_paths: list[Path]) -> None:
    if len(scene_paths) != len(DURATIONS):
        raise SystemExit("Scene and duration counts do not match")
    if not NARRATION.exists():
        raise SystemExit(f"Missing narration: {NARRATION}")

    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    command = [ffmpeg, "-y"]
    raw_durations = DURATIONS

    for scene_path, duration in zip(scene_paths, raw_durations):
        command.extend([
            "-loop", "1",
            "-framerate", str(FPS),
            "-t", f"{duration:.3f}",
            "-i", str(scene_path),
        ])
    command.extend(["-i", str(NARRATION)])

    filters: list[str] = []
    for index, duration in enumerate(raw_durations):
        zoom_step = 0.00010 if index % 2 == 0 else 0.000085
        filters.append(
            f"[{index}:v]scale={WIDTH}:{HEIGHT},"
            f"zoompan=z='min(max(zoom,pzoom)+{zoom_step:.6f},1.025)':"
            f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s={WIDTH}x{HEIGHT}:fps={FPS},"
            f"fps={FPS},settb=AVTB,trim=duration={duration:.3f},"
            f"setpts=PTS-STARTPTS,setsar=1,format=yuv420p[v{index}]"
        )

    total_duration = sum(DURATIONS)
    audio_index = len(scene_paths)
    video_inputs = "".join(f"[v{index}]" for index in range(len(scene_paths)))
    filters.append(
        f"{video_inputs}concat=n={len(scene_paths)}:v=1:a=0,format=yuv420p[vout]"
    )
    filters.append(
        f"[{audio_index}:a]afade=t=in:st=0:d=0.35,"
        f"afade=t=out:st={total_duration - 2.0:.3f}:d=1.4,"
        f"apad=pad_dur=4,atrim=duration={total_duration:.3f}[aout]"
    )

    command.extend([
        "-filter_complex", ";".join(filters),
        "-map", "[vout]",
        "-map", "[aout]",
        "-t", f"{total_duration:.3f}",
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "192k",
        "-movflags", "+faststart",
        str(OUTPUT),
    ])

    subprocess.run(command, check=True)
    print(f"Created {OUTPUT}")


def main() -> None:
    render_video(prepare_scenes())


if __name__ == "__main__":
    main()
