"""Validate the export and create a chapter navigation player."""
import html
import json
import re
import subprocess
from pathlib import Path
import imageio_ffmpeg
from PIL import Image, ImageDraw, ImageFont
from holdings_scenes import SCENES

ROOT=Path(__file__).resolve().parent
VIDEO=ROOT/'portfolio-tracker-holdings-guide.mp4'
FFMPEG=imageio_ffmpeg.get_ffmpeg_exe()

def run(args):
    result=subprocess.run([FFMPEG,'-hide_banner',*args],capture_output=True,text=True)
    if result.returncode:
        raise RuntimeError(result.stderr[-2000:])
    return result.stderr

def main():
    timing=json.loads((ROOT/'holdings-voice-metadata.json').read_text(encoding='utf-8'))
    chapters=(ROOT/'holdings-chapters.ffmetadata').read_text(encoding='utf-8')
    starts=[int(ms)/1000 for ms in re.findall(r'^START=(\d+)',chapters,re.M)]
    probe=run(['-i',str(VIDEO),'-t','0','-f','null','-'])
    assert '1920x1080' in probe and 'Video: h264' in probe and 'Audio: aac' in probe
    assert 'Subtitle: mov_text' in probe
    assert len(starts)==len(SCENES)==27
    assert timing['voice']=='en-US-AndrewMultilingualNeural' and timing['rate']=='-4%' and timing['pitch']=='-2Hz'
    # Decode the complete export to detect damaged packets or truncated media.
    decode=run(['-v','error','-i',str(VIDEO),'-f','null','-'])
    assert not decode.strip(),decode
    volume=run(['-i',str(VIDEO),'-vn','-af','volumedetect','-f','null','-'])
    peak=float(re.search(r'max_volume: ([-\d.]+) dB',volume).group(1))
    mean=float(re.search(r'mean_volume: ([-\d.]+) dB',volume).group(1))
    assert -35<mean<-8,mean
    assert peak<0,peak
    # Verify a representative frame from each part of the encoded video.
    selected=[0,4,8,14,16,20,22,25,26]
    review=ROOT/'holdings_export_review'; review.mkdir(exist_ok=True)
    sheet=Image.new('RGB',(1440,3*295),'#081325')
    draw=ImageDraw.Draw(sheet)
    font=ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf',17)
    for number,index in enumerate(selected):
        destination=review/f'{index:02d}.png'
        run(['-y','-ss',f'{starts[index]+2:.3f}','-i',str(VIDEO),'-frames:v','1',str(destination)])
        frame=Image.open(destination); assert frame.size==(1920,1080)
        frame.thumbnail((480,270)); x=(number%3)*480;y=(number//3)*295
        sheet.paste(frame,(x,y));draw.text((x+8,y+271),SCENES[index]['title'][:48],font=font,fill='#f3f7ff')
    sheet.save(ROOT/'holdings-export-review.jpg',quality=95)
    buttons='\n'.join(f'<button data-time="{start:.3f}"><span>{int(start//60):02d}:{int(start%60):02d}</span> {html.escape(scene["title"])}</button>' for scene,start in zip(SCENES,starts))
    player='''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Portfolio Tracker: Holdings Guide</title>
<style>body{margin:0;background:#081325;color:#f3f7ff;font:18px "Segoe UI",sans-serif}main{max-width:1300px;margin:24px auto;padding:24px}h1{color:#47b9ff}p{color:#b5c8df}video{width:100%;background:#000;border-radius:12px}#chapters{columns:2;column-gap:18px}button{display:block;width:100%;padding:13px;margin:6px 0;text-align:left;background:#15213c;color:#f3f7ff;border:1px solid #29496c;border-radius:7px;cursor:pointer;break-inside:avoid;font:16px "Segoe UI",sans-serif}button:hover{border-color:#47b9ff}button span{color:#47b9ff;font-variant-numeric:tabular-nums}a{color:#47b9ff}@media(max-width:700px){#chapters{columns:1}}</style></head>
<body><main><h1>Portfolio Tracker: Complete Holdings Guide</h1><p>27 chapters · Approximately 23 minutes · English captions · Same voice as the dashboard guide</p>
<video id="guide" controls preload="metadata"><source src="portfolio-tracker-holdings-guide.mp4" type="video/mp4"><track kind="captions" src="holdings-narration.vtt" srclang="en" label="English"></video>
<p><a href="portfolio-tracker-holdings-guide.mp4" download>Download video</a> · <a href="holdings-narration.txt">Narration and chapter list</a> · <a href="holdings-narration.vtt" download>English captions</a></p>
<h2>Jump to a chapter</h2><div id="chapters">'''+buttons+'''</div><p>For informational purposes only. Not financial advice.</p></main>
<script>document.querySelectorAll('[data-time]').forEach(button=>button.addEventListener('click',()=>{const video=document.getElementById('guide');video.currentTime=Number(button.dataset.time);video.play();video.scrollIntoView({behavior:'smooth'});}));</script></body></html>'''
    (ROOT/'holdings-guide-player.html').write_text(player,encoding='utf-8')
    report=dict(video=str(VIDEO),bytes=VIDEO.stat().st_size,chapters=27,dimensions=[1920,1080],video_codec='h264',audio_codec='aac',captions='embedded English + VTT',full_decode='passed',mean_volume_db=mean,peak_volume_db=peak,voice=timing['voice'],rate=timing['rate'],pitch=timing['pitch'])
    (ROOT/'holdings-quality-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps(report,indent=2))

if __name__=='__main__':
    main()
