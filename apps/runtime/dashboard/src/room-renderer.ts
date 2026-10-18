import {roomBytes,type RoomModel} from '../../src/room-model.ts';

type Vec=[number,number,number];
type BufferBatch={group:string;material:number;count:number;vertices:WebGLBuffer;indices:WebGLBuffer};
export type RoomRenderer={camera:(view:'dollhouse'|'overhead')=>void;zoom:(factor:number)=>void;cutaway:(enabled:boolean)=>void;
  selection:(group:string|undefined,power:ReadonlyMap<string,boolean|undefined>)=>void;dispose:()=>void};
const clamp=(v:number,a:number,b:number):number=>Math.min(b,Math.max(a,v));
const normalize=(v:Vec):Vec=>{const n=Math.hypot(...v);return [v[0]/n,v[1]/n,v[2]/n];};
const dot=(a:Vec,b:Vec):number=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a:Vec,b:Vec):Vec=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function lookAt(eye:Vec,target:Vec):number[]{const z=normalize([eye[0]-target[0],eye[1]-target[1],eye[2]-target[2]]),x=normalize(cross([0,1,0],z)),y=cross(z,x);
  return [x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-dot(x,eye),-dot(y,eye),-dot(z,eye),1];}
function multiply(a:readonly number[],b:readonly number[]):Float32Array {const out=new Float32Array(16);
  for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)out[c*4+r]=(out[c*4+r]??0)+(a[k*4+r]??0)*(b[c*4+k]??0);return out;}
function perspective(aspect:number):number[]{const f=1/Math.tan(Math.PI/8),n=.05,z=500;return [f/aspect,0,0,0,0,f,0,0,0,0,(z+n)/(n-z),-1,0,0,2*z*n/(n-z),0];}

/** A local renderer of validated prepared geometry. It has no network or device API. */
export type ProjectedAnchor={id:string;x:number;y:number;visible:boolean};
export function createRoomRenderer(canvas:HTMLCanvasElement,model:RoomModel,unavailable:()=>void,projected:(points:ProjectedAnchor[])=>void):RoomRenderer {
  const context=canvas.getContext('webgl',{alpha:true,antialias:true});
  if(context===null)throw new Error('room-renderer-unavailable');
  const gl:WebGLRenderingContext=context,resources:WebGLBuffer[]=[],shaders:WebGLShader[]=[];
  function shader(type:number,source:string):WebGLShader {const s=gl.createShader(type);if(s===null)throw new Error('room-renderer-unavailable');shaders.push(s);gl.shaderSource(s,source);gl.compileShader(s);
    if(gl.getShaderParameter(s,gl.COMPILE_STATUS)!==true)throw new Error('room-renderer-unavailable');return s;}
  const program=gl.createProgram();if(program===null)throw new Error('room-renderer-unavailable');
  try{
    gl.attachShader(program,shader(gl.VERTEX_SHADER,'attribute vec3 aPosition;attribute vec3 aNormal;uniform mat4 uMatrix;varying vec3 vNormal;void main(){vNormal=aNormal;gl_Position=uMatrix*vec4(aPosition,1.);}'));
    gl.attachShader(program,shader(gl.FRAGMENT_SHADER,'precision highp float;varying vec3 vNormal;uniform vec3 uColor;uniform float uSelected;uniform float uPower;void main(){vec3 N=normalize(vNormal);if(!gl_FrontFacing)N=-N;float light=.79+.07*max(N.y,0.)+.18*max(dot(N,normalize(vec3(-.45,1.,.65))),0.)+.13*max(dot(N,normalize(vec3(.8,.1,-1.))),0.);vec3 color=uColor*light;if(uPower>.5)color=mix(color,vec3(.97,.94,.80),.65);if(uPower<-.5)color*=.65;color=mix(color,min(vec3(1.),color*1.12+.07),uSelected);gl_FragColor=vec4(color,1.);}'));
    gl.linkProgram(program);if(gl.getProgramParameter(program,gl.LINK_STATUS)!==true)throw new Error('room-renderer-unavailable');
  }catch(error){for(const s of shaders)gl.deleteShader(s);gl.deleteProgram(program);throw error;}
  const batches:BufferBatch[]=[];
  try{for(const batch of model.scene.batches){const vertices=gl.createBuffer(),indices=gl.createBuffer();if(vertices===null||indices===null)throw new Error('room-renderer-unavailable');resources.push(vertices,indices);
    gl.bindBuffer(gl.ARRAY_BUFFER,vertices);gl.bufferData(gl.ARRAY_BUFFER,roomBytes(batch.vertices),gl.STATIC_DRAW);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,indices);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,roomBytes(batch.indices),gl.STATIC_DRAW);
    batches.push({group:batch.group,material:batch.material,count:batch.count,vertices,indices});}
  }catch(error){for(const b of resources)gl.deleteBuffer(b);for(const s of shaders)gl.deleteShader(s);gl.deleteProgram(program);throw error;}
  const pos=gl.getAttribLocation(program,'aPosition'),normal=gl.getAttribLocation(program,'aNormal');
  const matrixLocation=gl.getUniformLocation(program,'uMatrix'),color=gl.getUniformLocation(program,'uColor'),selectedLocation=gl.getUniformLocation(program,'uSelected'),powerLocation=gl.getUniformLocation(program,'uPower');
  const size=Math.max(model.scene.width,model.scene.depth,model.scene.height),center:Vec=[model.scene.width/2,model.scene.height*.34,model.scene.depth/2];
  let yaw=2.55,pitch=.81,distance=size*2.16,cutaway=true,selected:string|undefined,powers:ReadonlyMap<string,boolean|undefined>=new Map(),frame=0,closed=false;
  const events=new AbortController();
  function wallHidden(group:string,eye:Vec):boolean {return cutaway&&(group==='wall-left'&&eye[0]<0||group==='wall-right'&&eye[0]>model.scene.width||group==='wall-front'&&eye[2]<0||group==='wall-back'&&eye[2]>model.scene.depth);}
  function visible(batch:BufferBatch,eye:Vec):boolean {
    if(wallHidden(batch.group,eye))return false;
    const anchor=model.anchors.find(a=>a.group===batch.group);if(anchor===undefined||!cutaway)return true;
    const x=anchor.position[0]??0,z=anchor.position[2]??0;
    return !(x<.12&&wallHidden('wall-left',eye)||x>model.scene.width-.12&&wallHidden('wall-right',eye)||z<.12&&wallHidden('wall-front',eye)||z>model.scene.depth-.12&&wallHidden('wall-back',eye));
  }
  function render():void {
    frame=0;if(closed)return;const w=canvas.clientWidth,h=canvas.clientHeight;if(w===0||h===0)return;
    const dpr=Math.min(window.devicePixelRatio,2),d=distance*Math.max(1,1.12/(w/h)),radius=Math.cos(pitch)*d;
    canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);
    const eye:Vec=[center[0]+Math.sin(yaw)*radius,center[1]+Math.sin(pitch)*d,center[2]+Math.cos(yaw)*radius];
    gl.useProgram(program);gl.viewport(0,0,canvas.width,canvas.height);gl.enable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    const matrix=multiply(perspective(w/h),lookAt(eye,center));gl.uniformMatrix4fv(matrixLocation,false,matrix);
    for(const b of batches){if(!visible(b,eye))continue;const material=model.scene.materials[b.material];if(material===undefined)continue;
      gl.bindBuffer(gl.ARRAY_BUFFER,b.vertices);gl.enableVertexAttribArray(pos);gl.vertexAttribPointer(pos,3,gl.FLOAT,false,24,0);gl.enableVertexAttribArray(normal);gl.vertexAttribPointer(normal,3,gl.FLOAT,false,24,12);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,b.indices);
      gl.uniform3fv(color,material.color);gl.uniform1f(selectedLocation,b.group===selected?1:0);const p=powers.get(b.group);gl.uniform1f(powerLocation,p===undefined?0:p?1:-1);gl.drawElements(gl.TRIANGLES,b.count,gl.UNSIGNED_SHORT,0);
    }
    projected(model.anchors.map(a=>{const p=a.position,c=[0,0,0,0];for(let r=0;r<4;r++)c[r]=(matrix[r]??0)*(p[0]??0)+(matrix[4+r]??0)*(p[1]??0)+(matrix[8+r]??0)*(p[2]??0)+(matrix[12+r]??0);const z=c[3]??0,x=((c[0]??0)/z*.5+.5)*w,y=(.5-(c[1]??0)/z*.5)*h;return {id:a.id,x,y,visible:z>0&&x>=0&&x<=w&&y>=0&&y<=h};}));
    canvas.dataset.rendered='true';canvas.dataset.yaw=String(yaw);canvas.dataset.distance=String(distance);
  }
  function schedule():void {if(frame===0&&!closed)frame=requestAnimationFrame(render);}
  const pointers=new Map<number,{x:number;y:number}>();let pinch=0;
  canvas.addEventListener('pointerdown',e=>{canvas.setPointerCapture(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pointers.size===2){const [a,b]=[...pointers.values()];if(a!==undefined&&b!==undefined)pinch=Math.hypot(a.x-b.x,a.y-b.y);}},{signal:events.signal});
  canvas.addEventListener('pointermove',e=>{const before=pointers.get(e.pointerId);if(before===undefined)return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pointers.size===1){yaw-=(e.clientX-before.x)*.008;pitch=clamp(pitch+(e.clientY-before.y)*.006,.18,1.56);}else if(pointers.size===2){const [a,b]=[...pointers.values()];if(a!==undefined&&b!==undefined){const n=Math.hypot(a.x-b.x,a.y-b.y);if(pinch>0&&n>0)distance=clamp(distance*pinch/n,size*.9,size*4);pinch=n;}}schedule();},{signal:events.signal});
  for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,raw=>{const e=raw as PointerEvent;pointers.delete(e.pointerId);pinch=0;},{signal:events.signal});
  canvas.addEventListener('wheel',e=>{e.preventDefault();distance=clamp(distance*Math.exp(e.deltaY*.001),size*.9,size*4);schedule();},{passive:false,signal:events.signal});
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();unavailable();},{signal:events.signal});
  const resize=new ResizeObserver(schedule);resize.observe(canvas);render();
  return {
    camera:view=>{yaw=view==='overhead'?Math.PI:2.55;pitch=view==='overhead'?1.55:.81;distance=size*2.16;schedule();},
    zoom:factor=>{distance=clamp(distance*factor,size*.9,size*4);schedule();},
    cutaway:enabled=>{cutaway=enabled;schedule();},
    selection:(group,power)=>{if(group!==selected&&group!==undefined){const a=model.anchors.find(a=>a.group===group);if(a!==undefined){yaw=Math.atan2(center[0]-(a.position[0]??0),center[2]-(a.position[2]??0));pitch=.8;}}selected=group;powers=power;schedule();},
    dispose:()=>{closed=true;events.abort();resize.disconnect();cancelAnimationFrame(frame);for(const b of resources)gl.deleteBuffer(b);for(const s of shaders)gl.deleteShader(s);gl.deleteProgram(program);canvas.removeAttribute('data-rendered');},
  };
}
