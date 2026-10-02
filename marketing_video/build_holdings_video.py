"""Compose readable, chaptered 1080p Holdings walkthrough and mux captions."""
import concurrent.futures
import json
import re
import subprocess
import textwrap
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance
import imageio_ffmpeg
from holdings_scenes import SCENES

ROOT = Path(__file__).resolve().parent
STAGES = ROOT / 'holdings_scenes'
CLIPS = ROOT / 'holdings_clips'
OUTPUT = ROOT / 'portfolio-tracker-holdings-guide.mp4'
TIMING_REPORT = ROOT / 'holdings-visual-timing.json'
WIDTH, HEIGHT = 1920, 1080
BG = '#081325'
WHITE = '#f3f7ff'
MUTED = '#b5c8df'
ACCENT = '#47b9ff'
FONT_DIR = Path('C:/Windows/Fonts')
FRAMING_PATH = ROOT/'holdings_captures'/'modal-framing.json'
def font(size, bold=False):
    return ImageFont.truetype(str(FONT_DIR / ('segoeuib.ttf' if bold else 'segoeui.ttf')),size)

def wrapped(draw, text, pos, size, color=WHITE, width=420, bold=False):
    f = font(size,bold)
    lines, line = [], ''
    for word in text.split():
        proposed = (line+' '+word).strip()
        if draw.textlength(proposed,font=f)>width and line:
            lines.append(line)
            line=word
        else:
            line=proposed
    if line:
        lines.append(line)
    x,y=pos
    for line in lines:
        draw.text((x,y),line,font=f,fill=color)
        y+=round(size*1.4)
    return y

def compose(scene,index,shot,stage):
    file, box = shot
    source=Image.open(ROOT/'holdings_captures'/file).convert('RGB')
    framing=json.loads(FRAMING_PATH.read_text(encoding='utf-8')) if FRAMING_PATH.exists() else {}
    if file in framing:
        r=framing[file]
        box=tuple(round(v) for v in (r['x'],r['y'],r['x']+r['w'],r['y']+r['h']))
        focus={
            '14-basic-position':(0,0,700,465),
            '15-edit-dividends':(0,470,700,725),
            '16-edit-tracking':(0,300,700,918),
            '19-buy-edit':(0,455,1200,918),
            '20-sell-lots':(0,480,1200,918),
        }.get(scene['id'])
        if focus and not (scene['id']=='19-buy-edit' and stage==1):
            box=tuple(round(v) for v in (r['x']+focus[0],r['y']+focus[1],r['x']+focus[2],r['y']+focus[3]))
    if box[2]>source.width+2 or box[3]>source.height+2:
        raise ValueError(f'Crop exceeds capture: {file} {box} vs {source.size}')
    detail=source.crop(box)
    canvas=Image.new('RGB',(WIDTH,HEIGHT),BG)
    d=ImageDraw.Draw(canvas)
    d.rounded_rectangle((44,32,355,77),radius=18,fill=ACCENT)
    d.text((63,42),'PORTFOLIO TRACKER',font=font(22,True),fill='#071526')
    d.text((WIDTH-260,42),f'HOLDINGS  •  {index+1:02d}/{len(SCENES)}',font=font(22),fill=MUTED)
    d.text((48,99),scene['title'],font=font(45,True),fill=WHITE)
    d.text((50,161),scene['subtitle'],font=font(25),fill=MUTED)
    if scene['kind'] in ('title','outro'):
        backdrop=detail.resize((1816,760)).filter(ImageFilter.GaussianBlur(7))
        backdrop=ImageEnhance.Brightness(backdrop).enhance(.23)
        canvas.paste(backdrop,(52,221))
        d=ImageDraw.Draw(canvas)
        y=290
        for bullet in scene['bullets']:
            d.text((115,y),bullet,font=font(59,True),fill=WHITE if y!=415 else ACCENT)
            y+=125
        d.text((117,862),'Your holdings, income, and transaction history in one place.',font=font(32),fill=MUTED)
        if scene['kind']=='outro':
            d.text((117,922),'For informational purposes only. Not financial advice.',font=font(26),fill=MUTED)
    else:
        d.rounded_rectangle((44,220,1460,983),radius=18,fill='#15213c',outline='#29496c',width=2)
        # Never include the holdings total at the bottom of a capture. The
        # chosen table crops stop above the footer; dialog crops stop at 985.
        ratio=min(1376/detail.width,723/detail.height,3.0)
        detail=detail.resize((round(detail.width*ratio),round(detail.height*ratio)),Image.Resampling.LANCZOS)
        x=752-detail.width//2
        y=601-detail.height//2
        canvas.paste(detail,(x,y))
        d=ImageDraw.Draw(canvas)
        d.text((1500,232),'WHAT TO LOOK FOR',font=font(22,True),fill=ACCENT)
        y=289
        highlighted=scene['shot_bullets'][stage]
        for number,bullet in enumerate(scene['bullets'],1):
            fill=ACCENT if number==highlighted else '#476784'
            d.ellipse((1500,y,1540,y+40),fill=fill)
            d.text((1512,y+4),str(number),font=font(22,True),fill=BG)
            y=wrapped(d,bullet,(1556,y),28,width=306,bold=True)+55
        d.text((1500,914),'Detailed screen guide',font=font(21),fill=MUTED)
    d=ImageDraw.Draw(canvas)
    d.text((49,1014),'HOLDINGS  /  POSITION  /  INCOME  /  EDITING',font=font(21),fill=MUTED)
    d.rounded_rectangle((1180,1026,1870,1035),radius=4,fill='#1f344e')
    d.rounded_rectangle((1180,1026,1180+int(690*(index+1)/len(SCENES)),1035),radius=4,fill=ACCENT)
    path=STAGES/f"{index:02d}-{scene['id']}-{stage}.png"
    canvas.save(path)
    return path

def prepare():
    STAGES.mkdir(exist_ok=True)
    paths=[]
    for index,scene in enumerate(SCENES):
        paths.append([compose(scene,index,shot,stage) for stage,shot in enumerate(scene['shots'])])
    # Full-resolution frames and a contact sheet make visual review repeatable.
    thumbs=Image.new('RGB',(1280,((len(paths)+3)//4)*198),BG)
    d=ImageDraw.Draw(thumbs)
    for index,items in enumerate(paths):
        thumb=Image.open(items[0]); thumb.thumbnail((320,180))
        x=(index%4)*320; y=(index//4)*198
        thumbs.paste(thumb,(x,y)); d.text((x+5,y+180),SCENES[index]['id'],font=font(13),fill=WHITE)
    thumbs.save(ROOT/'holdings-contact-sheet.jpg',quality=95)
    return paths

def words(value):
    """Normalize narration and speech-boundary text for deterministic matching."""
    return re.findall(r"[a-z0-9]+", value.lower())

def find_cue_offset(scene, cue, after):
    """Find the first spoken word of a cue in Edge's saved word boundaries."""
    boundaries=json.loads((ROOT/'holdings_voice'/f"{scene['id']}.json").read_text(encoding='utf-8'))
    spoken=[words(item['text'])[0] for item in boundaries if words(item['text'])]
    cue_words=words(cue)
    for index in range(after, len(spoken)-len(cue_words)+1):
        if spoken[index:index+len(cue_words)] == cue_words:
            return index, float(boundaries[index]['offset'])
    raise ValueError(f"Could not match timing cue {cue!r} in {scene['id']}")

def visual_schedule(scene, item, paths):
    """Return visual durations aligned to spoken UI-control cues.

    Narration is delayed by 0.5 seconds in each clip.  A frame changes 0.15
    seconds before its cue so the named control is visible as it is introduced.
    """
    duration=float(item['scene_duration'])
    cues=scene['timing_cues']
    if len(paths) == 1:
        return [duration], []
    if len(cues) != len(paths)-1:
        raise ValueError(f"{scene['id']} has {len(paths)} visuals but {len(cues)} timing cues")
    starts=[0.0]
    matched=[]
    cursor=0
    for cue in cues:
        cursor, offset=find_cue_offset(scene, cue, cursor)
        start=min(duration-.75, max(starts[-1]+.75, .5+offset-.15))
        starts.append(start)
        matched.append({'cue':cue, 'spoken_offset_seconds':round(offset,3), 'visual_start_seconds':round(start,3)})
        cursor+=1
    starts.append(duration)
    return [round(end-start,6) for start,end in zip(starts,starts[1:])], matched

def render(index,paths,item,schedule):
    scene=SCENES[index]
    target=CLIPS/f"{index:02d}-{scene['id']}.mp4"
    listing=target.with_suffix('.txt')
    duration=item['scene_duration']
    listing.write_text('\n'.join(f"file '{path.as_posix()}'\nduration {segment:.6f}" for path,segment in zip(paths,schedule))+f"\nfile '{paths[-1].as_posix()}'\n",encoding='utf-8')
    cmd=[imageio_ffmpeg.get_ffmpeg_exe(),'-y','-hide_banner','-loglevel','error',
         '-f','concat','-safe','0','-i',str(listing),'-i',str(ROOT/'holdings_voice'/item['audio']),
         '-vf','fps=30,format=yuv420p','-af',f'adelay=500|500,aresample=48000,apad,atrim=duration={duration:.3f}',
         '-t',f'{duration:.3f}','-c:v','libx264','-preset','fast','-crf','18','-threads','2',
         '-c:a','aac','-b:a','192k','-ar','48000','-ac','2','-movflags','+faststart',str(target)]
    subprocess.run(cmd,check=True)
    print(f'Rendered {index+1}/{len(SCENES)}: {scene["title"]}',flush=True)
    return target

def main():
    paths=prepare()
    data=json.loads((ROOT/'holdings-voice-metadata.json').read_text(encoding='utf-8'))
    CLIPS.mkdir(exist_ok=True)
    schedules=[]
    timing_report=[]
    for index,item in enumerate(data['scenes']):
        schedule,matched=visual_schedule(SCENES[index],item,paths[index])
        schedules.append(schedule)
        timing_report.append({'index':index, 'id':SCENES[index]['id'], 'title':SCENES[index]['title'], 'segment_durations_seconds':schedule, 'cues':matched})
    TIMING_REPORT.write_text(json.dumps({'audio_lead_seconds':.5, 'visual_lead_seconds':.15, 'scenes':timing_report},indent=2),encoding='utf-8')
    import sys
    selected=None
    if '--only' in sys.argv:
        selected={int(i) for i in sys.argv[sys.argv.index('--only')+1].split(',')}
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        futures=[pool.submit(render,i,paths[i],item,schedules[i]) for i,item in enumerate(data['scenes']) if selected is None or i in selected]
        for future in futures:
            future.result()
    clips=[CLIPS/f"{i:02d}-{scene['id']}.mp4" for i,scene in enumerate(SCENES)]
    listing=CLIPS/'concat.txt'
    listing.write_text('\n'.join(f"file '{path.as_posix()}'" for path in clips),encoding='utf-8')
    chapters=[';FFMETADATA1','title=Portfolio Tracker - Complete Holdings Guide','artist=Portfolio Tracker','comment=Detailed holdings, income, DRIP, and editing walkthrough']
    # Use actual encoded chapter lengths so all chapter markers stay aligned.
    import generate_dashboard_voice as probe
    cursor=0.0
    for scene,clip in zip(SCENES,clips):
        length=probe.probe_duration(clip)
        chapters.extend(['[CHAPTER]','TIMEBASE=1/1000',f'START={round(cursor*1000)}',f'END={round((cursor+length)*1000)}',f'title={scene["title"]}'])
        cursor+=length
    metadata=ROOT/'holdings-chapters.ffmetadata'
    metadata.write_text('\n'.join(chapters),encoding='utf-8')
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(),'-y','-hide_banner','-loglevel','error','-f','concat','-safe','0','-i',str(listing),
                    '-i',str(ROOT/'holdings-narration.vtt'),'-i',str(metadata),'-map','0:v','-map','0:a','-map','1:0',
                    '-map_metadata','2','-map_chapters','2','-c:v','copy','-c:a','copy','-c:s','mov_text','-metadata:s:s:0','language=eng',
                    '-metadata:s:s:0','title=English captions','-movflags','+faststart',str(OUTPUT)],check=True)
    print(f'Created {OUTPUT}; {cursor/60:.2f} minutes',flush=True)

if __name__=='__main__':
    import sys
    if '--prepare-only' in sys.argv:
        prepare()
    else:
        main()
