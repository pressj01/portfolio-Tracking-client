"""Generate synchronized narration, captions, and chapter timing."""
import asyncio
import json
import re
import subprocess
from pathlib import Path

import edge_tts
import imageio_ffmpeg
from fidelity_owner_import_scenes import SCENES

ROOT = Path(__file__).resolve().parent
VOICE_DIR = ROOT / 'fidelity_owner_import_voice'
VOICE = 'en-US-AndrewMultilingualNeural'
RATE, PITCH = '-4%', '-2Hz'

def duration(path):
    result = subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-i', str(path), '-f', 'null', '-'], capture_output=True, text=True)
    match = re.search(r'Duration: (\d+):(\d+):(\d+(?:\.\d+)?)', result.stderr)
    if not match:
        raise RuntimeError(f'Could not determine duration for {path}')
    return int(match[1]) * 3600 + int(match[2]) * 60 + float(match[3])

def stamp(seconds):
    ms = round(seconds * 1000); h, ms = divmod(ms, 3600000); m, ms = divmod(ms, 60000); s, ms = divmod(ms, 1000)
    return f'{h:02d}:{m:02d}:{s:02d}.{ms:03d}'

async def main():
    VOICE_DIR.mkdir(exist_ok=True)
    timeline, metadata = 0.0, []
    captions, script = ['WEBVTT', ''], []
    for index, scene in enumerate(SCENES, 1):
        audio = VOICE_DIR / f"{scene['id']}.mp3"
        words = []
        print(f'Narration {index}/{len(SCENES)}: {scene["title"]}', flush=True)
        with audio.open('wb') as output:
            async for event in edge_tts.Communicate(scene['narration'], VOICE, rate=RATE, pitch=PITCH, boundary='WordBoundary').stream():
                if event['type'] == 'audio': output.write(event['data'])
                elif event['type'] == 'WordBoundary': words.append({'offset': event['offset']/10_000_000, 'duration': event['duration']/10_000_000, 'text': event['text']})
        audio_seconds = duration(audio)
        scene_seconds = audio_seconds + 1.25
        metadata.append({'id': scene['id'], 'audio': audio.name, 'audio_duration': audio_seconds, 'scene_duration': scene_seconds, 'start': timeline})
        for start in range(0, len(words), 9):
            group = words[start:start + 9]
            captions += [f'{stamp(timeline + .5 + group[0]["offset"])} --> {stamp(timeline + .5 + group[-1]["offset"] + group[-1]["duration"])}', ' '.join(word['text'] for word in group), '']
        script += [f'{stamp(timeline)}  {index:02d}. {scene["title"]}', scene['narration'], '']
        timeline += scene_seconds
    (ROOT / 'fidelity-owner-import-voice-metadata.json').write_text(json.dumps({'voice': VOICE, 'rate': RATE, 'pitch': PITCH, 'total_duration': timeline, 'scenes': metadata}, indent=2), encoding='utf-8')
    (ROOT / 'fidelity-owner-import-narration.vtt').write_text('\n'.join(captions), encoding='utf-8')
    (ROOT / 'fidelity-owner-import-narration.txt').write_text('Portfolio Tracker — Fidelity Owner and Import Guide\n' + f'Voice: {VOICE}; rate {RATE}; pitch {PITCH}\n\n' + '\n'.join(script), encoding='utf-8')
    print(f'Created {len(metadata)} narrated chapters, {timeline / 60:.2f} minutes.', flush=True)

if __name__ == '__main__': asyncio.run(main())
