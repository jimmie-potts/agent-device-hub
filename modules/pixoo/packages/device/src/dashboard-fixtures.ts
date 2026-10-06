import type {DashboardEvent} from './dashboard-qualification.js';

// Original 3x5 bitmap alphabet for synthetic fixtures only, not device fonts.
const glyphs:Record<string,string>={
  '0':'111101101101111','1':'010110010010111','2':'111001111100111',
  '3':'111001111001111','4':'101101111001001','5':'111100111001111',
  '6':'111100111101111','7':'111001010010010','8':'111101111101111',
  '9':'111101111001111',A:'010101111101101',B:'110101110101110',
  C:'111100100100111',D:'110101101101110',E:'111100110100111',
  F:'111100110100100',S:'111100111001111',P:'110101110100100',
  '!':'010010010000010','+':'000010111010000','/':'001001010100100',
};
type Color=readonly [number,number,number];
const white:Color=[160,160,160],cyan:Color=[0,100,160],amber:Color=[180,90,0],green:Color=[0,140,40],grey:Color=[30,30,30];
const dim=(color:Color):Color=>[Math.floor(color[0]*0.35),Math.floor(color[1]*0.35),Math.floor(color[2]*0.35)];
interface Card {page:number;pages:number;attention:number;label?:string;state?:number;pulse?:boolean;children?:number}
// A simplified one-session card: state tile, provider symbol, attention chip, a doubled-size label and a summary strip.
function frame({page,pages,attention,label,state=0,pulse=false,children=0}:Card) {
  const rgb=new Uint8Array(12288);
  const pixel=(x:number,y:number,color:Color)=>{if(x>=0&&x<64&&y>=0&&y<64)rgb.set(color,(y*64+x)*3);};
  const rect=(x:number,y:number,w:number,h:number,color:Color)=>{for(let dy=0;dy<h;dy++)for(let dx=0;dx<w;dx++)pixel(x+dx,y+dy,color);};
  const text=(value:string,x:number,y:number,color:Color,scale=1)=>{
    for(const [index,char] of [...value].entries()) {
      const glyph=glyphs[char]; if(!glyph)continue;
      for(let row=0;row<5;row++)for(let column=0;column<3;column++)if(glyph[row*3+column]==='1')rect(x+(index*4+column)*scale,y+row*scale,scale,scale,color);
    }
  };
  if(label) {
    const asks=attention>0&&state===0,tile=asks&&pulse?dim(green):green;
    rect(1,1,20,20,state===0?tile:amber);
    // Filled square or bar shapes distinguish the state without colour.
    if(state===0)rect(8,7,6,8,[0,0,0]);else rect(10,5,2,12,[0,0,0]);
    for(let dy=0;dy<7;dy++)for(let dx=0;dx<7;dx++)if(page%2===0||Math.abs(dx-3)+Math.abs(dy-3)<=3)pixel(24+dx,2+dy,cyan);
    if(asks){rect(24,12,39,9,pulse?dim(amber):amber);text('!',26,14,[0,0,0]);}
    text(label,2,26,white,2);
    if(children)text(`+${children}`,2,45,cyan);
  }
  rect(0,53,64,1,grey);
  text(`S${pages}`,1,56,white);if(attention)text(`!${attention}`,13,56,amber);
  for(let dot=0;dot<pages;dot++)rect(30+dot*3,57,2,2,dot===page-1?white:grey);
  rect(58,56,5,5,green);
  return rgb;
}
/** Timed synthetic pictures; `pulse` is the second frame of a two-frame picture, sent in the same upload. */
export function dashboardCases():DashboardEvent[] {
  const card=(atMs:number,id:string,value:Card)=>({atMs,id,rgb:frame(value),...(value.attention&&value.label&&!value.state?{pulse:frame({...value,pulse:true})}:{})});
  return [
    card(0,'attention-pulse',{page:1,pages:3,attention:2,label:'A1',children:2}),
    card(250,'burst-1',{page:1,pages:3,attention:0,label:'A2',state:1}),
    card(500,'burst-2',{page:1,pages:3,attention:0,label:'A3',state:1,children:1}),
    card(750,'burst-latest',{page:1,pages:3,attention:0,label:'A4',state:1,children:3}),
    card(4000,'session-cleared',{page:1,pages:1,attention:0}),
    card(7000,'next-page',{page:2,pages:3,attention:0,label:'B1',state:1}),
    card(10000,'return-page-1',{page:1,pages:3,attention:1,label:'A5'}),
    card(12500,'final-clear',{page:1,pages:1,attention:0}),
  ];
}
export function dashboardPreview(events:readonly DashboardEvent[]) {
  // Only fixed synthetic data enters HTML; no operator metadata or device target.
  const data=JSON.stringify(events.map(event=>({id:event.id,atMs:event.atMs,frames:[event.rgb,...(event.pulse?[event.pulse]:[])].map(rgb=>Array.from(rgb))}))).replaceAll('<','\\u003c');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Dashboard payload previews</title>
<style>body{background:#171b23;color:#eee;font:16px system-ui;margin:24px}main{display:flex;flex-wrap:wrap;gap:24px}canvas{width:256px;height:256px;image-rendering:pixelated;border:1px solid #667}figure{margin:0}figcaption{margin:8px 0;max-width:256px}</style>
<h1>Dashboard payload previews</h1><p>Exact 64×64 RGB payloads, enlarged 4×. Physical output is unverified.</p><p>One session per picture: state tile, provider symbol, attention chip, doubled label and subagents, then a summary strip with sessions, attention, page dots and health. A two-frame picture pulses its tile and chip at 500 ms.</p><main></main>
<script>const cases=${data};for(const item of cases)item.frames.forEach((rgb,frame)=>{const figure=document.createElement('figure'),canvas=document.createElement('canvas'),caption=document.createElement('figcaption');canvas.width=canvas.height=64;canvas.dataset.case=item.id;canvas.dataset.frame=frame;const ctx=canvas.getContext('2d'),pixels=ctx.createImageData(64,64);for(let i=0;i<4096;i++){pixels.data.set(rgb.slice(i*3,i*3+3),i*4);pixels.data[i*4+3]=255}ctx.putImageData(pixels,0,0);caption.textContent=item.id+' · event '+item.atMs+' ms'+(item.frames.length>1?' · frame '+(frame+1)+' of '+item.frames.length:'');figure.append(canvas,caption);document.querySelector('main').append(figure)});</script></html>`;
}
