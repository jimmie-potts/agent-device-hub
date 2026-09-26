/** Visible text blocks in the open view whose boxes overlap, as short labels; an empty list means none do. Ancestors and descendants are not compared. */
export function textOverlaps(page){
 return page.evaluate(()=>{
  // Content of a closed disclosure is not rendered; only its summary is.
  const folded=el=>{const details=el.closest('details:not([open])');return !!details&&!details.querySelector(':scope>summary')?.contains(el);};
  const blocks=[...document.querySelectorAll('main section p, main section h2, main section h3, main section dt, main section dd, main section label, main section button, main section a')]
   .filter(el=>el.offsetParent!==null&&!folded(el)&&el.getBoundingClientRect().height>1&&el.textContent.trim());
  const found=[];
  for(let i=0;i<blocks.length;i++)for(let j=i+1;j<blocks.length;j++){
   const a=blocks[i],b=blocks[j];if(a.contains(b)||b.contains(a))continue;
   const r=a.getBoundingClientRect(),q=b.getBoundingClientRect();
   if(Math.min(r.right,q.right)-Math.max(r.left,q.left)>1&&Math.min(r.bottom,q.bottom)-Math.max(r.top,q.top)>1)found.push(`${a.textContent.trim().slice(0,32)} × ${b.textContent.trim().slice(0,32)}`);
  }
  return found;
 });
}
/** How far across the main column the open view's visible controls reach, as a fraction of its width; a view that stops at half the column reads as an empty right half. */
export function controlReach(page){
 return page.evaluate(()=>{
  const main=document.getElementById('main').getBoundingClientRect();
  const controls=[...document.querySelectorAll('main section:not([hidden]) select, main section:not([hidden]) input, main section:not([hidden]) button')].filter(el=>el.offsetParent!==null);
  const right=Math.max(main.left,...controls.map(el=>el.getBoundingClientRect().right));
  return Math.round(100*(right-main.left)/main.width)/100;
 });
}
