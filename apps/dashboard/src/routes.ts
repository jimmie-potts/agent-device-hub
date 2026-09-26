/** The shell's navigation value. Built-in pages and registered components are distinct kinds, so a component alias such as `activity` or `connections` never selects a built-in page (Hub #247). Every route has a hash URL, so pages have addresses and the back button walks the history. */
export type Route={kind:'home'}|{kind:'component';id:string}|{kind:'playback';sourceId:string}|{kind:'connections'}|{kind:'missing';hash:string};
export const homeRoute:Route={kind:'home'};
const decode=(part:string)=>{try{return decodeURIComponent(part);}catch{return part;}};
/** Parses a location hash. An empty hash, `#/`, `#/home` and `#/activity` open the home. A hash that is not a route, including the launcher's `#launch=` fragment, is reported as missing rather than guessed. */
export function parseRoute(hash:string):Route{
 const path=hash.startsWith('#')?hash.slice(1):hash;
 if(path===''||path==='/'||path==='/home'||path==='/activity')return homeRoute;
 if(!path.startsWith('/'))return {kind:'missing',hash};
 const parts=path.slice(1).split('/').map(decode);
 if(parts.length===1&&parts[0]==='connections')return {kind:'connections'};
 if(parts.length===2&&parts[0]==='component'&&parts[1])return {kind:'component',id:parts[1]};
 if(parts.length===2&&parts[0]==='music'&&parts[1])return {kind:'playback',sourceId:parts[1]};
 return {kind:'missing',hash};
}
/** The canonical hash for a route; the value a navigation link carries. */
export function routeHash(route:Route):string{
 switch(route.kind){
  case 'home':return '#/';
  case 'connections':return '#/connections';
  case 'component':return '#/component/'+encodeURIComponent(route.id);
  case 'playback':return '#/music/'+encodeURIComponent(route.sourceId);
  case 'missing':return route.hash;
 }
}
export const sameRoute=(a:Route,b:Route)=>routeHash(a)===routeHash(b);
