import {APARTMENT_STRIDE,type ApartmentScene,type SceneBounds,type SceneMesh,type SceneWall,type Vec} from './apartment-scene.ts';

export type CameraView = 'dollhouse' | 'overhead';
export type ProjectedFixture = {id:string;x:number;y:number;visible:boolean};
export type ApartmentRenderer = {
  frame:(room:string|null,view:CameraView,cutaway:boolean)=>void;
  zoom:(factor:number)=>void;
  lights:(selected:string|null,power:ReadonlyMap<string,boolean|undefined>)=>void;
  artwork:(id:string,image:ImageBitmap)=>void;
  dispose:()=>void;
};
const clamp=(v:number,a:number,b:number):number=>Math.max(a,Math.min(b,v));
const dot=(a:Vec,b:Vec):number=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a:Vec,b:Vec):Vec=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function unit(v:Vec):Vec {const len=Math.hypot(...v);return [v[0]/len,v[1]/len,v[2]/len];}
function cameraMatrix(eye:Vec,target:Vec,width:number,height:number,extent:number,depth:number):Float32Array {
  const z=unit([eye[0]-target[0],eye[1]-target[1],eye[2]-target[2]]),x=unit(cross([0,1,0],z)),y=cross(z,x);
  const xScale=1/(Math.max(1,width/height)*extent),yScale=1/(Math.max(1,height/width)*extent),zScale=1/depth;
  return new Float32Array([x[0]*xScale,y[0]*yScale,-z[0]*zScale,0,x[1]*xScale,y[1]*yScale,-z[1]*zScale,0,
    x[2]*xScale,y[2]*yScale,-z[2]*zScale,0,-dot(x,target)*xScale,-dot(y,target)*yScale,dot(z,target)*zScale,1]);
}

const VERTEX=`
attribute vec3 aPoint; attribute vec3 aNormal; attribute vec3 aColor; attribute vec2 aUv; attribute float aFinish;
uniform mat4 uMatrix; varying vec3 vPoint; varying vec3 vNormal; varying vec3 vColor; varying vec2 vUv; varying float vFinish;
void main(){ vPoint=aPoint; vNormal=aNormal; vColor=aColor; vUv=aUv; vFinish=aFinish; gl_Position=uMatrix*vec4(aPoint,1.); }
`;
const FRAGMENT=`
precision mediump float;
varying vec3 vPoint; varying vec3 vNormal; varying vec3 vColor; varying vec2 vUv; varying float vFinish;
uniform sampler2D uImage; uniform bool uPrint; uniform float uPower; uniform bool uSelected;
void main(){
  vec3 n=normalize(vNormal);
  float daylight=.80+.19*max(dot(n,vec3(-.35,.82,.45)),0.)+.08*max(dot(n,vec3(.64,.43,-.63)),0.);
  vec3 color=vColor*daylight;
  if(vFinish>.5){
    float board=floor(vPoint.z*6.2);
    float seam=1.-smoothstep(.011,.035,fract(vPoint.z*6.2));
    float end=1.-smoothstep(.006,.018,fract(vPoint.x*.72+board*.38));
    color*=.96+.035*cos(board*1.31)+.025*cos(vPoint.x*2.7+board)-.13*max(seam,end);
  }
  if(uPrint){ vec4 ink=texture2D(uImage,vUv); color=mix(color,ink.rgb*max(.91,daylight),ink.a); }
  if(uPower>.5)color=mix(color,vec3(1.,.865,.52),.43);
  if(uPower<-.5)color*=.84;
  if(uSelected)color=mix(color,vec3(.97,.64,.34),.23);
  gl_FragColor=vec4(color,1.);
}
`;

type BufferMesh={buffer:WebGLBuffer;count:number};

/** No network or authority enters the renderer. It owns its GL resources and camera gestures. */
export function createApartmentRenderer({canvas,scene,unavailable,project}:{
  canvas:HTMLCanvasElement;scene:ApartmentScene;unavailable:()=>void;project:(points:ProjectedFixture[])=>void;
}):ApartmentRenderer {
  const context=canvas.getContext('webgl',{alpha:true,antialias:true,premultipliedAlpha:false});
  if(context===null)throw new Error('apartment-webgl');
  const gl:WebGLRenderingContext=context;
  const program=gl.createProgram();
  if(program===null)throw new Error('apartment-webgl');
  const shaders:WebGLShader[]=[],buffers=new Map<SceneMesh,BufferMesh>(),textures=new Map<string,WebGLTexture>();
  const events=new AbortController(),{signal}=events;
  let disposed=false,raf=0,resize:ResizeObserver|undefined;
  function dispose():void {
    if(disposed)return;
    disposed=true;events.abort();resize?.disconnect();cancelAnimationFrame(raf);
    for(const {buffer} of buffers.values())gl.deleteBuffer(buffer);
    for(const texture of textures.values())gl.deleteTexture(texture);
    for(const shader of shaders)gl.deleteShader(shader);
    gl.deleteProgram(program);buffers.clear();textures.clear();
    canvas.removeAttribute('data-rendered');
  }
  const shader=(type:number,source:string):void=>{
    const handle=gl.createShader(type);
    if(handle===null)throw new Error('apartment-webgl');
    shaders.push(handle);gl.shaderSource(handle,source);gl.compileShader(handle);
    if(gl.getShaderParameter(handle,gl.COMPILE_STATUS)!==true)throw new Error('apartment-webgl');
    gl.attachShader(program,handle);
  };
  const allocate=(mesh:SceneMesh):void=>{
    if(mesh.count===0)return;
    const buffer=gl.createBuffer();
    if(buffer===null)throw new Error('apartment-webgl');
    buffers.set(mesh,{buffer,count:mesh.count});gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,mesh.vertices,gl.STATIC_DRAW);
  };
  try{
    shader(gl.VERTEX_SHADER,VERTEX);shader(gl.FRAGMENT_SHADER,FRAGMENT);gl.linkProgram(program);
    if(gl.getProgramParameter(program,gl.LINK_STATUS)!==true)throw new Error('apartment-webgl');
    for(const shader of shaders){gl.detachShader(program,shader);gl.deleteShader(shader);}
    shaders.length=0;
    for(const {mesh} of scene.rooms.values())allocate(mesh);
    for(const {full,low} of scene.walls){allocate(full);allocate(low);}
    for(const {mesh} of scene.fixtures)allocate(mesh);
    for(const {mesh,print} of scene.art){allocate(mesh);allocate(print);}
    if(gl.getError()!==gl.NO_ERROR)throw new Error('apartment-webgl');
  }catch(error){dispose();throw error;}
  const attributes=[['aPoint',3,0],['aNormal',3,12],['aColor',3,24],['aUv',2,36],['aFinish',1,44]] as const;
  const layout=attributes.map(([name,size,offset])=>({location:gl.getAttribLocation(program,name),size,offset}));
  const uniform=(name:string):WebGLUniformLocation|null=>gl.getUniformLocation(program,name);
  const matrix=uniform('uMatrix'),print=uniform('uPrint'),image=uniform('uImage'),power=uniform('uPower'),highlight=uniform('uSelected');
  let room:string|null=null,view:CameraView='dollhouse',target:SceneBounds=scene.bounds,cutaway=true,
    yaw=.66,pitch=.79,magnification=1,selected:string|null=null,powers:ReadonlyMap<string,boolean|undefined>=new Map();
  function draw(mesh:SceneMesh,texture?:WebGLTexture,lit?:boolean,selected=false):void {
    const data=buffers.get(mesh);if(data===undefined)return;
    gl.bindBuffer(gl.ARRAY_BUFFER,data.buffer);
    for(const {location,size,offset} of layout){
      if(location<0)continue;
      gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,size,gl.FLOAT,false,APARTMENT_STRIDE,offset);
    }
    gl.uniform1i(print,texture===undefined?0:1);gl.uniform1f(power,lit===undefined?0:lit?1:-1);gl.uniform1i(highlight,selected?1:0);
    if(texture!==undefined)gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.drawArrays(gl.TRIANGLES,0,data.count);
  }
  function shorten(wall:SceneWall,eye:Vec):boolean {
    if(!cutaway)return false;
    if(view==='overhead')return true;
    if(room===null&&wall.rooms.length>1)return true;
    const relative=([x,,z]:Vec):number=>wall.direction[0]*(z-wall.start[1])-wall.direction[1]*(x-wall.start[0]);
    const inside=relative(target.center),outside=relative(eye);
    return inside*outside<0||Math.abs(inside)<.025&&wall.rooms.length>1;
  }
  const shown=(id:string):boolean=>room===null||id===room;
  function render():void {
    raf=0;if(disposed)return;
    const w=canvas.clientWidth,h=canvas.clientHeight;if(w===0||h===0)return;
    const scale=Math.min(window.devicePixelRatio,2,Math.sqrt(2_000_000/(w*h)));
    const width=Math.max(1,Math.round(w*scale)),height=Math.max(1,Math.round(h*scale));
    if(canvas.width!==width)canvas.width=width;
    if(canvas.height!==height)canvas.height=height;
    const depth=target.radius*4,[x,y,z]=target.center,dist=target.radius*3;
    const eye:Vec=[x+dist*Math.sin(yaw)*Math.cos(pitch),y+dist*Math.sin(pitch),z+dist*Math.cos(yaw)*Math.cos(pitch)];
    const transform=cameraMatrix(eye,target.center,w,h,target.radius*1.12*magnification,depth);
    gl.viewport(0,0,width,height);gl.enable(gl.DEPTH_TEST);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    gl.useProgram(program);gl.uniformMatrix4fv(matrix,false,transform);gl.activeTexture(gl.TEXTURE0);gl.uniform1i(image,0);
    for(const [id,{mesh}] of scene.rooms)if(shown(id))draw(mesh);
    for(const wall of scene.walls)if(room===null||wall.rooms.includes(room))draw(shorten(wall,eye)?wall.low:wall.full);
    for(const {item,mesh,print:panel} of scene.art)if(shown(item.roomId)){
      draw(mesh);
      const texture=item.asset===null?undefined:textures.get(item.asset);
      if(texture!==undefined)draw(panel,texture);
    }
    const points:ProjectedFixture[]=[];
    for(const {item,mesh,point} of scene.fixtures){
      if(!shown(item.roomId))continue;
      draw(mesh,undefined,powers.get(item.id),item.id===selected);
      const px=((transform[0]??0)*point[0]+(transform[4]??0)*point[1]+(transform[8]??0)*point[2]+(transform[12]??0))*.5+.5;
      const py=.5-((transform[1]??0)*point[0]+(transform[5]??0)*point[1]+(transform[9]??0)*point[2]+(transform[13]??0))*.5;
      points.push({id:item.id,x:px*w,y:py*h,visible:px>.045&&px<.955&&py>.06&&py<.94});
    }
    project(points);
    canvas.dataset.rendered='true';canvas.dataset.yaw=String(yaw);canvas.dataset.distance=String(magnification*target.radius);
    canvas.dataset.frame=room??'apartment';canvas.dataset.camera=view;canvas.dataset.cutaway=String(cutaway);
  }
  function schedule():void {if(raf===0&&!disposed)raf=requestAnimationFrame(render);}
  const zoom=(factor:number):void=>{magnification=clamp(magnification*factor,.32,2.6);schedule();};
  const pointers=new Map<number,{x:number;y:number}>();
  const separation=():number=>{
    const [a,b]=pointers.values();return a===undefined||b===undefined?0:Math.hypot(a.x-b.x,a.y-b.y);
  };
  canvas.addEventListener('pointerdown',e=>{
    if(pointers.size>=2||e.pointerType==='mouse'&&e.button!==0)return;
    canvas.setPointerCapture(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  },{signal});
  canvas.addEventListener('pointermove',e=>{
    const before=pointers.get(e.pointerId);if(before===undefined)return;
    const old=separation();pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pointers.size===2){const next=separation();if(old>0&&next>0)zoom(old/next);return;}
    yaw-=(e.clientX-before.x)*.009;
    if(view==='dollhouse')pitch=clamp(pitch+(e.clientY-before.y)*.007,.20,1.54);
    schedule();
  },{signal});
  const release=(event:PointerEvent):void=>{pointers.delete(event.pointerId);};
  canvas.addEventListener('pointerup',release,{signal});canvas.addEventListener('pointercancel',release,{signal});canvas.addEventListener('lostpointercapture',release,{signal});
  canvas.addEventListener('wheel',e=>{e.preventDefault();zoom(Math.exp(e.deltaY*.0015));},{passive:false,signal});
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();dispose();unavailable();},{signal});
  try{resize=new ResizeObserver(schedule);resize.observe(canvas);schedule();}catch(error){dispose();throw error;}
  return {
    frame:(nextRoom,nextView,nextCutaway)=>{
      if(room!==nextRoom||view!==nextView){
        room=nextRoom;view=nextView;target=room===null?scene.bounds:scene.rooms.get(room)?.bounds??scene.bounds;
        yaw=view==='overhead'?0:.66;pitch=view==='overhead'?1.569:.79;magnification=1;
      }
      cutaway=nextCutaway;schedule();
    },
    zoom,
    lights:(chosen,reports)=>{selected=chosen;powers=reports;schedule();},
    artwork:(id,bitmap)=>{
      if(disposed||textures.has(id))return;
      const texture=gl.createTexture();if(texture===null)throw new Error('apartment-texture');
      try{
        gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
        // ImageBitmap applies the flip during decode; WebGL's flip option does not apply to ImageBitmap.
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,bitmap);
        if(gl.getError()!==gl.NO_ERROR)throw new Error('apartment-texture');
        textures.set(id,texture);schedule();
      }catch(error){gl.deleteTexture(texture);throw error;}
    },
    dispose,
  };
}
