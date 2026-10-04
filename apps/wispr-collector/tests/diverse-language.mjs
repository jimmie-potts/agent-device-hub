export const diverseText=(count,offset=0)=>Array.from({length:count},(_,i)=>{
 let n=i+offset,suffix='';for(let place=0;place<4;place++){suffix=String.fromCharCode(97+n%26)+suffix;n=Math.floor(n/26);}
 return 'token'+suffix;
}).join(' ');

/** Synthetic adversarial keys share the high nibble of the documented FNV-1a string hash. */
let collisions;
export function collidingTexts(){
 if(collisions)return collisions;
 const words=[];
 for(let candidate=0;words.length<18*1800;candidate++){
  let n=candidate,suffix='';for(let place=0;place<5;place++){suffix=String.fromCharCode(97+n%26)+suffix;n=Math.floor(n/26);}
  const text='token'+suffix;let hash=2166136261;
  for(const char of text)hash=Math.imul(hash^char.charCodeAt(0),16777619);
  if((hash>>>28)===0)words.push(text);
 }
 collisions=Array.from({length:18},(_,i)=>words.slice(i*1800,(i+1)*1800).join(' '));
 return collisions;
}
