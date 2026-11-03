"""Validate click-by-click tutorial output."""
import json,re,subprocess
from pathlib import Path
import imageio_ffmpeg
from fidelity_clickwalk_scenes import SCENES
ROOT=Path(__file__).resolve().parent; VIDEO=ROOT/'portfolio-tracker-fidelity-click-by-click-guide.mp4'; FFMPEG=imageio_ffmpeg.get_ffmpeg_exe()
def run(args):
    res=subprocess.run([FFMPEG,'-hide_banner',*args],capture_output=True,text=True)
    if res.returncode: raise RuntimeError(res.stderr[-2000:])
    return res.stderr
def main():
    meta=json.loads((ROOT/'fidelity-clickwalk-voice-metadata.json').read_text(encoding='utf-8')); chapter=(ROOT/'fidelity-clickwalk-chapters.ffmetadata').read_text(encoding='utf-8'); starts=re.findall(r'^START=(\d+)',chapter,re.M); probe=run(['-i',str(VIDEO),'-t','0','-f','null','-']); assert '1920x1080' in probe and 'Video: h264' in probe and 'Audio: aac' in probe and 'Subtitle: mov_text' in probe; assert len(starts)==len(SCENES); assert meta['voice']=='en-US-AndrewMultilingualNeural'; assert not run(['-v','error','-i',str(VIDEO),'-f','null','-']).strip(); volume=run(['-i',str(VIDEO),'-vn','-af','volumedetect','-f','null','-']); mean=float(re.search(r'mean_volume: ([-\d.]+) dB',volume).group(1)); peak=float(re.search(r'max_volume: ([-\d.]+) dB',volume).group(1)); assert -35<mean<-8 and peak<0,(mean,peak)
    report={'video':str(VIDEO),'bytes':VIDEO.stat().st_size,'chapters':len(SCENES),'dimensions':[1920,1080],'video_codec':'h264','audio_codec':'aac','captions':'embedded English + VTT','full_decode':'passed','mean_volume_db':mean,'peak_volume_db':peak,'voice':meta['voice']}; (ROOT/'fidelity-clickwalk-quality-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8'); print(json.dumps(report,indent=2))
if __name__=='__main__': main()
