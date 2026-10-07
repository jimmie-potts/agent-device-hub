declare module 'gifenc' {
 function GIFEncoder():{
  writeFrame(pixels:Uint8Array,width:number,height:number,options:{palette?:number[][];delay:number;dispose:number;transparent:boolean;repeat:number}):void;
  finish():void;bytes():Uint8Array;
 };
 const gifenc:{GIFEncoder:typeof GIFEncoder};
 export default gifenc;
 export {GIFEncoder};
}
