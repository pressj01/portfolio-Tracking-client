from __future__ import annotations

import asyncio
import json
import re
import subprocess
from pathlib import Path

import edge_tts
import imageio_ffmpeg

from dashboard_scenes import SCENES


ROOT = Path(__file__).resolve().parent
VOICE_DIR = ROOT / "dashboard_voice"
NARRATION_TEXT = ROOT / "dashboard-narration.txt"
NARRATION_VTT = ROOT / "dashboard-narration.vtt"
METADATA_PATH = ROOT / "dashboard-voice-metadata.json"

VOICE = "en-US-AndrewMultilingualNeural"
RATE = "-4%"
PITCH = "-2Hz"
LEAD_SECONDS = 0.5
TAIL_SECONDS = 0.7


def probe_duration(path: Path) -> float:
    command = [imageio_ffmpeg.get_ffmpeg_exe(), "-i", str(path), "-f", "null", "-"]
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    match = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", result.stderr)
    if not match:
        raise RuntimeError(f"Could not determine audio duration for {path}")
    hours, minutes, seconds = match.groups()
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


def timestamp(seconds: float) -> str:
    milliseconds = max(0, round(seconds * 1000))
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{millis:03d}"


def sentences(text: str) -> list[str]:
    return [part.strip() for part in re.split(r"(?<=[.!?])\s+", text.strip()) if part.strip()]


async def make_voice(scene: dict) -> dict:
    destination = VOICE_DIR / f"{scene['id']}.mp3"
    if destination.exists():
        try:
            audio_duration = probe_duration(destination)
            if audio_duration > 1:
                return {
                    "id": scene["id"],
                    "audio": destination.name,
                    "audio_duration": round(audio_duration, 3),
                    "scene_duration": round(audio_duration + LEAD_SECONDS + TAIL_SECONDS, 3),
                }
        except RuntimeError:
            pass

    last_error = None
    for attempt in range(1, 7):
        destination.unlink(missing_ok=True)
        communicator = edge_tts.Communicate(
            scene["narration"],
            VOICE,
            rate=RATE,
            pitch=PITCH,
        )
        try:
            await communicator.save(str(destination))
            break
        except Exception as error:  # The public speech endpoint can briefly reset its websocket.
            last_error = error
            if attempt == 6:
                raise
            print(f"  Voice connection failed (attempt {attempt}/6); retrying...", flush=True)
            await asyncio.sleep(min(3 * attempt, 15))
    if not destination.exists():
        raise RuntimeError(f"Narration was not created for {scene['id']}") from last_error
    audio_duration = probe_duration(destination)
    return {
        "id": scene["id"],
        "audio": destination.name,
        "audio_duration": round(audio_duration, 3),
        "scene_duration": round(audio_duration + LEAD_SECONDS + TAIL_SECONDS, 3),
    }


def write_text_script() -> None:
    lines = [
        "Portfolio Tracker — Detailed Dashboard Walkthrough",
        f"Voice: {VOICE} · rate {RATE} · pitch {PITCH}",
        "",
    ]
    for index, scene in enumerate(SCENES, start=1):
        lines.extend([
            f"{index:02d}. {scene['title']}",
            scene["narration"],
            "",
        ])
    NARRATION_TEXT.write_text("\n".join(lines), encoding="utf-8")


def write_vtt(metadata: list[dict]) -> None:
    cues = ["WEBVTT", ""]
    timeline = 0.0
    cue_number = 1
    for scene, item in zip(SCENES, metadata):
        parts = sentences(scene["narration"])
        weights = [max(1, len(part.split())) for part in parts]
        total_weight = sum(weights)
        cursor = timeline + LEAD_SECONDS
        for part, weight in zip(parts, weights):
            duration = item["audio_duration"] * weight / total_weight
            cue_end = cursor + duration
            cues.extend([
                str(cue_number),
                f"{timestamp(cursor)} --> {timestamp(cue_end)}",
                part,
                "",
            ])
            cue_number += 1
            cursor = cue_end
        timeline += item["scene_duration"]
    NARRATION_VTT.write_text("\n".join(cues), encoding="utf-8")


async def main() -> None:
    VOICE_DIR.mkdir(parents=True, exist_ok=True)
    write_text_script()
    metadata = []
    for index, scene in enumerate(SCENES, start=1):
        print(f"Generating narration {index}/{len(SCENES)}: {scene['title']}", flush=True)
        metadata.append(await make_voice(scene))

    payload = {
        "voice": VOICE,
        "rate": RATE,
        "pitch": PITCH,
        "lead_seconds": LEAD_SECONDS,
        "tail_seconds": TAIL_SECONDS,
        "total_duration": round(sum(item["scene_duration"] for item in metadata), 3),
        "scenes": metadata,
    }
    METADATA_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    write_vtt(metadata)
    print(f"Created {len(metadata)} narration clips ({payload['total_duration']:.1f}s total).")


if __name__ == "__main__":
    asyncio.run(main())
