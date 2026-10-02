"""Generate the Growth walkthrough narration and synchronized captions."""

from __future__ import annotations

import asyncio
import json
import re
import subprocess
from pathlib import Path

import edge_tts
import imageio_ffmpeg

from growth_scenes import SCENES


ROOT = Path(__file__).resolve().parent
VOICE_DIR = ROOT / "growth_voice"
VOICE = "en-US-AndrewMultilingualNeural"
RATE = "-4%"
PITCH = "-2Hz"
LEAD_SECONDS = 0.5
TAIL_SECONDS = 0.7


def duration(path: Path) -> float:
    result = subprocess.run(
        [imageio_ffmpeg.get_ffmpeg_exe(), "-i", str(path), "-f", "null", "-"],
        capture_output=True, text=True, check=False,
    )
    match = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", result.stderr)
    if not match:
        raise RuntimeError(f"Could not determine duration for {path}")
    hours, minutes, seconds = match.groups()
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


def stamp(seconds: float) -> str:
    milliseconds = max(0, round(seconds * 1000))
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{millis:03d}"


def sentences(text: str) -> list[str]:
    return [item.strip() for item in re.split(r"(?<=[.!?])\s+", text) if item.strip()]


async def voice(scene: dict) -> dict:
    output = VOICE_DIR / f"{scene['id']}.mp3"
    for attempt in range(1, 7):
        output.unlink(missing_ok=True)
        try:
            await edge_tts.Communicate(scene["narration"], VOICE, rate=RATE, pitch=PITCH).save(str(output))
            break
        except Exception:
            if attempt == 6:
                raise
            await asyncio.sleep(min(attempt * 3, 15))
    audio_duration = duration(output)
    return {
        "id": scene["id"], "audio": output.name,
        "audio_duration": round(audio_duration, 3),
        "scene_duration": round(audio_duration + LEAD_SECONDS + TAIL_SECONDS, 3),
    }


def write_captions(metadata: list[dict]) -> None:
    cues, script = ["WEBVTT", ""], [
        "Portfolio Tracker — Growth walkthrough",
        f"Voice: {VOICE} · rate {RATE} · pitch {PITCH}",
        "",
    ]
    timeline = 0.0
    number = 1
    for index, (scene, item) in enumerate(zip(SCENES, metadata), start=1):
        script.extend([f"{index:02d}. {scene['title']}", scene["narration"], ""])
        parts = sentences(scene["narration"])
        weights = [max(1, len(part.split())) for part in parts]
        total = sum(weights)
        cursor = timeline + LEAD_SECONDS
        for part, weight in zip(parts, weights):
            end = cursor + item["audio_duration"] * weight / total
            cues.extend([str(number), f"{stamp(cursor)} --> {stamp(end)}", part, ""])
            number += 1
            cursor = end
        timeline += item["scene_duration"]
    (ROOT / "growth-narration.vtt").write_text("\n".join(cues), encoding="utf-8")
    (ROOT / "growth-narration.txt").write_text("\n".join(script), encoding="utf-8")


async def main() -> None:
    VOICE_DIR.mkdir(parents=True, exist_ok=True)
    metadata = []
    for index, scene in enumerate(SCENES, start=1):
        print(f"Generating narration {index}/{len(SCENES)}: {scene['title']}", flush=True)
        metadata.append(await voice(scene))
    payload = {
        "voice": VOICE, "rate": RATE, "pitch": PITCH,
        "lead_seconds": LEAD_SECONDS, "tail_seconds": TAIL_SECONDS,
        "total_duration": round(sum(item["scene_duration"] for item in metadata), 3),
        "scenes": metadata,
    }
    (ROOT / "growth-voice-metadata.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    write_captions(metadata)
    print(f"Created {len(metadata)} narration clips ({payload['total_duration'] / 60:.2f} minutes).")


if __name__ == "__main__":
    asyncio.run(main())
