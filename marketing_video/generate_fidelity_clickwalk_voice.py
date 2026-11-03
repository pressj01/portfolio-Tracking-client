"""Generate the same Andrew narration voice and synchronized captions."""
import asyncio, json, re, subprocess
from pathlib import Path
import edge_tts, imageio_ffmpeg
from fidelity_clickwalk_scenes import SCENES

ROOT=Path(__file__).resolve().parent; OUT=ROOT/'fidelity_clickwalk_voice'
VOICE='en-US-AndrewMultilingualNeural'; RATE='-4%'; PITCH='-2Hz'
def length(path):
    err=subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(),'-i',str(path),'-f','null','-'],capture_output=True,text=True).stderr
    m=re.search(r'Duration: (\d+):(\d+):(\d+(?:\.\d+)?)',err)
    return int(m[1])*3600+int(m[2])*60+float(m[3])
def stamp(v):
    ms=round(v*1000); h,ms=divmod(ms,3600000); m,ms=divmod(ms,60000); s,ms=divmod(ms,1000); return f'{h:02d}:{m:02d}:{s:02d}.{ms:03d}'
async def main():
    OUT.mkdir(exist_ok=True); cursor=0; entries=[]; vtt=['WEBVTT','']; text=[]
    for n,scene in enumerate(SCENES,1):
        file=OUT/f"{scene['id']}.mp3"; words=[]; print(f'Voice {n}/{len(SCENES)}: {scene["title"]}',flush=True)
        with file.open('wb') as stream:
            async for event in edge_tts.Communicate(scene['narration'],VOICE,rate=RATE,pitch=PITCH,boundary='WordBoundary').stream():
                if event['type']=='audio': stream.write(event['data'])
                elif event['type']=='WordBoundary': words.append((event['offset']/1e7,event['duration']/1e7,event['text']))
        audio=length(file); duration=audio+1.2; entries.append({'id':scene['id'],'audio':file.name,'audio_duration':audio,'scene_duration':duration,'start':cursor})
        for i in range(0,len(words),9):
            group=words[i:i+9]; vtt += [f'{stamp(cursor+.5+group[0][0])} --> {stamp(cursor+.5+group[-1][0]+group[-1][1])}',' '.join(x[2] for x in group),'']
        text += [f'{stamp(cursor)}  {n:02d}. {scene["title"]}',scene['narration'],'']; cursor+=duration
    (ROOT/'fidelity-clickwalk-voice-metadata.json').write_text(json.dumps({'voice':VOICE,'rate':RATE,'pitch':PITCH,'total_duration':cursor,'scenes':entries},indent=2),encoding='utf-8')
    (ROOT/'fidelity-clickwalk-narration.vtt').write_text('\n'.join(vtt),encoding='utf-8')
    (ROOT/'fidelity-clickwalk-narration.txt').write_text('Portfolio Tracker — Fidelity Click-by-Click Guide\n'+f'Voice: {VOICE}; rate {RATE}; pitch {PITCH}\n\n'+'\n'.join(text),encoding='utf-8')
    print(f'Created {len(entries)} chapters, {cursor/60:.2f} minutes.')
if __name__=='__main__': asyncio.run(main())
