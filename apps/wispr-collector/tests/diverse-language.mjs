export const diverseText=(count,offset=0)=>Array.from({length:count},(_,i)=>{
 let n=i+offset,suffix='';for(let place=0;place<4;place++){suffix=String.fromCharCode(97+n%26)+suffix;n=Math.floor(n/26);}
 return 'token'+suffix;
}).join(' ');
