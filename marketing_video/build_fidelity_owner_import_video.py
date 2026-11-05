"""Render the Fidelity portfolios show-and-tell video at 1920×1080."""
import concurrent.futures
import json
import re
import subprocess
from pathlib import Path

import imageio_ffmpeg
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

from fidelity_owner_import_scenes import SCENES

ROOT = Path(__file__).resolve().parent
STAGES, CLIPS = ROOT / 'fidelity_owner_import_scenes', ROOT / 'fidelity_owner_import_clips'
OUTPUT = ROOT / 'portfolio-tracker-fidelity-owner-import-guide.mp4'
WIDTH, HEIGHT = 1920, 1080
BG, PANEL, BORDER, WHITE, MUTED, ACCENT = '#081325', '#15213c', '#29496c', '#f3f7ff', '#b5c8df', '#47b9ff'
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

def font(size, bold=False):
    return ImageFont.truetype('C:/Windows/Fonts/' + ('segoeuib.ttf' if bold else 'segoeui.ttf'), size)

def wrapped(draw, value, x, y, width, size, color=WHITE, bold=False, gap=1.32):
    face, lines, current = font(size, bold), [], ''
    for word in value.split():
        candidate = f'{current} {word}'.strip()
        if current and draw.textlength(candidate, font=face) > width:
            lines.append(current); current = word
        else: current = candidate
    if current: lines.append(current)
    for line in lines:
        draw.text((x, y), line, font=face, fill=color); y += round(size * gap)
    return y

def protect(image, scene_id):
    """Blur non-demo account data retained in administrative screen captures."""
    boxes = {
        'welcome': [(0, 470, 1920, 1080)],
        'navigate': [(0, 460, 1920, 1080)],
        'owner': [(0, 610, 1920, 1080)],
        'two_accounts': [(0, 0, 1920, 85), (0, 85, 1920, 550)],
        'aggregate': [(0, 0, 1240, 125)],
        'recap': [(0, 0, 1240, 125)],
    }
    for box in boxes.get(scene_id, []):
        crop = image.crop(box).filter(ImageFilter.GaussianBlur(18))
        crop = ImageEnhance.Brightness(crop).enhance(.36)
        image.paste(crop, box)
    return image

def screenshot(scene):
    image = Image.open(scene['image']).convert('RGB')
    image = protect(image, scene['id'])
    crop = scene.get('crop')
    return image.crop(crop) if crop else image

def compose(scene, index):
    source = screenshot(scene)
    canvas = Image.new('RGB', (WIDTH, HEIGHT), BG)
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle((46, 30, 375, 78), radius=19, fill=ACCENT)
    draw.text((66, 42), 'PORTFOLIO TRACKER', font=font(22, True), fill=BG)
    draw.text((WIDTH - 405, 43), f'PORTFOLIOS SHOW & TELL  •  {index + 1:02d}/{len(SCENES):02d}', font=font(20), fill=MUTED)
    draw.text((48, 100), scene['title'], font=font(43, True), fill=WHITE)
    draw.text((50, 158), scene['subtitle'], font=font(24), fill=MUTED)
    draw.rounded_rectangle((44, 218, 1400, 978), radius=18, fill=PANEL, outline=BORDER, width=2)
    scale = min(1310 / source.width, 705 / source.height)
    shown = source.resize((round(source.width * scale), round(source.height * scale)), Image.Resampling.LANCZOS)
    x, y = 722 - shown.width // 2, 600 - shown.height // 2
    canvas.paste(shown, (x, y))
    draw = ImageDraw.Draw(canvas)
    draw.rectangle((x, y, x + shown.width, y + shown.height), outline='#426d98', width=2)
    draw.text((1450, 244), 'SHOW & TELL', font=font(21, True), fill=ACCENT)
    y = 302
    for number, bullet in enumerate(scene['bullets'], 1):
        draw.ellipse((1450, y, 1492, y + 42), fill=ACCENT)
        draw.text((1463, y + 5), str(number), font=font(21, True), fill=BG)
        y = wrapped(draw, bullet, 1510, y, 345, 27, WHITE, True) + 50
    if scene['id'] == 'owner':
        draw.rounded_rectangle((1450, 822, 1860, 930), radius=13, fill='#173351', outline=ACCENT, width=2)
        wrapped(draw, 'Owner combines selected accounts; it is not a brokerage account.', 1470, 840, 365, 22, WHITE, True)
    if scene['id'] == 'aggregate':
        draw.rounded_rectangle((1450, 812, 1860, 942), radius=13, fill='#173351', outline=ACCENT, width=2)
        wrapped(draw, 'Aggregate = flexible view. Create another whenever a new grouping helps.', 1470, 830, 365, 22, WHITE, True)
    draw.text((50, 1017), 'ADMIN  /  PORTFOLIOS  /  OWNER  /  AGGREGATES  /  FIDELITY IMPORT', font=font(19), fill=MUTED)
    draw.rounded_rectangle((1190, 1027, 1868, 1037), radius=5, fill='#1f344e')
    draw.rounded_rectangle((1190, 1027, 1190 + round(678 * (index + 1) / len(SCENES)), 1037), radius=5, fill=ACCENT)
    destination = STAGES / f'{index:02d}-{scene["id"]}.png'
    canvas.save(destination)
    return destination

def duration(path):
    out = subprocess.run([FFMPEG, '-i', str(path), '-f', 'null', '-'], capture_output=True, text=True).stderr
    match = re.search(r'Duration: (\d+):(\d+):(\d+(?:\.\d+)?)', out)
    if not match: raise RuntimeError(f'No duration for {path}')
    return int(match[1])*3600 + int(match[2])*60 + float(match[3])

def render(index, frame, item):
    target = CLIPS / f'{index:02d}-{SCENES[index]["id"]}.mp4'
    seconds = item['scene_duration']
    subprocess.run([FFMPEG, '-y', '-hide_banner', '-loglevel', 'error', '-loop', '1', '-framerate', '30', '-i', str(frame), '-i', str(ROOT / 'fidelity_owner_import_voice' / item['audio']), '-vf', 'fps=30,format=yuv420p', '-af', f'adelay=500|500,aresample=48000,apad,atrim=duration={seconds:.3f}', '-t', f'{seconds:.3f}', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-threads', '2', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', str(target)], check=True)
    print(f'Rendered {index + 1}/{len(SCENES)}: {SCENES[index]["title"]}', flush=True)
    return target

def main():
    STAGES.mkdir(exist_ok=True); CLIPS.mkdir(exist_ok=True)
    frames = [compose(scene, index) for index, scene in enumerate(SCENES)]
    sheet = Image.new('RGB', (1280, ((len(frames) + 3)//4) * 198), BG)
    for index, path in enumerate(frames):
        preview = Image.open(path); preview.thumbnail((320, 180)); sheet.paste(preview, ((index % 4)*320, (index//4)*198))
    sheet.save(ROOT / 'fidelity-owner-import-contact-sheet.jpg', quality=95)
    metadata = json.loads((ROOT / 'fidelity-owner-import-voice-metadata.json').read_text(encoding='utf-8'))
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(render, i, frame, metadata['scenes'][i]) for i, frame in enumerate(frames)]
        for future in futures: future.result()
    clips = [CLIPS / f'{i:02d}-{scene["id"]}.mp4' for i, scene in enumerate(SCENES)]
    listing = CLIPS / 'concat.txt'; listing.write_text('\n'.join(f"file '{clip.as_posix()}'" for clip in clips), encoding='utf-8')
    cursor, chapters = 0.0, [';FFMETADATA1', 'title=Portfolio Tracker - Fidelity Owner and Import Guide', 'artist=Portfolio Tracker', 'comment=Show-and-tell: regular portfolios, Owner, aggregates, and Fidelity imports']
    for scene, clip in zip(SCENES, clips):
        seconds = duration(clip); chapters += ['[CHAPTER]', 'TIMEBASE=1/1000', f'START={round(cursor*1000)}', f'END={round((cursor+seconds)*1000)}', f'title={scene["title"]}']; cursor += seconds
    chapter_file = ROOT / 'fidelity-owner-import-chapters.ffmetadata'; chapter_file.write_text('\n'.join(chapters), encoding='utf-8')
    subprocess.run([FFMPEG, '-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', str(listing), '-i', str(ROOT / 'fidelity-owner-import-narration.vtt'), '-i', str(chapter_file), '-map', '0:v', '-map', '0:a', '-map', '1:0', '-map_metadata', '2', '-map_chapters', '2', '-c:v', 'copy', '-c:a', 'copy', '-c:s', 'mov_text', '-metadata:s:s:0', 'language=eng', '-metadata:s:s:0', 'title=English captions', '-movflags', '+faststart', str(OUTPUT)], check=True)
    print(f'Created {OUTPUT}; {cursor/60:.2f} minutes', flush=True)

if __name__ == '__main__': main()
