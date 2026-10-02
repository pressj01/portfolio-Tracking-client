"""Compose the narrated 1080p Import and Manage Portfolios walkthrough."""
import concurrent.futures
import json
import subprocess
import textwrap
from pathlib import Path

import imageio_ffmpeg
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

from import_portfolio_scenes import SCENES

ROOT = Path(__file__).resolve().parent
STAGES = ROOT / 'import_portfolio_scenes'
CLIPS = ROOT / 'import_portfolio_clips'
OUTPUT = ROOT / 'portfolio-tracker-import-and-portfolios-guide.mp4'
WIDTH, HEIGHT = 1920, 1080
BG, PANEL, PANEL_BORDER = '#081325', '#15213c', '#29496c'
WHITE, MUTED, ACCENT = '#f3f7ff', '#b5c8df', '#47b9ff'
FONT_DIR = Path('C:/Windows/Fonts')

def font(size, bold=False):
    return ImageFont.truetype(str(FONT_DIR / ('segoeuib.ttf' if bold else 'segoeui.ttf')), size)

def wrap(draw, value, x, y, width, size, color=WHITE, bold=False, line_gap=1.35):
    f = font(size, bold)
    lines, current = [], ''
    for word in value.split():
        candidate = f'{current} {word}'.strip()
        if current and draw.textlength(candidate, font=f) > width:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    for line in lines:
        draw.text((x, y), line, font=f, fill=color)
        y += round(size * line_gap)
    return y

def open_detail(scene):
    source = Image.open(scene['image']).convert('RGB')
    crop = scene.get('crop')
    if crop:
        if crop[2] > source.width or crop[3] > source.height:
            raise ValueError(f'Crop outside source: {scene["image"]} {crop} vs {source.size}')
        source = source.crop(crop)
    return source

def compose(scene, index):
    source = open_detail(scene)
    canvas = Image.new('RGB', (WIDTH, HEIGHT), BG)
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle((44, 32, 360, 77), radius=18, fill=ACCENT)
    draw.text((64, 42), 'PORTFOLIO TRACKER', font=font(22, True), fill='#071526')
    draw.text((WIDTH - 350, 42), f'IMPORT + PORTFOLIOS  •  {index + 1:02d}/{len(SCENES)}', font=font(21), fill=MUTED)
    draw.text((48, 98), scene['title'], font=font(45, True), fill=WHITE)
    draw.text((50, 160), scene['subtitle'], font=font(25), fill=MUTED)

    if scene['kind'] in ('title', 'outro'):
        backdrop = source.resize((1816, 760)).filter(ImageFilter.GaussianBlur(7))
        backdrop = ImageEnhance.Brightness(backdrop).enhance(.24)
        canvas.paste(backdrop, (52, 220))
        draw = ImageDraw.Draw(canvas)
        y = 310
        for bullet in scene['bullets']:
            draw.rounded_rectangle((105, y + 12, 125, y + 32), radius=6, fill=ACCENT)
            y = wrap(draw, bullet, 145, y, 1300, 58, WHITE, True, 1.35) + 35
        footer = ('Any number of accounts. Any combination of them in aggregates.'
                  if scene['kind'] == 'title'
                  else 'For informational purposes only. Not financial advice.')
        draw.text((115, 902), footer, font=font(29), fill=MUTED)
    else:
        draw.rounded_rectangle((44, 220, 1400, 983), radius=18, fill=PANEL, outline=PANEL_BORDER, width=2)
        ratio = min(1312 / source.width, 715 / source.height, 3.0)
        detail = source.resize((round(source.width * ratio), round(source.height * ratio)), Image.Resampling.LANCZOS)
        x = 722 - detail.width // 2
        y = 601 - detail.height // 2
        canvas.paste(detail, (x, y))
        draw = ImageDraw.Draw(canvas)
        draw.text((1450, 238), 'WHAT TO LOOK FOR', font=font(22, True), fill=ACCENT)
        y = 296
        for number, bullet in enumerate(scene['bullets'], 1):
            draw.ellipse((1450, y, 1490, y + 40), fill=ACCENT)
            draw.text((1462, y + 4), str(number), font=font(22, True), fill=BG)
            y = wrap(draw, bullet, 1506, y, 350, 28, WHITE, True) + 52
        draw.text((1450, 915), 'Detailed screen guide', font=font(21), fill=MUTED)

    draw.text((50, 1014), 'IMPORT  /  BROKERS  /  GENERIC  /  OWNER  /  AGGREGATES', font=font(20), fill=MUTED)
    draw.rounded_rectangle((1180, 1026, 1870, 1035), radius=4, fill='#1f344e')
    draw.rounded_rectangle((1180, 1026, 1180 + int(690 * (index + 1) / len(SCENES)), 1035), radius=4, fill=ACCENT)
    destination = STAGES / f'{index:02d}-{scene["id"]}.png'
    canvas.save(destination)
    return destination

def prepare():
    STAGES.mkdir(exist_ok=True)
    frames = [compose(scene, index) for index, scene in enumerate(SCENES)]
    sheet = Image.new('RGB', (1280, ((len(frames) + 3) // 4) * 198), BG)
    draw = ImageDraw.Draw(sheet)
    for index, path in enumerate(frames):
        image = Image.open(path)
        image.thumbnail((320, 180))
        x, y = (index % 4) * 320, (index // 4) * 198
        sheet.paste(image, (x, y))
        draw.text((x + 6, y + 180), SCENES[index]['title'][:40], font=font(12), fill=WHITE)
    sheet.save(ROOT / 'import-portfolio-contact-sheet.jpg', quality=95)
    return frames

def render(index, image, item):
    CLIPS.mkdir(exist_ok=True)
    target = CLIPS / f'{index:02d}-{SCENES[index]["id"]}.mp4'
    duration = float(item['scene_duration'])
    command = [
        imageio_ffmpeg.get_ffmpeg_exe(), '-y', '-hide_banner', '-loglevel', 'error',
        '-loop', '1', '-framerate', '30', '-i', str(image),
        '-i', str(ROOT / 'import_portfolio_voice' / item['audio']),
        '-vf', 'fps=30,format=yuv420p',
        '-af', f'adelay=500|500,aresample=48000,apad,atrim=duration={duration:.3f}',
        '-t', f'{duration:.3f}', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-threads', '2',
        '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', str(target),
    ]
    subprocess.run(command, check=True)
    print(f'Rendered {index + 1}/{len(SCENES)}: {SCENES[index]["title"]}', flush=True)
    return target

def probe_duration(path):
    result = subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-i', str(path), '-f', 'null', '-'], capture_output=True, text=True)
    import re
    match = re.search(r'Duration: (\d+):(\d+):(\d+(?:\.\d+)?)', result.stderr)
    if not match:
        raise RuntimeError(f'No duration in {path}')
    return int(match.group(1)) * 3600 + int(match.group(2)) * 60 + float(match.group(3))

def main():
    frames = prepare()
    metadata = json.loads((ROOT / 'import-portfolio-voice-metadata.json').read_text(encoding='utf-8'))
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(render, index, frame, metadata['scenes'][index]) for index, frame in enumerate(frames)]
        for future in futures:
            future.result()
    clips = [CLIPS / f'{index:02d}-{scene["id"]}.mp4' for index, scene in enumerate(SCENES)]
    listing = CLIPS / 'concat.txt'
    listing.write_text('\n'.join(f"file '{clip.as_posix()}'" for clip in clips), encoding='utf-8')
    cursor, chapters = 0.0, [';FFMETADATA1', 'title=Portfolio Tracker - Import and Manage Portfolios Guide', 'artist=Portfolio Tracker', 'comment=Broker, generic import, Owner, and aggregate walkthrough']
    for scene, clip in zip(SCENES, clips):
        duration = probe_duration(clip)
        chapters += ['[CHAPTER]', 'TIMEBASE=1/1000', f'START={round(cursor * 1000)}', f'END={round((cursor + duration) * 1000)}', f'title={scene["title"]}']
        cursor += duration
    chapter_file = ROOT / 'import-portfolio-chapters.ffmetadata'
    chapter_file.write_text('\n'.join(chapters), encoding='utf-8')
    subprocess.run([
        imageio_ffmpeg.get_ffmpeg_exe(), '-y', '-hide_banner', '-loglevel', 'error',
        '-f', 'concat', '-safe', '0', '-i', str(listing),
        '-i', str(ROOT / 'import-portfolio-narration.vtt'), '-i', str(chapter_file),
        '-map', '0:v', '-map', '0:a', '-map', '1:0', '-map_metadata', '2', '-map_chapters', '2',
        '-c:v', 'copy', '-c:a', 'copy', '-c:s', 'mov_text', '-metadata:s:s:0', 'language=eng',
        '-metadata:s:s:0', 'title=English captions', '-movflags', '+faststart', str(OUTPUT),
    ], check=True)
    print(f'Created {OUTPUT}; {cursor / 60:.2f} minutes', flush=True)

if __name__ == '__main__':
    main()
