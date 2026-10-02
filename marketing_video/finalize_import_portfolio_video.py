"""Validate the Import and Manage Portfolios guide and create a review player."""
import html
import json
import re
import subprocess
from pathlib import Path

import imageio_ffmpeg
from PIL import Image, ImageDraw, ImageFont

from import_portfolio_scenes import SCENES

ROOT = Path(__file__).resolve().parent
VIDEO = ROOT / 'portfolio-tracker-import-and-portfolios-guide.mp4'
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

def run(args):
    result = subprocess.run([FFMPEG, '-hide_banner', *args], capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(result.stderr[-2000:])
    return result.stderr

def main():
    metadata = json.loads((ROOT / 'import-portfolio-voice-metadata.json').read_text(encoding='utf-8'))
    chapter_text = (ROOT / 'import-portfolio-chapters.ffmetadata').read_text(encoding='utf-8')
    starts = [int(value) / 1000 for value in re.findall(r'^START=(\d+)', chapter_text, re.M)]
    probe = run(['-i', str(VIDEO), '-t', '0', '-f', 'null', '-'])
    assert '1920x1080' in probe and 'Video: h264' in probe and 'Audio: aac' in probe
    assert 'Subtitle: mov_text' in probe
    assert len(starts) == len(SCENES) == 13
    assert metadata['voice'] == 'en-US-AndrewMultilingualNeural'
    decode = run(['-v', 'error', '-i', str(VIDEO), '-f', 'null', '-'])
    assert not decode.strip(), decode
    volume = run(['-i', str(VIDEO), '-vn', '-af', 'volumedetect', '-f', 'null', '-'])
    mean = float(re.search(r'mean_volume: ([-\d.]+) dB', volume).group(1))
    peak = float(re.search(r'max_volume: ([-\d.]+) dB', volume).group(1))
    assert -35 < mean < -8 and peak < 0, (mean, peak)
    review = ROOT / 'import_portfolio_export_review'
    review.mkdir(exist_ok=True)
    sheet = Image.new('RGB', (1440, 1180), '#081325')
    draw = ImageDraw.Draw(sheet)
    review_font = ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf', 17)
    selected = list(range(len(SCENES)))
    for number, index in enumerate(selected):
        destination = review / f'{index:02d}.png'
        run(['-y', '-ss', f'{starts[index] + 2:.3f}', '-i', str(VIDEO), '-frames:v', '1', str(destination)])
        frame = Image.open(destination)
        assert frame.size == (1920, 1080)
        frame.thumbnail((360, 203))
        x, y = (number % 4) * 360, (number // 4) * 285
        sheet.paste(frame, (x, y))
        draw.text((x + 7, y + 210), f'{index + 1:02d}. {SCENES[index]["title"][:38]}', font=review_font, fill='#f3f7ff')
    sheet.save(ROOT / 'import-portfolio-export-review.jpg', quality=95)
    buttons = '\n'.join(
        f'<button data-time="{start:.3f}"><span>{int(start // 60):02d}:{int(start % 60):02d}</span> {html.escape(scene["title"])}</button>'
        for scene, start in zip(SCENES, starts)
    )
    player = '''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Portfolio Tracker: Import and Portfolios Guide</title><style>body{margin:0;background:#081325;color:#f3f7ff;font:18px Segoe UI,sans-serif}main{max-width:1300px;margin:24px auto;padding:24px}h1{color:#47b9ff}p{color:#b5c8df}video{width:100%;background:#000;border-radius:12px}#chapters{columns:2;column-gap:18px}button{display:block;width:100%;padding:13px;margin:6px 0;text-align:left;background:#15213c;color:#f3f7ff;border:1px solid #29496c;border-radius:7px;cursor:pointer;break-inside:avoid;font:16px Segoe UI,sans-serif}button:hover{border-color:#47b9ff}button span{color:#47b9ff;font-variant-numeric:tabular-nums}a{color:#47b9ff}@media(max-width:700px){#chapters{columns:1}}</style></head><body><main><h1>Portfolio Tracker: Import and Manage Portfolios Guide</h1><p>13 chapters · English captions · Synchronized narration and screen walkthrough</p><video id="guide" controls preload="metadata"><source src="portfolio-tracker-import-and-portfolios-guide.mp4" type="video/mp4"><track kind="captions" src="import-portfolio-narration.vtt" srclang="en" label="English"></video><p><a href="portfolio-tracker-import-and-portfolios-guide.mp4" download>Download video</a> · <a href="import-portfolio-narration.txt">Narration and chapter list</a> · <a href="import-portfolio-narration.vtt" download>English captions</a></p><h2>Jump to a chapter</h2><div id="chapters">'''+buttons+'''</div><p>For informational purposes only. Not financial advice.</p></main><script>document.querySelectorAll('[data-time]').forEach(button=>button.addEventListener('click',()=>{const video=document.getElementById('guide');video.currentTime=Number(button.dataset.time);video.play();video.scrollIntoView({behavior:'smooth'});}));</script></body></html>'''
    (ROOT / 'import-and-portfolios-guide-player.html').write_text(player, encoding='utf-8')
    report = {
        'video': str(VIDEO), 'bytes': VIDEO.stat().st_size, 'chapters': len(SCENES),
        'dimensions': [1920, 1080], 'video_codec': 'h264', 'audio_codec': 'aac',
        'captions': 'embedded English + VTT', 'full_decode': 'passed',
        'mean_volume_db': mean, 'peak_volume_db': peak, 'voice': metadata['voice'],
    }
    (ROOT / 'import-portfolio-quality-report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))

if __name__ == '__main__':
    main()
