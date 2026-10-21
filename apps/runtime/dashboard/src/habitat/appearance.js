export function createAppearance() {
  'use strict';
  const palette=[
    ['Moss','#78964b'],['Cornflower','#6c9bd2'],['Terracotta','#ce795c'],['Plum','#a478b5'],
    ['Marigold','#d7ad4c'],['Teal','#4ca69b'],['Rose','#d28f9b'],['Denim','#667db1'],
    ['Lavender','#a69ad2'],['Copper','#b78b59'],
  ];
  const validColor=value=>typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value);
  function colorsFrom(raw){
    let saved;try{saved=JSON.parse(raw);}catch{saved=null;}
    return palette.map(([,fallback],id)=>validColor(saved?.[id])?saved[id].toLowerCase():fallback);
  }
  function hsl(r,g,b){
    r/=255;g/=255;b/=255;
    const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min,l=(max+min)/2;
    if(!d)return [0,0,l];
    const s=d/(1-Math.abs(2*l-1));
    let h=max===r?((g-b)/d)%6:max===g?(b-r)/d+2:(r-g)/d+4;
    h=(h*60+360)%360;return [h,s,l];
  }
  function rgb(h,s,l){
    const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs((h/60)%2-1)),m=l-c/2;
    const v=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];
    return v.map(n=>Math.round((n+m)*255));
  }
  function apronPixel(r,g,b,a=255){
    const [h,s,l]=hsl(r,g,b);
    return a>0&&h>=47&&h<=112&&s>=.18&&l<.69;
  }
  // Palette swap only the apron greens. Fur, outlines, props and alpha stay intact.
  function tintPixels(source,hex){
    if(!validColor(hex))throw new TypeError('An apron color must be a six-digit hex color.');
    const out=new Uint8ClampedArray(source),[h,s,l]=hsl(...[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)));
    for(let i=0;i<out.length;i+=4){
      if(!apronPixel(source[i],source[i+1],source[i+2],source[i+3]))continue;
      const [,originalS,originalL]=hsl(source[i],source[i+1],source[i+2]);
      const light=Math.max(.05,Math.min(.91,l+(originalL-.31)*.9));
      const color=rgb(h,Math.min(1,s*(.65+originalS*.55)),light);
      out[i]=color[0];out[i+1]=color[1];out[i+2]=color[2];
    }
    return out;
  }
  return{palette,validColor,colorsFrom,tintPixels,apronPixel};
}
