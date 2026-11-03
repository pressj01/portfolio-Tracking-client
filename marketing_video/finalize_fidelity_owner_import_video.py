"""Validate the final Fidelity Owner and import walkthrough."""
import json
import re
import subprocess
from pathlib import Path

import imageio_ffmpeg
from fidelity_owner_import_scenes import SCENES

ROOT = Path(__file__).resolve().parent
VIDEO = ROOT / 'portfolio-tracker-fidelity-owner-import-guide.mp4'
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

def run(args):
    result = subprocess.run([FFMPEG, '-hide_banner', *args], capture_output=True, text=True)
    if result.returncode: raise RuntimeError(result.stderr[-2000:])
    return result.stderr

def main():
    metadata = json.loads((ROOT / 'fidelity-owner-import-voice-metadata.json').read_text(encoding='utf-8'))
    chapters = (ROOT / 'fidelity-owner-import-chapters.ffmetadata').read_text(encoding='utf-8')
    starts = re.findall(r'^START=(\d+)', chapters, re.M)
    probe = run(['-i', str(VIDEO), '-t', '0', '-f', 'null', '-'])
    assert '1920x1080' in probe and 'Video: h264' in probe and 'Audio: aac' in probe and 'Subtitle: mov_text' in probe
    assert len(starts) == len(SCENES)
    assert metadata['voice'] == 'en-US-AndrewMultilingualNeural'
    assert not run(['-v', 'error', '-i', str(VIDEO), '-f', 'null', '-']).strip()
    volume = run(['-i', str(VIDEO), '-vn', '-af', 'volumedetect', '-f', 'null', '-'])
    mean = float(re.search(r'mean_volume: ([-\d.]+) dB', volume).group(1)); peak = float(re.search(r'max_volume: ([-\d.]+) dB', volume).group(1))
    assert -35 < mean < -8 and peak < 0, (mean, peak)
    report = {'video': str(VIDEO), 'bytes': VIDEO.stat().st_size, 'chapters': len(SCENES), 'dimensions': [1920, 1080], 'video_codec': 'h264', 'audio_codec': 'aac', 'captions': 'embedded English + VTT', 'full_decode': 'passed', 'mean_volume_db': mean, 'peak_volume_db': peak, 'voice': metadata['voice']}
    (ROOT / 'fidelity-owner-import-quality-report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))

if __name__ == '__main__': main()
