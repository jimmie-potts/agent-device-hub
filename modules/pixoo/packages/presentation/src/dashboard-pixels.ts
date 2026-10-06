import {shortLabel,type DashboardLayout,type DashboardRow} from './agent-dashboard.js';
import {drawBitmap,drawLargeText,drawText,type Color} from './pixel-font.js';
// One session per picture: a state tile, provider and activity, attention, a two-line label, details and a summary strip.
// Pixel positions are documented in docs/agent-monitoring.md and openspec change gh-98-one-session-monitor.
export const DASHBOARD_FRAME_MS=500;
const LINE=10,SEPARATORS=' -_/.';
const black:Color=[0,0,0],white:Color=[210,210,210],dimLabel:Color=[110,110,110],divider:Color=[35,35,35],dot:Color=[70,70,70];
const amber:Color=[235,175,50],cyan:Color=[70,170,220],green:Color=[60,200,90],red:Color=[225,60,50],grey:Color=[120,120,120],purple:Color=[170,110,230];
const dim=(color:Color):Color=>[Math.floor(color[0]*0.35),Math.floor(color[1]*0.35),Math.floor(color[2]*0.35)];
const repeat=(row:string,times:number)=>Array.from({length:times},()=>row);
// Each activity has a colour, a 7x7 black icon on the tile and a word.
const activities:Record<DashboardRow['activity'],{color:Color;word:string;icon:readonly string[]}>={
 active:{color:green,word:'ACTIVE',icon:['..#....','..##...','..###..','..####.','..###..','..##...','..#....']},
 idle:{color:[80,110,240],word:'IDLE',icon:repeat('.##.##.',7)},
 interrupted:{color:red,word:'STOPPED',icon:['#.....#','.#...#.','..#.#..','...#...','..#.#..','.#...#.','#.....#']},
 ended:{color:grey,word:'ENDED',icon:['.......',...repeat('.#####.',5),'.......']},
 unknown:{color:purple,word:'UNKNOWN',icon:['..###..','.#...#.','.....#.','....#..','...#...','.......','...#...']},
};
const providers:Record<string,{color:Color;mark:readonly string[]}>={
 codex:{color:cyan,mark:['#######','#.....#','#.....#','#..#..#','#.....#','#.....#','#######']},
 claude:{color:[235,120,40],mark:['...#...','.#.#.#.','..###..','#######','..###..','.#.#.#.','...#...']},
};
const attentionWords:Record<Exclude<DashboardRow['attention'],'none'>,string>={approval:'APPROVAL',input:'INPUT',question:'QUESTION'};
// 5x5 health marks. Source: filled current, ring stale, cross unavailable.
// Collector: filled running, bars quiesced, cross faulted, hollow square closed, question mark unknown.
const filled=['.###.','#####','#####','#####','.###.'],cross=['#...#','.#.#.','..#..','.#.#.','#...#'];
const sourceMarks:Record<DashboardLayout['connection'],{color:Color;mark:readonly string[]}>={
 current:{color:green,mark:filled},stale:{color:amber,mark:['.###.','#...#','#...#','#...#','.###.']},unavailable:{color:red,mark:cross},
};
const collectorMarks:Record<DashboardLayout['collector'],{color:Color;mark:readonly string[]}>={
 running:{color:green,mark:filled},quiesced:{color:amber,mark:repeat('##.##',5)},faulted:{color:red,mark:cross},
 closed:{color:grey,mark:['#####','#...#','#...#','#...#','#####']},unknown:{color:purple,mark:['.###.','#...#','..##.','.....','..#..']},
};
/** Split a short identifier into lines of ten: after the last separator that leaves a second line that fits, otherwise at ten. */
export function identifierLines(identifier:string):string[] {
 const chars=Array.from(identifier);
 if(chars.length<=LINE)return [identifier];
 let cut=LINE;
 for(let i=LINE;i>0;i--)if(SEPARATORS.includes(chars[i-1]!)&&chars.length-i<=LINE){cut=i;break;}
 return [chars.slice(0,cut).join('').trimEnd(),chars.slice(cut).join('').trimStart()].filter(Boolean);
}
function frame(layout:DashboardLayout,pulse:boolean):Uint8Array {
 const rgb=new Uint8Array(64*64*3);
 const rect=(x:number,y:number,w:number,h:number,color:Color)=>{for(let j=y;j<y+h;j++)for(let i=x;i<x+w;i++)rgb.set(color,(j*64+i)*3);};
 const row=layout.rows[0];
 if(row){
  const activity=activities[row.activity],asks=row.attention!=='none',shade=(color:Color)=>pulse&&asks?dim(color):color;
  rect(1,1,20,20,shade(activity.color));drawBitmap(rgb,activity.icon,7,7,black);
  const provider=providers[row.identity.provider]??providers.codex!;
  drawBitmap(rgb,provider.mark,24,2,provider.color);drawText(rgb,activity.word,33,3,activity.color);
  if(row.attention!=='none'){rect(24,12,39,9,shade(amber));drawText(rgb,attentionWords[row.attention],26,14,black);}
  else if(row.noticeIds.length)drawText(rgb,'TURN END',24,14,amber);
  const titleY=row.project?27:26,detailsY=row.project?21:45;
  identifierLines(row.shortLabel).forEach((line,index)=>drawLargeText(rgb,line,2,titleY+index*9,row.uncertain?dimLabel:white));
  if(row.project)drawText(rgb,shortLabel(row.project,15),2,45,cyan);
  if(row.activeChildren||row.childrenUncertain)drawText(rgb,`+${Math.min(row.activeChildren,9)}${row.activeChildren>9?'+':''}${row.childrenUncertain?'?':''} SUB`,2,detailsY,cyan);
  if(row.uncertain)drawText(rgb,'UNSURE',40,detailsY,purple);
 }else{drawLargeText(rgb,'NO',26,18,grey);drawLargeText(rgb,'SESSIONS',8,27,grey);}
 rect(0,53,64,1,divider);
 const count=String(layout.matched);drawText(rgb,count,1,56,white);
 if(layout.attentionTotal)drawText(rgb,`!${layout.attentionTotal}`,1+(count.length+1)*4,56,amber);
 if(layout.pages<=8){const x=26+Math.floor((24-(layout.pages*3-1))/2);for(let page=0;page<layout.pages;page++)rect(x+page*3,57,2,2,page===layout.page?white:dot);}
 else{const position=`${layout.page+1}/${layout.pages}`;drawText(rgb,position,26+Math.floor((24-(position.length*4-1))/2),56,white);}
 const source=sourceMarks[layout.connection],collector=collectorMarks[layout.collector];
 drawBitmap(rgb,source.mark,52,56,source.color);drawBitmap(rgb,collector.mark,58,56,collector.color);
 return rgb;
}
/** Complete RGB frames played at DASHBOARD_FRAME_MS: two when the shown session needs attention, so its tile and chip pulse, otherwise one. */
export function renderDashboard(layout:DashboardLayout):Uint8Array[] {
 const asks=layout.rows[0]!==undefined&&layout.rows[0].attention!=='none';
 return asks?[frame(layout,false),frame(layout,true)]:[frame(layout,false)];
}
