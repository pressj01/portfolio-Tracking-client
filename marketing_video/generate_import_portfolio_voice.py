"""Generate narration and captions for the Import and Portfolios guide."""
import asyncio
import json
from pathlib import Path

import edge_tts
from import_portfolio_scenes import SCENES

ROOT = Path(__file__).resolve().parent
VOICE_DIR = ROOT / 'import_portfolio_voice'
VOICE = 'en-US-AndrewMultilingualNeural'
RATE = '-4%'
PITCH = '-2Hz'

def probe_duration(path):
    import imageio_ffmpeg
    import subprocess
    result = subprocess.run(
        [imageio_ffmpeg.get_ffmpeg_exe(), '-i', str(path), '-f', 'null', '-'],
        capture_output=True, text=True, check=False,
    )
    import re
    match = re.search(r'Duration: (\d+):(\d+):(\d+(?:\.\d+)?)', result.stderr)
    if not match:
        raise RuntimeError(f'Could not determine duration for {path}')
    return int(match.group(1)) * 3600 + int(match.group(2)) * 60 + float(match.group(3))

def timestamp(seconds):
    milliseconds = round(seconds * 1000)
    hours, milliseconds = divmod(milliseconds, 3_600_000)
    minutes, milliseconds = divmod(milliseconds, 60_000)
    secs, milliseconds = divmod(milliseconds, 1000)
    return f'{hours:02d}:{minutes:02d}:{secs:02d}.{milliseconds:03d}'

async def main():
    VOICE_DIR.mkdir(exist_ok=True)
    metadata, captions, script = [], ['WEBVTT', ''], []
    timeline = 0.0
    for index, scene in enumerate(SCENES):
        destination = VOICE_DIR / f"{scene['id']}.mp3"
        boundary_file = destination.with_suffix('.json')
        print(f'Narration {index + 1}/{len(SCENES)}: {scene["title"]}', flush=True)
        boundaries = []
        for attempt in range(4):
            try:
                with destination.open('wb') as output:
                    async for item in edge_tts.Communicate(
                        scene['narration'], VOICE, rate=RATE, pitch=PITCH,
                        boundary='WordBoundary',
                    ).stream():
                        if item['type'] == 'audio':
                            output.write(item['data'])
                        elif item['type'] == 'WordBoundary':
                            boundaries.append({
                                'offset': item['offset'] / 10_000_000,
                                'duration': item['duration'] / 10_000_000,
                                'text': item['text'],
                            })
                boundary_file.write_text(json.dumps(boundaries), encoding='utf-8')
                break
            except Exception:
                if attempt == 3:
                    raise
                await asyncio.sleep(2 * (attempt + 1))
        audio_duration = probe_duration(destination)
        scene_duration = audio_duration + 1.25
        metadata.append({
            'id': scene['id'], 'audio': destination.name,
            'audio_duration': audio_duration, 'scene_duration': scene_duration,
            'start': timeline,
        })
        for start in range(0, len(boundaries), 10):
            group = boundaries[start:start + 10]
            captions += [
                f'{timestamp(timeline + .5 + group[0]["offset"])} --> {timestamp(timeline + .5 + group[-1]["offset"] + group[-1]["duration"])}',
                ' '.join(word['text'] for word in group), '',
            ]
        script += [f'{timestamp(timeline)}  {index + 1:02d}. {scene["title"]}', scene['narration'], '']
        timeline += scene_duration
    (ROOT / 'import-portfolio-voice-metadata.json').write_text(json.dumps({
        'voice': VOICE, 'rate': RATE, 'pitch': PITCH,
        'total_duration': timeline, 'scenes': metadata,
    }, indent=2), encoding='utf-8')
    (ROOT / 'import-portfolio-narration.vtt').write_text('\n'.join(captions), encoding='utf-8')
    (ROOT / 'import-portfolio-narration.txt').write_text(
        'Portfolio Tracker — Import and Manage Portfolios Guide\n'
        f'Voice: {VOICE}, rate {RATE}, pitch {PITCH}\n\n' + '\n'.join(script),
        encoding='utf-8',
    )
    print(f'Created {len(metadata)} chapters, {timeline / 60:.2f} minutes.', flush=True)

if __name__ == '__main__':
    asyncio.run(main())
