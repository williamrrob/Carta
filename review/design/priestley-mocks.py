import json, os
OUT="/home/claude/design/project/"
INK="#2b2119"; MUT="#6d5d48"; RED="#a4503a"; BLUE="#3d5f86"; PAP="#f1e8d3"
LAID="repeating-linear-gradient(90deg, rgba(43,33,25,.035) 0 1px, transparent 1px 26px), repeating-linear-gradient(0deg, rgba(43,33,25,.025) 0 1px, transparent 1px 3px)"
def page(title, body, lang="en"):
    return f'''<!doctype html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
<title>{title}</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Libre+Caslon+Text:ital,wght@0,400;0,700;1,400&amp;family=Libre+Caslon+Display&amp;display=swap">
<style>
body{{margin:0}}
button{{font-family:inherit;color:{INK};background:transparent;cursor:pointer}}
.sc{{font-size:10.5px;letter-spacing:.22em;text-transform:uppercase}}
.frame{{box-sizing:border-box;background:{PAP};border:2px solid {INK};outline:.6px solid {INK};outline-offset:-6px}}
.btn{{font-size:11px;letter-spacing:.2em;text-transform:uppercase;border:1px solid {INK};min-height:44px;padding:0 16px}}
.btn.dark{{background:{INK};color:{PAP}}}
.new{{border-bottom:1.5px dotted {RED}}}
</style>
</helmet>
<div style="width: 390px; height: 844px; box-sizing: border-box; position: relative; overflow: hidden; background-color: {PAP}; background-image: {LAID}; font-family: 'Libre Caslon Text', Georgia, serif; color: {INK}">
{body}
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{{"$preview":{{"width":390,"height":844}}}}'>
class Component extends DCLogic {{
  renderVals() {{ return {{}}; }}
}}
</script>
</body>
</html>
'''
ORB=f'<button type="button" aria-label="Divisions" style="position: absolute; right: 16px; bottom: 16px; width: 58px; height: 58px; background: {PAP}; border: 2px solid {INK}; outline: .6px solid {INK}; outline-offset: -5px; font-size: 30px">☞</button>'
KB='<div aria-hidden="true" style="position: absolute; left: 0; right: 0; bottom: 0; height: 291px; background: #d3d5db; display: flex; align-items: center; justify-content: center; font-family: -apple-system, system-ui, sans-serif; font-size: 12px; color: #6b6f78">keyboard</div>'

def wholemap(w=390,h=844,dim=False):
    # a scatter of family discs for the zoomed-out map
    import random; r=random.Random(7); s=[]
    for k in range(70):
        x=r.uniform(20,w-20); y=r.uniform(90,h-110); rad=r.choice([3,5,8,12,18,26])
        s.append(f'<circle cx="{x:.0f}" cy="{y:.0f}" r="{rad}" fill="none" stroke="{INK}" stroke-width=".5" opacity=".35"></circle><circle cx="{x:.0f}" cy="{y:.0f}" r="{max(1.5,rad/7):.1f}" fill="{INK}" opacity=".7"></circle>')
    labels=[(60,210,"*bher-"),(250,300,"*deh₃-"),(120,470,"*men-"),(290,560,"*gneh₃-"),(80,640,"*sed-"),(220,160,"*wer-")]
    for x,y,t in labels: s.append(f'<text x="{x}" y="{y}" font-family="Libre Caslon Text, serif" font-size="11" font-style="italic" fill="{INK}">{t}</text>')
    return f'<svg aria-hidden="true" width="{w}" height="{h}" viewBox="0 0 {w} {h}" style="position: absolute; left: 0; top: 0">{"".join(s)}</svg>'

def family(w,h,cx,cy,scale=1.0,labels=True,endo=True):
    # endormir's family: *drem- centre, dormire, dormir, endormir, dormant, dormitory, + faint relatives
    S=scale
    P=lambda x,y:(cx+x*S,cy+y*S)
    pts={"root":(0,0),"lat":(-30,-62),"fr":(-68,-118),"endo":(-104,-166),"dormant":(70,-150),"dormit":(80,-104),"mod":(58,-40)}
    s=[]
    for r_ in (80,135,190):
        s.append(f'<circle cx="{cx}" cy="{cy}" r="{r_*S:.0f}" fill="none" stroke="{INK}" stroke-width=".5" opacity=".3"></circle>')
    for nm,yy in (("TODAY",190),("1000",135),("AD 1",80)):
        s.append(f'<text x="{cx+6}" y="{cy-yy*S+12:.0f}" font-family="Libre Caslon Text, serif" font-size="8.5" letter-spacing="2" fill="{MUT}">{nm}</text>')
    # faint others
    import random; r=random.Random(3)
    for k in range(14):
        a=r.uniform(0,6.28); d=r.uniform(60,185)
        import math; x,y=cx+math.cos(a)*d*S, cy+math.sin(a)*d*S
        s.append(f'<line x1="{cx}" y1="{cy}" x2="{x:.0f}" y2="{y:.0f}" stroke="{INK}" stroke-width=".5" opacity=".18"></line><circle cx="{x:.0f}" cy="{y:.0f}" r="2" fill="{INK}" opacity=".3"></circle>')
    def L(a,b,c=INK,w_=1.6,dash=""):
        x1,y1=P(*pts[a]);x2,y2=P(*pts[b])
        return f'<line x1="{x1:.0f}" y1="{y1:.0f}" x2="{x2:.0f}" y2="{y2:.0f}" stroke="{c}" stroke-width="{w_}" {dash}></line>'
    s+= [L("root","lat"),L("lat","fr"),L("fr","endo",RED,2),L("lat","dormant",INK,.8,'stroke-dasharray="3 3"'),L("lat","dormit",INK,.8,'stroke-dasharray="3 3"')]
    def D(k,r_,c=INK):
        x,y=P(*pts[k]); return f'<circle cx="{x:.0f}" cy="{y:.0f}" r="{r_}" fill="{c}"></circle>'
    s+= [D("root",6),D("lat",4.5),D("fr",4),D("endo",6,RED),D("dormant",4,BLUE),D("dormit",4,BLUE)]
    if labels:
        def T(k,t,dx,dy,c=INK,sz=12,it=False):
            x,y=P(*pts[k]); return f'<text x="{x+dx:.0f}" y="{y+dy:.0f}" font-family="Libre Caslon Text, serif" font-size="{sz}" {"font-style=\"italic\"" if it else ""} fill="{c}">{t}</text>'
        s+= [T("root","*drem-",10,16,INK,12,True),T("lat","dormīre",10,14),T("fr","dormir",10,12),T("dormant","dormant",8,-6,BLUE),T("dormit","dormitory",-58,20,BLUE)]
        if endo: s.append(T("endo","endormir",-10,-14,RED,13))
    return "".join(s)

EXC='Longtemps, je me suis couché de bonne heure. Parfois, à peine ma <span class="new">bougie</span> <span class="new">éteinte</span>, mes yeux se fermaient si vite que je n’avais pas le temps de me dire : « Je <span class="new">m’endors</span>. »'
EN="For a long time I went to bed early. Sometimes, my candle barely out, my eyes closed so quickly that I didn’t have time to tell myself “I’m"
SRC=f'<p class="sc" style="margin: 0; color: {MUT}; letter-spacing: .18em">Proust · Du côté de chez Swann · 1913</p>'
def lhead(right=True):
    return f'''<header style="display: flex; align-items: center; gap: 4px">
      <span class="sc" style="flex-grow: 1">Français</span>
      <button type="button" class="sc" style="border: 0; min-height: 44px; padding: 0 8px">Listen</button>
      <button type="button" aria-label="Close" style="border: 0; font-size: 20px; min-width: 44px; min-height: 44px">×</button>
    </header>'''

F={}
# 1 orb panel
F["P01"]=("Orb · the four divisions", wholemap()+f'''
  <div style="position: absolute; inset: 0; background: rgba(241,232,211,.6)"></div>
  <nav class="frame" aria-label="Divisions" style="position: absolute; right: 16px; bottom: 86px; width: 230px; padding: 14px 18px; display: flex; flex-direction: column">
    {"".join(f'<button type="button" style="border: 0; text-align: left; padding: 9px 0; min-height: 44px; {"border-top: .6px solid "+INK+";" if i else ""}"><span style="font-size: 19px{"; text-decoration: underline; text-underline-offset: 4px" if n=="Explore" else ""}">{n}</span><br><i style="font-size: 12px; color: {MUT}">{d}</i></button>' for i,(n,d) in enumerate([("Explore","the whole chart"),("Learn","translate · quiz"),("Search","find a word"),("Saved","your words, excerpts, settings")]))}
  </nav>
  '''+ORB)
# 2 explore
F["P02"]=("Explore · languages along the top, navigation at the foot", wholemap()+f'''
  <div style="position: absolute; left: 16px; bottom: 16px; height: 58px; align-items: center; display: flex; gap: 6px">
    {"".join(f'<button type="button" aria-label="{a}" class="frame" style="width: 44px; height: 44px; font-size: 17px">{g}</button>' for a,g in (("Back","←"),("Forward","→"),("Step out","⤢")))}
  </div>
  <button type="button" aria-label="How to read the map" style="position: absolute; right: 12px; top: 10px; width: 54px; height: 54px; border: 0">
    <svg width="54" height="54" viewBox="0 0 54 54"><circle cx="27" cy="27" r="22" fill="{PAP}" stroke="{INK}" stroke-width="1"></circle><circle cx="27" cy="27" r="18" fill="none" stroke="{INK}" stroke-width=".5"></circle><path d="M27 6 L31 27 L27 48 L23 27 Z" fill="{INK}"></path><path d="M6 27 L27 23 L48 27 L27 31 Z" fill="none" stroke="{INK}" stroke-width=".8"></path><text x="24" y="5" font-size="6" fill="{INK}">N</text></svg>
  </button>
  <nav aria-label="Languages shown" style="position: absolute; left: 16px; right: 76px; top: 18px; display: flex; justify-content: space-between; border-bottom: .6px solid {INK}; padding-bottom: 4px">
    {"".join(f'<button type="button" class="sc" aria-pressed="{"false" if n=="Latina" else "true"}" style="border: 0; min-height: 36px; padding: 0; {"text-decoration: line-through; color: "+MUT if n=="Latina" else ""}">{n}</button>' for n in ("English","Français","Deutsch","Latina"))}
  </nav>
  '''+ORB)
# 3 word card
F["P03"]=("Word card · lineage, doublets, examples", wholemap()+f'''
  <section class="frame" style="position: absolute; left: 10px; right: 10px; top: 60px; bottom: 10px; padding: 14px 22px; display: flex; flex-direction: column; gap: 10px; overflow: hidden">
    <div style="display: flex; justify-content: center"><span style="width: 46px; border-top: 2px solid {INK}; border-bottom: .6px solid {INK}; height: 2px"></span></div>
    <div style="display: flex; align-items: baseline; gap: 10px">
      <b style="font-family: 'Libre Caslon Display', serif; font-weight: 400; font-size: 34px; flex-grow: 1">hostel</b>
      <button type="button" aria-label="Bookmark" aria-pressed="false" style="border: 0; font-size: 22px; min-width: 44px; min-height: 44px">☆</button>
    </div>
    <p style="margin: -6px 0 0; font-size: 15px"><i style="color: {MUT}">noun</i> · a cheap lodging house</p>
    <p style="margin: -4px 0 0; font-size: 14.5px; line-height: 1.6"><span class="sc" style="color: {MUT}; letter-spacing: .14em">Synonyms</span>&nbsp; {" · ".join(f'<button type="button" style="border: 0; padding: 0; font-size: 14.5px; text-decoration: underline; text-decoration-color: rgba(43,33,25,.4); text-underline-offset: 3px">{w}</button> <span style="font-size: 11px; color: {MUT}">{o}</span>' for w,o in (("inn","Old English"),("lodge","Old French"),("guesthouse","English")))}</p>
    <div class="sc" style="border-top: .6px solid {INK}; padding-top: 10px">Lineage</div>
    {"".join(f'<button type="button" style="border: 0; text-align: left; padding: 2px 0; font-size: 15px; display: flex; gap: 10px"><span style="width: 92px; flex-shrink: 0; padding-top: 2px"><span class="sc" style="color: {MUT}; letter-spacing: .12em">{l}</span><br><span style="font-size: 12px; color: {MUT}">{y}</span></span><span><i>{w}</i> <span style="color: {MUT}">“{g}”</span></span></button>' for l,y,w,g in (("Middle Eng.","c. 1250","hostel","inn"),("Old French","800–1400","hostel","lodging"),("Med. Latin","500–1500","hospitāle","guest house"),("Latin","75 BC–AD 200","hospes","guest, host")))}
    <div class="sc" style="border-top: .6px solid {INK}; padding-top: 10px">Doublets <span style="letter-spacing: 0; text-transform: none; font-style: italic; color: {MUT}">— tap to see the fork</span></div>
    <p style="margin: 0; font-size: 16px"><button type="button" style="border: 0; padding: 0; font-size: 16px; text-decoration: underline; text-underline-offset: 3px">hospital</button> · <button type="button" style="border: 0; padding: 0; font-size: 16px; text-decoration: underline; text-underline-offset: 3px">hotel</button></p>
    <div class="sc" style="border-top: .6px solid {INK}; padding-top: 10px">Examples</div>
    <div style="display: flex; gap: 8px; align-items: flex-start"><p style="margin: 0; font-size: 15px; font-style: italic; flex-grow: 1">They put up for the night at a <b style="font-style: normal">hostel</b> by the river.<br><span class="sc" style="font-style: normal; color: {MUT}; letter-spacing: .12em">Hardy · 1891</span></p><button type="button" aria-label="Bookmark example" style="border: 0; font-size: 18px; min-width: 44px; min-height: 44px">☆</button></div>
  </section>''')
# 4 learn landing
rows=[("English","", "", "8 words", True),("Français","Level 3","continue", "5 words", False),("Deutsch","Level 2","", "12 words", False),("Latina","Level 1","", "3 words", False)]
def lbtn(label, sub, off):
    return f'<button type="button" class="btn" {"disabled" if off else ""} style="flex: 1; min-height: 56px; padding: 6px 10px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; {"opacity: .35" if off else ""}"><span>{label}</span><i style="font-size: 12px; letter-spacing: 0; text-transform: none; color: {MUT}; min-height: 14px">{sub}</i></button>'
F["P04"]=("Learn · landing: Translate and Quiz side by side", f'''
  <div class="frame" style="position: absolute; inset: 10px; padding: 22px 22px; display: flex; flex-direction: column; gap: 4px">
    <header style="display: flex; align-items: center; margin-bottom: 10px"><span class="sc" style="flex-grow: 1">Learn</span></header>
    {"".join(f'<section style="border-top: .6px solid {INK}; padding: 12px 0 14px; display: flex; flex-direction: column; gap: 8px"><div style="display: flex; align-items: baseline; gap: 10px"><span style="font-size: 22px; flex-grow: 1">{n}</span><i style="font-size: 12.5px; color: {MUT}">{lv}</i></div><div style="display: flex; gap: 8px">{"" if en else lbtn("Translate", c, False)}{lbtn("Quiz", q, not q)}</div></section>' for n,lv,c,q,en in rows)}
  </div>''')
# 5 writing
F["P05"]=("Learn · writing", f'''
  <div class="frame" style="position: absolute; left: 10px; right: 10px; top: 10px; bottom: 299px; padding: 10px 20px 12px; display: flex; flex-direction: column; gap: 10px">
    {lhead()}
    <p style="margin: 0; font-size: 19px; line-height: 1.5">{EXC}</p>
    {SRC}
    <div role="textbox" aria-label="Your English" contenteditable="true" style="flex-grow: 1; border-top: .6px solid {INK}; padding-top: 10px; font-size: 17px; line-height: 1.5; font-style: italic; outline: none">{EN}<span style="border-right: 1.5px solid {INK}; margin-left: 1px"></span></div>
    <div style="display: flex; justify-content: flex-end"><button type="button" class="btn dark">Check</button></div>
  </div>
  '''+KB, "fr")
# 6 tapped: inlay between
F["P06"]=("Learn · tap a word: the map opens between the texts", f'''
  <div class="frame" style="position: absolute; inset: 10px; padding: 10px 20px 14px; display: flex; flex-direction: column; gap: 10px">
    {lhead()}
    <p style="margin: 0; font-size: 18px; line-height: 1.5">{EXC.replace('<span class="new">m’endors</span>','<span style="background: '+INK+'; color: '+PAP+'; padding: 0 3px">m’endors</span>')}</p>
    <figure style="margin: 0; position: relative; height: 290px; border: 1px solid {INK}; overflow: hidden; background: #f9f4e8">
      <svg aria-hidden="true" width="348" height="290" viewBox="0 0 348 290">{family(348,290,190,268,1.25,endo=False)}</svg>
      <div style="position: absolute; left: 80px; top: 20px; width: 128px; background: {PAP}; border: 1px solid {INK}; padding: 6px 8px; font-size: 12px; line-height: 1.35"><b style="font-family: 'Libre Caslon Display', serif; font-weight: 400; font-size: 16px">endormir</b><br>to put to sleep<br><i style="color: {MUT}">m’endors: I fall asleep</i></div>
      <button type="button" aria-label="Full screen" style="position: absolute; right: 0; top: 0; width: 44px; height: 44px; border: 0; border-left: 1px solid {INK}; border-bottom: 1px solid {INK}; background: {PAP}; font-size: 16px">⤢</button>
      <button type="button" class="sc" style="position: absolute; left: 0; bottom: 0; border: 0; border-top: 1px solid {INK}; border-right: 1px solid {INK}; background: {PAP}; min-height: 36px; padding: 0 10px; letter-spacing: .14em">I know this</button>
    </figure>
    <div style="border-top: .6px solid {INK}; padding-top: 10px; font-size: 16px; line-height: 1.5; font-style: italic">{EN}</div>
    <div style="margin-top: auto; display: flex; justify-content: flex-end"><button type="button" class="btn dark">Check</button></div>
  </div>''', "fr")
# 7 swap
F["P07"]=("Learn · full screen: the map fills, your page becomes the strip", f'''
  <svg aria-hidden="true" width="390" height="844" viewBox="0 0 390 844" style="position: absolute; left: 0; top: 0">{family(390,844,215,450,1.75,endo=False)}</svg>
  <div style="position: absolute; left: 22px; top: 40px; width: 150px; background: {PAP}; border: 1px solid {INK}; padding: 8px 10px; font-size: 12.5px; line-height: 1.4"><b style="font-family: 'Libre Caslon Display', serif; font-weight: 400; font-size: 18px">endormir</b><br>to put to sleep<br><button type="button" class="sc" style="border: 0; padding: 6px 0 0; letter-spacing: .14em">The description ›</button></div>
  <button type="button" class="frame" style="position: absolute; left: 10px; right: 10px; bottom: 86px; padding: 14px 18px; text-align: left; display: flex; flex-direction: column; gap: 6px"><span class="sc" style="letter-spacing: .18em">Learn · Français</span><span style="font-size: 15px; line-height: 1.45">… je n’avais pas le temps de me dire : « Je <span style="background: {INK}; color: {PAP}; padding: 0 3px">m’endors</span>. »</span><i style="font-size: 14px; line-height: 1.45; border-top: .6px solid {INK}; padding-top: 6px; width: 100%">… I didn’t have time to tell myself “I’m</i></button>
  <div style="position: absolute; left: 16px; bottom: 16px; height: 58px; align-items: center; display: flex; gap: 6px">
    {"".join(f'<button type="button" aria-label="{a}" class="frame" style="width: 44px; height: 44px; font-size: 17px">{g}</button>' for a,g in (("Back","←"),("Forward","→")))}
  </div>
  '''+ORB, "fr")
# 8 checked
F["P08"]=("Learn · checked", f'''
  <div class="frame" style="position: absolute; inset: 10px; padding: 10px 20px 16px; display: flex; flex-direction: column; gap: 12px">
    {lhead()}
    <p style="margin: 0; font-size: 18px; line-height: 1.5">Longtemps, je me suis couché de bonne heure. Parfois, à peine ma <span style="border-bottom: 2px solid {BLUE}">bougie</span> <span style="border-bottom: 2px solid {BLUE}">éteinte</span>, mes yeux se fermaient si vite que je n’avais pas le temps de me dire : « Je <span style="border-bottom: 2px solid {RED}; background: rgba(164,80,58,.14)">m’endors</span>. »</p>
    <div style="border-top: .6px solid {INK}; padding-top: 10px; font-size: 16px; line-height: 1.5; font-style: italic">For a long time I went to bed early. Sometimes, my <span style="border-bottom: 2px solid {BLUE}">candle</span> barely <span style="border-bottom: 2px solid {BLUE}">out</span>, my eyes closed so quickly that I didn’t have time to tell myself “I’m going under.”</div>
    <div style="border-top: .6px solid {INK}; padding-top: 10px; display: flex; flex-direction: column; gap: 6px"><span class="sc">Translation · 9 of 10</span><p style="margin: 0; font-size: 15px; line-height: 1.5">For a long time I used to go to bed early. Sometimes, when I had put out my candle, my eyes would close so quickly that I had not even time to say “I’m going to sleep.” <span style="color: {MUT}">— Scott Moncrieff, 1922</span></p></div>
    <div style="margin-top: auto; display: flex; align-items: center; gap: 8px"><span style="flex-grow: 1; font-size: 13px; color: {MUT}"><span style="border-bottom: 2px solid {BLUE}">blue</span> you translated it · <span style="border-bottom: 2px solid {RED}">red</span> you missed it; you’ll see it again</span><button type="button" class="btn dark">Next</button></div>
  </div>''', "fr")
# 9 quiz
F["P09"]=("Learn · quiz (French): your missed words, in their sentence", f'''
  <div class="frame" style="position: absolute; inset: 10px; padding: 10px 20px 16px; display: flex; flex-direction: column; gap: 14px">
    <header style="display: flex; align-items: center"><span class="sc" style="flex-grow: 1">Français · Quiz · 2 of 5</span><button type="button" aria-label="Close" style="border: 0; font-size: 20px; min-width: 44px; min-height: 44px">×</button></header>
    <b style="font-family: 'Libre Caslon Display', serif; font-weight: 400; font-size: 38px; margin-top: 18px">endormir</b>
    <p style="margin: 0; font-size: 17px; line-height: 1.5; font-style: italic; color: {MUT}">« Je <b style="font-style: normal; color: {INK}">m’endors</b>. » — Proust</p>
    <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 10px">
      {"".join(f'<button type="button" style="border: 1px solid {INK}; text-align: left; font-size: 16px; padding: 10px 14px; min-height: 48px">{c}</button>' for c in ("to wake up","to put to sleep","to dream","to lie down"))}
    </div>
  </div>''', "fr")
# 10 search
F["P10"]=("Search · words in all four languages", f'''
  <div class="frame" style="position: absolute; inset: 10px; padding: 16px 20px; display: flex; flex-direction: column; gap: 10px">
    <header style="display: flex; align-items: center"><span class="sc" style="flex-grow: 1">Search the index</span></header>
    <label style="display: flex; border-bottom: 1.5px solid {INK}; padding: 6px 0"><span style="position: absolute; width: 1px; height: 1px; overflow: hidden">Word</span><input type="search" value="endors" style="flex-grow: 1; font-family: inherit; font-size: 24px; border: 0; background: transparent; color: {INK}; outline: none"></label>
    <p class="sc" style="margin: 4px 0 0; color: {MUT}">3 results</p>
    {"".join(f'<button type="button" style="border: 0; border-top: .6px solid {INK}; text-align: left; padding: 12px 0; min-height: 56px"><span style="font-size: 20px">{w}</span> <span class="sc" style="color: {MUT}; letter-spacing: .14em">{l}</span><br><i style="font-size: 13.5px; color: {MUT}">{g}</i></button>' for w,l,g in (("endormir","Français","to put to sleep · endors is a form of it"),("endorse","English","to sign the back of; to approve"),("endossare","Latin (Med.)","to put on the back")))}
  </div>''')
# 11 saved
F["P11"]=("Saved · words, excerpts, settings at the foot", f'''
  <div class="frame" style="position: absolute; inset: 10px; padding: 16px 20px; display: flex; flex-direction: column; gap: 8px; overflow: hidden">
    <header style="display: flex; align-items: center"><span class="sc" style="flex-grow: 1">Saved</span></header>
    <div class="sc" style="margin-top: 6px">Words</div>
    {"".join(f'<div style="display: flex; align-items: center; border-top: .6px solid {INK}; min-height: 48px"><button type="button" style="border: 0; text-align: left; flex-grow: 1; padding: 6px 0"><span style="font-size: 17px">{w}</span> <span class="sc" style="color: {MUT}; letter-spacing: .12em">{l}</span>{" <span style=\"color: "+RED+"; font-size: 13px\">· keeps coming back</span>" if m else ""}</button><button type="button" aria-label="{a}" style="border: 0; font-size: {"17px" if a=="Remove bookmark" else "12px"}; min-width: 44px; min-height: 44px; color: {MUT}">{g}</button></div>' for w,l,m,a,g in (("endormir","fr",1,"Remove bookmark","★"),("éteindre","fr",0,"Remove bookmark","★"),("hostel","en",0,"Remove bookmark","★"),("Weile","de",0,"Undo I know this","undo")))}
    <div class="sc" style="margin-top: 12px">Excerpts</div>
    <button type="button" style="border: 0; border-top: .6px solid {INK}; text-align: left; padding: 8px 0; font-size: 15px; font-style: italic">“Longtemps, je me suis couché de bonne heure…” <span class="sc" style="font-style: normal; color: {MUT}; letter-spacing: .12em">Proust</span></button>
    <details open style="margin-top: auto; border-top: 1.5px solid {INK}; padding-top: 8px">
      <summary class="sc" style="min-height: 36px; cursor: pointer">Settings</summary>
      <div style="display: flex; flex-direction: column; gap: 4px; font-size: 15px">
        <div style="display: flex; justify-content: space-between; min-height: 40px; align-items: center"><span>Look</span><i style="color: {MUT}">Priestley ›</i></div>
        <div role="radiogroup" aria-label="Slang and new words" style="display: flex; align-items: center; min-height: 40px; gap: 4px"><span style="flex-grow: 1">Slang and new words</span><button type="button" role="radio" aria-checked="true" style="border: 0; min-height: 40px; padding: 0 6px; font-size: 15px"><span style="font-size: 17px">☞</span> <i>hidden</i></button><button type="button" role="radio" aria-checked="false" style="border: 0; min-height: 40px; padding: 0 6px 0 22px; font-size: 15px; color: {MUT}"><i>shown</i></button></div>
        <div style="display: flex; justify-content: space-between; min-height: 40px; align-items: center"><span>Reading speed</span><i style="color: {MUT}">1×</i></div>
        <div style="display: flex; gap: 8px; margin-top: 4px"><button type="button" class="btn" style="padding: 0 10px; flex: 1">Reset a level</button><button type="button" class="btn" style="padding: 0 10px; flex: 1">Check for updates</button></div>
      </div>
    </details>
  </div>''')

for k,(t,b,*lg) in F.items():
    open(OUT+k+".dc.html","w").write(page(t,b,lg[0] if lg else "en"))
# canvas
c=json.load(open(OUT+"canvas.json"))
old=list(c["boards"].keys())
c["boards"]={}; c["order"]=[]
for i,(k,(t,*_)) in enumerate(F.items()):
    row,col=divmod(i,4)
    c["boards"][k+".dc.html"]={"x":col*470,"y":row*1100,"w":390,"h":844,"title":f"{i+1} · {t}"}
    c["order"].append(k+".dc.html")
c["title"]="Carta · Priestley · four divisions"
c["notes"]={"t1":{"x":0,"y":-300,"text":"Carta in Priestley: Explore · Learn · Search · Saved","kind":"title1","maxW":1800},
 "s1":{"x":0,"y":-190,"w":520,"text":"The orb opens the four divisions. Learn, Search and Saved open the map the same way: tap full screen and the map fills, the page becomes a strip at the bottom; tap the strip to come back. Each division reopens where you left it. Full list of controls: PLAN-DIVISIONS.md.","size":"s"}}
json.dump(c,open(OUT+"canvas.json","w"),ensure_ascii=False)
print(old)
