/** Visible text blocks in the open view whose boxes overlap, as short labels; an empty list means none do. Ancestors and descendants are not compared. */
export function textOverlaps(page){
 return page.evaluate(()=>{
  const blocks=[...document.querySelectorAll('main section p, main section h2, main section h3, main section dt, main section dd, main section label, main section button, main section a')]
   .filter(el=>el.offsetParent!==null&&el.getBoundingClientRect().height>1&&el.textContent.trim());
  const found=[];
  for(let i=0;i<blocks.length;i++)for(let j=i+1;j<blocks.length;j++){
   const a=blocks[i],b=blocks[j];if(a.contains(b)||b.contains(a))continue;
   const r=a.getBoundingClientRect(),q=b.getBoundingClientRect();
   if(Math.min(r.right,q.right)-Math.max(r.left,q.left)>1&&Math.min(r.bottom,q.bottom)-Math.max(r.top,q.top)>1)found.push(`${a.textContent.trim().slice(0,32)} × ${b.textContent.trim().slice(0,32)}`);
  }
  return found;
 });
}
