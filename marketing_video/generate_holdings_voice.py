"""Generate the Holdings guide using the dashboard's exact voice settings."""
import asyncio
import json
from pathlib import Path

import edge_tts
import generate_dashboard_voice as baseline
from holdings_scenes import SCENES

ROOT = Path(__file__).resolve().parent
VOICE_DIR = ROOT / 'holdings_voice'
VOICE, RATE, PITCH = baseline.VOICE, baseline.RATE, baseline.PITCH

async def main():
    VOICE_DIR.mkdir(exist_ok=True)
    metadata, captions, script = [], ['WEBVTT', ''], []
    timeline = 0.0
    for index, scene in enumerate(SCENES):
        print(f"Narration {index + 1}/{len(SCENES)}: {scene['title']}", flush=True)
        destination = VOICE_DIR / f"{scene['id']}.mp3"
        boundary_file = destination.with_suffix('.json')
        if not destination.exists() or not boundary_file.exists():
            for attempt in range(6):
                try:
                    boundaries = []
                    with destination.open('wb') as output:
                        async for item in edge_tts.Communicate(scene['narration'], VOICE, rate=RATE, pitch=PITCH, boundary='WordBoundary').stream():
                            if item['type'] == 'audio':
                                output.write(item['data'])
                            elif item['type'] == 'WordBoundary':
                                boundaries.append(dict(offset=item['offset'] / 10_000_000, duration=item['duration'] / 10_000_000, text=item['text']))
                    boundary_file.write_text(json.dumps(boundaries), encoding='utf-8')
                    break
                except Exception as error:
                    if attempt == 5:
                        raise
                    print(f'Voice retry {attempt + 1}: {type(error).__name__}', flush=True)
                    await asyncio.sleep(min(3 * (attempt + 1), 15))
        duration = baseline.probe_duration(destination)
        boundaries = json.loads(boundary_file.read_text(encoding='utf-8'))
        scene_duration = duration + 1.2
        metadata.append(dict(id=scene['id'], audio=destination.name, audio_duration=duration, scene_duration=scene_duration, start=timeline))
        for start in range(0, len(boundaries), 10):
            group = boundaries[start:start+10]
            if not group:
                continue
            first = timeline + .5 + group[0]['offset']
            last = timeline + .5 + group[-1]['offset'] + group[-1]['duration']
            captions.extend([f'{baseline.timestamp(first)} --> {baseline.timestamp(last)}', ' '.join(word['text'] for word in group), ''])
        script.extend([f"{baseline.timestamp(timeline)}  {index+1:02d}. {scene['title']}", scene['narration'], ''])
        timeline += scene_duration
    payload = dict(voice=VOICE, rate=RATE, pitch=PITCH, total_duration=timeline, scenes=metadata)
    (ROOT/'holdings-voice-metadata.json').write_text(json.dumps(payload, indent=2), encoding='utf-8')
    (ROOT/'holdings-narration.vtt').write_text('\n'.join(captions), encoding='utf-8')
    (ROOT/'holdings-narration.txt').write_text('Portfolio Tracker — Detailed Holdings Walkthrough\n'+f'Voice: {VOICE}, rate {RATE}, pitch {PITCH}\n\n'+'\n'.join(script), encoding='utf-8')
    print(f'Created {len(metadata)} chapters, {timeline/60:.2f} minutes.', flush=True)

if __name__ == '__main__':
    asyncio.run(main())
