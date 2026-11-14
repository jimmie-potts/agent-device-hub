import type {ApartmentArt,ApartmentFixture,ApartmentFurniture,ApartmentModel,ApartmentPoint,ApartmentRoom,ApartmentVector,ApartmentWall} from '../../src/apartment-model.ts';

export type Vec = ApartmentVector;
const hex = (rgb:number):Vec => [(rgb>>16&255)/255,(rgb>>8&255)/255,(rgb&255)/255];
const tones = {
  plaster:hex(0xede2d0), cap:hex(0xf6ead9), oak:hex(0xad7954), trim:hex(0x8e6650), slate:hex(0x454750),
  green:hex(0x527a71), moss:hex(0x78948a), terracotta:hex(0xac6751), clay:hex(0xdbab83),
  cream:hex(0xf7efda), textile:hex(0xd4bc9a), rug:hex(0x9b8778), wood:hex(0x835d45), brass:hex(0xb99d69),
};
const floorColors = [hex(0xc6a681),hex(0xb5a28b),hex(0x9d9b88),hex(0xcead91)];
const EPSILON = 1e-6;
// 120,000 vertices × 48 bytes. Account for both wall heights before allocating GL buffers.
const MAX_VERTICES = 120_000;
export const APARTMENT_STRIDE = 48;
export type SceneMesh = {vertices:Float32Array;count:number};
export type SceneBounds = {center:Vec;radius:number};
export type SceneWall = {rooms:readonly string[];start:ApartmentPoint;direction:ApartmentPoint;middle:ApartmentPoint;full:SceneMesh;low:SceneMesh};
export type ApartmentScene = {
  bounds:SceneBounds; rooms:Map<string,{mesh:SceneMesh;bounds:SceneBounds;floorY:number}>;
  walls:SceneWall[]; fixtures:{item:ApartmentFixture;mesh:SceneMesh;point:Vec}[];
  art:{item:ApartmentArt;mesh:SceneMesh;print:SceneMesh}[]; vertices:number;
};

type Quad = [Vec,Vec,Vec,Vec];
type Triangle = [ApartmentPoint,ApartmentPoint,ApartmentPoint];
const up:Vec = [0,1,0];
const cross = (a:ApartmentPoint,b:ApartmentPoint,c:ApartmentPoint):number => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const polygonArea = (points:readonly ApartmentPoint[]):number => points.reduce((n,a,i) => {
  const b=points[(i+1)%points.length];return b===undefined?n:n+a[0]*b[1]-b[0]*a[1];
},0);

/** The contract accepts simple concave footprints. Clip convex ears and skip collinear vertices. */
function triangulate(footprint:readonly ApartmentPoint[]):Triangle[] {
  const points=polygonArea(footprint)>=0?[...footprint]:[...footprint].reverse(),triangles:Triangle[]=[];
  while(points.length>=3){
    const ear=points.findIndex((b,i)=>{
      const a=points[(i+points.length-1)%points.length],c=points[(i+1)%points.length];
      if(a===undefined||c===undefined)return false;
      const turn=cross(a,b,c);
      return Math.abs(turn)<EPSILON||turn>0&&!points.some(p=>p!==a&&p!==b&&p!==c&&cross(a,b,p)>=-EPSILON&&cross(b,c,p)>=-EPSILON&&cross(c,a,p)>=-EPSILON);
    });
    if(ear<0)throw new Error('apartment-footprint');
    const a=points[(ear+points.length-1)%points.length],b=points[ear],c=points[(ear+1)%points.length];
    if(a!==undefined&&b!==undefined&&c!==undefined&&cross(a,b,c)>EPSILON)triangles.push([a,b,c]);
    points.splice(ear,1);
  }
  return triangles;
}

function builder(budget:{vertices:number},transform=(point:Vec):Vec=>point,rotate=(normal:Vec):Vec=>normal) {
  const values:number[]=[];
  const vertex=(p:Vec,n:Vec,color:Vec,u:number,v:number,finish:number):void=>{
    if(++budget.vertices>MAX_VERTICES)throw new Error('apartment-scene-limit');
    values.push(...p,...n,...color,u,v,finish);
  };
  const triangle=(a:Vec,b:Vec,c:Vec,n:Vec,color:Vec,finish=0):void => {
    for(const p of [a,b,c])vertex(transform(p),rotate(n),color,0,0,finish);
  };
  const quad=([a,b,c,d]:Quad,n:Vec,color:Vec,finish=0):void=>{
    const normal=rotate(n);
    const textured=(p:Vec,u:number,v:number):void=>{vertex(transform(p),normal,color,u,v,finish);};
    textured(a,0,0);textured(b,1,0);textured(c,1,1);textured(a,0,0);textured(c,1,1);textured(d,0,1);
  };
  const box=([x,y,z]:Vec,[w,h,d]:Vec,color:Vec,top=color):void=>{
    const a=x-w/2,b=x+w/2,f=z-d/2,g=z+d/2,l=y-h/2,u=y+h/2;
    quad([[a,u,g],[b,u,g],[b,u,f],[a,u,f]],up,top);
    quad([[a,l,f],[b,l,f],[b,l,g],[a,l,g]],[0,-1,0],color);
    quad([[a,l,g],[b,l,g],[b,u,g],[a,u,g]],[0,0,1],color);
    quad([[b,l,f],[a,l,f],[a,u,f],[b,u,f]],[0,0,-1],color);
    quad([[b,l,g],[b,l,f],[b,u,f],[b,u,g]],[1,0,0],color);
    quad([[a,l,f],[a,l,g],[a,u,g],[a,u,f]],[-1,0,0],color);
  };
  const round=([x,y,z]:Vec,[w,h,d]:Vec,color:Vec,top=color,upper=1):void=>{
    const base=y-h/2,cap=y+h/2;
    for(let i=0;i<12;i++){
      const a=i*Math.PI/6,b=(i+1)*Math.PI/6;
      const ca=Math.cos(a),sa=Math.sin(a),cb=Math.cos(b),sb=Math.sin(b);
      const p:Vec=[x+ca*w/2,base,z+sa*d/2],q:Vec=[x+cb*w/2,base,z+sb*d/2];
      const r:Vec=[x+cb*w/2*upper,cap,z+sb*d/2*upper],s:Vec=[x+ca*w/2*upper,cap,z+sa*d/2*upper];
      const side:Vec=[Math.cos((a+b)/2),0,Math.sin((a+b)/2)];
      quad([p,q,r,s],side,color);triangle([x,cap,z],r,s,up,top);triangle([x,base,z],p,q,[0,-1,0],color);
    }
  };
  return {triangle,quad,box,round,mesh:():SceneMesh=>({vertices:new Float32Array(values),count:values.length/(APARTMENT_STRIDE/4)})};
}

type Builder=ReturnType<typeof builder>;
const atYaw=([x,y,z]:Vec,yaw:number):Vec=>[x*Math.cos(yaw)+z*Math.sin(yaw),y,z*Math.cos(yaw)-x*Math.sin(yaw)];
const atOffset=([x,y,z]:Vec,[a,b,c]:Vec):Vec=>[x+a,y+b,z+c];

function furniture(mesh:Builder,item:ApartmentFurniture):void {
  const part=(x:number,y:number,z:number,w:number,h:number,d:number,color:Vec,top=color):void=>{
    const [width,height,depth]=item.size;
    const position=atOffset(atYaw([x*width,y*height,z*depth],item.yaw),item.position);
    const shape=builderTransform(mesh,position,item.yaw);
    shape([w*width,h*height,d*depth],color,top);
  };
  const legs=(level:number,insetZ=.36):void=>{
    for(const x of [-.37,.37])for(const z of [-insetZ,insetZ])part(x,-.5+level/2,z,.09,level,.11,tones.wood);
  };
  const upholstered=(single:boolean):void=>{
    const fabric=single?tones.terracotta:tones.green,cushion=single?tones.clay:tones.moss;
    legs(.17);
    part(0,-.27,0,.98,.24,.94,fabric);
    part(0,.14,-.36,.94,.72,.2,fabric,cushion);
    for(const x of [-.44,.44])part(x,-.06,.04,.12,.42,.86,fabric,cushion);
    for(const x of single?[0]:[-.24,0,.24])part(x,-.08,.08,single?.74:.225,.14,.69,cushion);
    if(!single)for(const x of [-.27,.27])part(x,.13,-.235,.20,.23,.12,tones.cream);
  };
  switch(item.form){
    case 'sofa': upholstered(false);break;
    case 'chair': upholstered(true);break;
    case 'table':
    case 'desk': {
      const desk=item.form==='desk';legs(.82,.38);
      part(0,.41,0,.99,.16,.99,tones.oak,tones.clay);
      if(desk)part(.25,.23,0,.36,.22,.79,tones.wood);
      break;
    }
    case 'bed':
      legs(.13);
      part(0,-.28,0,.99,.24,.98,tones.wood,tones.oak);
      part(0,-.02,-.445,.99,.96,.10,tones.wood,tones.oak);
      part(0,-.085,.02,.96,.22,.9,tones.cream);
      part(0,.035,.21,.965,.095,.55,tones.green,tones.moss);
      for(const x of [-.24,.24])part(x,.104,-.29,.40,.13,.26,tones.cream);
      break;
    case 'cabinet':
    case 'shelf': {
      const open=item.form==='shelf';
      part(0,-.028,-.445,.98,.94,.11,tones.wood);
      for(const x of [-.465,.465])part(x,0,0,.07,1,.97,tones.oak);
      for(const y of [-.455,-.14,.172,.455])part(0,y,0,.93,.08,.93,tones.wood,tones.oak);
      if(open){
        for(const y of [-.31,.008,.32])for(const x of [-.35,-.25,-.15])part(x,y,-.27,.075,.20,.24,x===-.25?tones.green:tones.cream);
      }else{
        for(const x of [-.233,.233]){
          part(x,0,.377,.448,.83,.14,tones.oak,tones.clay);
          part(x*.31,.04,.475,.075,.15,.044,tones.brass);
        }
      }
      break;
    }
    case 'rug':
      part(0,-.15,0,1,.67,1,tones.rug);
      part(0,.155,0,.96,.44,.92,tones.cream);
      part(0,.245,0,.90,.45,.83,tones.textile);
      for(const x of [-.31,.31])part(x,.46,0,.013,.05,.74,tones.rug);
      break;
    case 'other':
      part(0,0,0,.98,.96,.98,tones.slate,tones.moss);break;
    default: {const exhaustive:never=item.form;return exhaustive;}
  }
}

/** Emit a local box into the room's static mesh without another buffer. */
function builderTransform(mesh:Builder,position:Vec,yaw:number) {
  return ([w,h,d]:Vec,color:Vec,top:Vec):void=>{
    const a=-w/2,b=w/2,f=-d/2,g=d/2,l=-h/2,u=h/2;
    const face=([p,q,r,s]:Quad,n:Vec,c:Vec):void=>{
      const point=(v:Vec):Vec=>atOffset(atYaw(v,yaw),position);
      mesh.quad([point(p),point(q),point(r),point(s)],atYaw(n,yaw),c);
    };
    face([[a,u,g],[b,u,g],[b,u,f],[a,u,f]],up,top);
    face([[a,l,f],[b,l,f],[b,l,g],[a,l,g]],[0,-1,0],color);
    face([[a,l,g],[b,l,g],[b,u,g],[a,u,g]],[0,0,1],color);
    face([[b,l,f],[a,l,f],[a,u,f],[b,u,f]],[0,0,-1],color);
    face([[b,l,g],[b,l,f],[b,u,f],[b,u,g]],[1,0,0],color);
    face([[a,l,f],[a,l,g],[a,u,g],[a,u,f]],[-1,0,0],color);
  };
}

function wallClearance(item:ApartmentArt|ApartmentFixture,room:ApartmentRoom):Vec {
  if(item.kind==='fixture'&&item.form!=='wall')return item.position;
  const [x,,z]=item.position;
  const facing=atYaw([0,0,1],item.yaw);
  let shift=0;
  for(const wall of room.walls){
    const dx=wall.end[0]-wall.start[0],dz=wall.end[1]-wall.start[1],length=Math.hypot(dx,dz);
    const along=((x-wall.start[0])*dx+(z-wall.start[1])*dz)/length;
    const ortho=((x-wall.start[0])*-dz+(z-wall.start[1])*dx)/length;
    const view=(-dz*facing[0]+dx*facing[2])/length;
    if(along>=-.02&&along<=length+.02&&Math.abs(ortho)<wall.thickness/2+.025&&Math.abs(view)>.8)
      shift=Math.max(shift,(wall.thickness/2+item.size[2]/2+.012-ortho*Math.sign(view))/Math.abs(view));
  }
  return atOffset(item.position,[shift*facing[0],0,shift*facing[2]]);
}

function fixture(mesh:Builder,item:ApartmentFixture):void {
  const [w,h,d]=item.size;
  switch(item.form){
    case 'floor':
    case 'table':
      mesh.round([0,-.46*h,0],[w*.65,h*.08,d*.65],tones.brass);
      mesh.round([0,-.11*h,0],[w*.1,h*.65,d*.1],tones.brass);
      mesh.round([0,.30*h,0],[w,h*.4,d],tones.cream,tones.textile,.62);
      break;
    case 'wall':
      mesh.round([0,0,-.37*d],[w*.62,h*.91,d*.2],tones.brass);
      mesh.box([0,0,-.14*d],[w*.18,h*.14,d*.5],tones.brass);
      mesh.round([0,.04*h,.21*d],[w,h*.72,d*.54],tones.cream,tones.textile,.69);
      break;
    case 'ceiling':
      mesh.round([0,.33*h,0],[w*.46,h*.24,d*.46],tones.brass);
      mesh.round([0,-.13*h,0],[w,h*.68,d],tones.cream,tones.textile,1.19);
      break;
    case 'strip':mesh.box([0,0,0],[w,h,d],tones.cream,tones.brass);break;
    case 'other':mesh.round([0,0,0],[w,h,d],tones.cream,tones.textile,.82);break;
    default:{const exhaustive:never=item.form;return exhaustive;}
  }
}

function artwork(frame:Builder,print:Builder,[w,h,d]:Vec):void {
  frame.box([0,0,0],[w,h,d],tones.wood,tones.oak);
  frame.box([0,0,d*.515],[w*.92,h*.92,.003],tones.cream);
  const x=w*.39,y=h*.39,z=d*.515+.003;
  frame.quad([[-x,-y,z],[x,-y,z],[x,y,z],[-x,y,z]],[0,0,1],tones.textile);
  frame.quad([[-x*.60,-y*.60,z+.001],[x*.60,-y*.60,z+.001],[x*.60,y*.60,z+.001],[-x*.60,y*.60,z+.001]],[0,0,1],tones.rug);
  print.quad([[-x,-y,z+.003],[x,-y,z+.003],[x,y,z+.003],[-x,y,z+.003]],[0,0,1],tones.cream);
}

type WallSpan={room:string;from:number;to:number;bottom:number;top:number;thickness:number;openings:{from:number;to:number;bottom:number;top:number;kind:ApartmentWall['openings'][number]['kind']}[]};
type WallLine={start:ApartmentPoint;direction:ApartmentPoint;spans:WallSpan[]};
const along=(start:ApartmentPoint,d:ApartmentPoint,p:ApartmentPoint):number=>(p[0]-start[0])*d[0]+(p[1]-start[1])*d[1];
function wallLines(rooms:readonly ApartmentRoom[]):WallLine[] {
  const lines:WallLine[]=[];
  for(const room of rooms)for(const w of room.walls){
    const dx=w.end[0]-w.start[0],dz=w.end[1]-w.start[1],len=Math.hypot(dx,dz);
    const existing=lines.find(line=>Math.abs(cross(line.start,[line.start[0]+line.direction[0],line.start[1]+line.direction[1]],w.start))<EPSILON
      && Math.abs(cross(line.start,[line.start[0]+line.direction[0],line.start[1]+line.direction[1]],w.end))<EPSILON);
    const line=existing??{start:w.start,direction:[dx/len,dz/len],spans:[]} satisfies WallLine;
    if(existing===undefined)lines.push(line);
    const a=along(line.start,line.direction,w.start),b=along(line.start,line.direction,w.end),forward=a<b;
    line.spans.push({room:room.id,from:Math.min(a,b),to:Math.max(a,b),bottom:room.floorY,top:room.floorY+w.height,thickness:w.thickness,
      openings:w.openings.map(o=>({from:forward?a+o.offset:a-o.offset-o.width,to:forward?a+o.offset+o.width:a-o.offset,bottom:room.floorY+o.bottom,top:room.floorY+o.bottom+o.height,kind:o.kind}))});
  }
  return lines;
}
const ordered=(values:readonly number[]):number[]=>[...values].sort((a,b)=>a-b).filter((n,i,a)=>i===0||n-(a[i-1]??n)>EPSILON);

/** Break coincident centerlines into common sections. Any declared shared opening remains open. */
function walls(rooms:readonly ApartmentRoom[],budget:{vertices:number}):SceneWall[] {
  const results:SceneWall[]=[];
  for(const {start,direction,spans} of wallLines(rooms)){
    const ranges=ordered(spans.flatMap(s=>[s.from,s.to,...s.openings.flatMap(o=>[o.from,o.to])]));
    const yaw=Math.atan2(-direction[1],direction[0]);
    for(let i=0;i+1<ranges.length;i++){
      const from=ranges[i],to=ranges[i+1];if(from===undefined||to===undefined)continue;
      const mid=(from+to)/2,active=spans.filter(s=>s.from<mid&&s.to>mid);
      if(active.length===0)continue;
      const floor=Math.min(...active.map(s=>s.bottom)),short=floor+.40;
      const openings=active.flatMap(s=>s.openings.filter(o=>o.from<mid&&o.to>mid));
      const heights=ordered([short,...active.flatMap(s=>[s.bottom,s.top]),...openings.flatMap(o=>[o.bottom,o.top])]);
      const middle:ApartmentPoint=[start[0]+direction[0]*mid,start[1]+direction[1]*mid];
      const make=():Builder=>builder(budget,p=>atOffset(atYaw(p,yaw),[middle[0],0,middle[1]]),n=>atYaw(n,yaw));
      const full=make(),low=make();
      for(let j=0;j+1<heights.length;j++){
        const bottom=heights[j],top=heights[j+1];if(bottom===undefined||top===undefined)continue;
        const y=(bottom+top)/2,thickness=Math.max(0,...active.filter(s=>s.bottom<y&&s.top>y).map(s=>s.thickness));
        if(thickness===0||openings.some(o=>o.bottom<y&&o.top>y))continue;
        const color=top<=floor+.11?tones.trim:tones.plaster;
        full.box([0,y,0],[to-from,top-bottom,thickness],color,tones.cap);
        if(top<=short+EPSILON)low.box([0,y,0],[to-from,top-bottom,thickness],color,tones.cap);
      }
      if(openings.length>0){
        const o=openings[0];
        if(o!==undefined){
          const thick=Math.max(...active.map(s=>s.thickness));
          const sill=o.kind==='window'?o.bottom:floor+.006;
          full.box([0,sill,0],[to-from,.022,thick+.032],tones.oak,tones.clay);
          if(o.kind==='window')full.box([0,o.top-.017,0],[to-from,.034,thick+.032],tones.wood);
          // A short sill shows the location of a window on a cut wall; door gaps stay walkable.
          low.box([0,o.kind==='window'?Math.min(short+.018,sill):sill,0],[to-from,.022,thick+.033],tones.oak,tones.clay);
        }
      }
      results.push({rooms:[...new Set(active.map(s=>s.room))],start,direction,middle,full:full.mesh(),low:low.mesh()});
    }
  }
  return results;
}

function bounds(rooms:readonly ApartmentRoom[]):SceneBounds {
  const points=rooms.flatMap(r=>r.footprint),xx=points.map(p=>p[0]),zz=points.map(p=>p[1]);
  const minX=Math.min(...xx),maxX=Math.max(...xx),minZ=Math.min(...zz),maxZ=Math.max(...zz);
  const minY=Math.min(...rooms.map(r=>r.floorY)),maxY=Math.max(...rooms.flatMap(r=>r.walls.map(w=>r.floorY+w.height)));
  const center:Vec=[(minX+maxX)/2,minY+(maxY-minY)*.4,(minZ+maxZ)/2];
  return {center,radius:Math.max(Math.hypot((maxX-minX)/2,(maxZ-minZ)/2,(maxY-minY)*.6),.24)};
}

export function composeApartment(model:ApartmentModel):ApartmentScene {
  const budget={vertices:0},rooms:ApartmentScene['rooms']=new Map(),fixtures:ApartmentScene['fixtures']=[],art:ApartmentScene['art']=[];
  model.rooms.forEach((room,i)=>{
    const surface=builder(budget),y=room.floorY,color=floorColors[i%floorColors.length]??tones.oak;
    const lift=([x,z]:ApartmentPoint):Vec=>[x,y,z];
    for(const [a,b,c] of triangulate(room.footprint))surface.triangle(lift(a),lift(c),lift(b),up,color,1);
    for(let j=0;j<room.footprint.length;j++){
      const a=room.footprint[j],b=room.footprint[(j+1)%room.footprint.length];if(a===undefined||b===undefined)continue;
      const elevation=.15,normal:Vec=[a[1]-b[1],0,b[0]-a[0]];
      surface.quad([[a[0],y-elevation,a[1]],[b[0],y-elevation,b[1]],lift(b),lift(a)],normal,tones.wood);
    }
    for(const item of model.objects){
      if(item.roomId!==room.id)continue;
      if(item.kind==='furniture'){furniture(surface,item);continue;}
      const actual=wallClearance(item,room);
      const mesh=():Builder=>builder(budget,p=>atOffset(atYaw(p,item.yaw),actual),n=>atYaw(n,item.yaw));
      const shape=mesh();
      if(item.kind==='fixture'){
        fixture(shape,item);
        fixtures.push({item,mesh:shape.mesh(),point:[actual[0],actual[1]+item.size[1]*.48,actual[2]]});
      }else{
        const print=mesh();artwork(shape,print,item.size);
        art.push({item,mesh:shape.mesh(),print:print.mesh()});
      }
    }
    rooms.set(room.id,{mesh:surface.mesh(),bounds:bounds([room]),floorY:room.floorY});
  });
  return {bounds:bounds(model.rooms),rooms,walls:walls(model.rooms,budget),fixtures,art,vertices:budget.vertices};
}
