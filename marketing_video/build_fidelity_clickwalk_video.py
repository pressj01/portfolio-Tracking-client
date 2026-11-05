"""Compose a narrated visual-click Fidelity portfolio tutorial."""
import concurrent.futures, json, re, subprocess
from pathlib import Path
import imageio_ffmpeg
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont
from fidelity_clickwalk_scenes import SCENES

ROOT=Path(__file__).resolve().parent; STAGES=ROOT/'fidelity_clickwalk_scenes'; CLIPS=ROOT/'fidelity_clickwalk_clips'
OUTPUT=ROOT/'portfolio-tracker-fidelity-click-by-click-guide.mp4'; W,H=1920,1080; FFMPEG=imageio_ffmpeg.get_ffmpeg_exe()
BG='#081325'; PANEL='#15213c'; BORDER='#29496c'; WHITE='#f3f7ff'; MUTED='#b5c8df'; ACCENT='#47b9ff'; AMBER='#ffca58'
def font(s,b=False): return ImageFont.truetype('C:/Windows/Fonts/'+('segoeuib.ttf' if b else 'segoeui.ttf'),s)
def wrap(d,text,x,y,width,size,color=WHITE,bold=False):
    f=font(size,bold); line=''; lines=[]
    for word in text.split():
        candidate=(line+' '+word).strip()
        if line and d.textlength(candidate,font=f)>width: lines.append(line); line=word
        else: line=candidate
    if line: lines.append(line)
    for line in lines: d.text((x,y),line,font=f,fill=color); y+=round(size*1.32)
    return y
def redact(img,scene):
    regions={'navigate_admin':[(0,0,1280,80)],'new_portfolio':[(0,570,1280,720)],'name_portfolio':[(0,570,1280,720)],'set_fidelity_owner':[(0,0,1280,55)],'owner_shared':[(0,0,1280,380),(0,450,1280,720)],'owner_unique':[(0,0,1280,440),(0,535,1280,720)]}
    for box in regions.get(scene['id'],[]):
        area=ImageEnhance.Brightness(img.crop(box).filter(ImageFilter.GaussianBlur(18))).enhance(.33); img.paste(area,box)
    return img
def cursor(d,x,y,scale):
    x=int(x*scale); y=int(y*scale)
    for radius,alpha in [(42,'#1c79b5'),(28,'#3197d6'),(15,AMBER)]: d.ellipse((x-radius,y-radius,x+radius,y+radius),outline=alpha,width=4)
    d.polygon([(x,y),(x+27,y+67),(x+11,y+54),(x+1,y+76),(x-10,y+70),(x,y+49),(x-19,y+47)],fill=WHITE,outline=BG)
def compose(scene,index):
    raw=redact(Image.open(scene['image']).convert('RGB'),scene); canvas=Image.new('RGB',(W,H),BG); d=ImageDraw.Draw(canvas)
    d.rounded_rectangle((44,30,390,79),18,fill=ACCENT); d.text((64,42),'PORTFOLIO TRACKER',font=font(22,True),fill=BG)
    d.text((W-440,43),f'LIVE CLICK WALKTHROUGH  •  {index+1:02d}/{len(SCENES):02d}',font=font(20),fill=MUTED)
    d.text((48,101),scene['title'],font=font(41,True),fill=WHITE); d.text((50,158),scene['subtitle'],font=font(23),fill=MUTED)
    d.rounded_rectangle((44,218,1400,978),18,fill=PANEL,outline=BORDER,width=2)
    ratio=min(1314/raw.width,716/raw.height); shown=raw.resize((round(raw.width*ratio),round(raw.height*ratio)),Image.Resampling.LANCZOS); x=722-shown.width//2; y=600-shown.height//2; canvas.paste(shown,(x,y)); d=ImageDraw.Draw(canvas)
    fx1,fy1,fx2,fy2=scene['focus']; d.rounded_rectangle((x+int(fx1*ratio),y+int(fy1*ratio),x+int(fx2*ratio),y+int(fy2*ratio)),12,outline=AMBER,width=4)
    cx,cy=scene['click']; cursor(d,x+cx*ratio,y+cy*ratio,1)
    d.text((1450,244),'CLICK + EXPLAIN',font=font(21,True),fill=ACCENT); yy=302
    for n,bullet in enumerate(scene['bullets'],1):
        d.ellipse((1450,yy,1491,yy+41),fill=ACCENT); d.text((1463,yy+5),str(n),font=font(21,True),fill=BG); yy=wrap(d,bullet,1510,yy,345,27,WHITE,True)+50
    d.rounded_rectangle((1450,824,1860,940),13,fill='#173351',outline=ACCENT,width=2)
    note='The yellow ring marks the actual control being used.' if index<8 else 'Owner combines selected accounts; it does not overwrite them.'
    wrap(d,note,1470,844,365,21,WHITE,True)
    d.text((50,1017),'ADMIN  /  PORTFOLIOS  /  FIDELITY IMPORT  /  OWNER',font=font(19),fill=MUTED); d.rounded_rectangle((1190,1027,1868,1037),5,fill='#1f344e'); d.rounded_rectangle((1190,1027,1190+round(678*(index+1)/len(SCENES)),1037),5,fill=ACCENT)
    out=STAGES/f'{index:02d}-{scene["id"]}.png'; canvas.save(out); return out
def probe(path):
    text=subprocess.run([FFMPEG,'-i',str(path),'-f','null','-'],capture_output=True,text=True).stderr; m=re.search(r'Duration: (\d+):(\d+):(\d+(?:\.\d+)?)',text); return int(m[1])*3600+int(m[2])*60+float(m[3])
def render(index,frame,data):
    out=CLIPS/f'{index:02d}-{SCENES[index]["id"]}.mp4'; duration=data['scene_duration']
    subprocess.run([FFMPEG,'-y','-hide_banner','-loglevel','error','-loop','1','-framerate','30','-i',str(frame),'-i',str(ROOT/'fidelity_clickwalk_voice'/data['audio']),'-vf','fps=30,format=yuv420p','-af',f'adelay=500|500,aresample=48000,apad,atrim=duration={duration:.3f}','-t',f'{duration:.3f}','-c:v','libx264','-preset','fast','-crf','18','-threads','2','-c:a','aac','-b:a','192k','-ar','48000','-ac','2','-movflags','+faststart',str(out)],check=True); print(f'Rendered {index+1}/{len(SCENES)}: {SCENES[index]["title"]}',flush=True); return out
def main():
    STAGES.mkdir(exist_ok=True); CLIPS.mkdir(exist_ok=True); frames=[compose(scene,i) for i,scene in enumerate(SCENES)]
    sheet=Image.new('RGB',(1280,((len(frames)+3)//4)*198),BG)
    for i,file in enumerate(frames): im=Image.open(file); im.thumbnail((320,180)); sheet.paste(im,((i%4)*320,(i//4)*198))
    sheet.save(ROOT/'fidelity-clickwalk-contact-sheet.jpg',quality=95)
    metadata=json.loads((ROOT/'fidelity-clickwalk-voice-metadata.json').read_text(encoding='utf-8'))
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        jobs=[pool.submit(render,i,frame,metadata['scenes'][i]) for i,frame in enumerate(frames)]
        for job in jobs: job.result()
    clips=[CLIPS/f'{i:02d}-{scene["id"]}.mp4' for i,scene in enumerate(SCENES)]; listing=CLIPS/'concat.txt'; listing.write_text('\n'.join(f"file '{path.as_posix()}'" for path in clips),encoding='utf-8')
    cursor=0; chapters=[';FFMETADATA1','title=Portfolio Tracker - Fidelity Click-by-Click Guide','artist=Portfolio Tracker','comment=Live clicks, real Fidelity imports, test account navigation, and Owner aggregation']
    for scene,clip in zip(SCENES,clips): duration=probe(clip); chapters += ['[CHAPTER]','TIMEBASE=1/1000',f'START={round(cursor*1000)}',f'END={round((cursor+duration)*1000)}',f'title={scene["title"]}']; cursor+=duration
    chapter=ROOT/'fidelity-clickwalk-chapters.ffmetadata'; chapter.write_text('\n'.join(chapters),encoding='utf-8')
    subprocess.run([FFMPEG,'-y','-hide_banner','-loglevel','error','-f','concat','-safe','0','-i',str(listing),'-i',str(ROOT/'fidelity-clickwalk-narration.vtt'),'-i',str(chapter),'-map','0:v','-map','0:a','-map','1:0','-map_metadata','2','-map_chapters','2','-c:v','copy','-c:a','copy','-c:s','mov_text','-metadata:s:s:0','language=eng','-metadata:s:s:0','title=English captions','-movflags','+faststart',str(OUTPUT)],check=True)
    print(f'Created {OUTPUT}; {cursor/60:.2f} minutes')
if __name__=='__main__': main()
