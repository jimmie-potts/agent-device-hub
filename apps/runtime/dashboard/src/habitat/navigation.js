/* Floor navigation for the local burrow. Coordinates are native art pixels.
   Saved resting poses are reached by boarding hops, never walking edges. */
export function createNavigation() {
  const scale=[1600/1341,1400/1173],art=p=>[p[0]/scale[0],p[1]/scale[1]],world=p=>[p[0]*scale[0],p[1]*scale[1]];
  const floor=[[120,365],[500,350],[580,367],[682,375],[682,430],[655,550],[610,575],[190,575],[120,540]];
  const furniture=[
    {name:'left bench',polygon:[[79,388],[218,329],[245,331],[245,418],[177,448],[79,449]]},
    {name:'back counters',polygon:[[211,299],[497,299],[497,359],[288,359],[211,370]]},
    {name:'pottery',polygon:[[495,275],[568,275],[576,307],[574,359],[495,359]]},
    {name:'repair crates',polygon:[[598,321],[663,334],[663,380],[598,369]]},
    {name:'assembly island',polygon:[[268,450],[438,411],[486,429],[486,498],[325,536],[273,520]]},
    {name:'island stool',polygon:[[378,498],[418,498],[418,542],[378,542]]},
    {name:'carving stump',polygon:[[176,501],[204,491],[240,501],[240,556],[220,562],[176,554]]},
    {name:'carving tools',polygon:[[239,511],[279,511],[279,570],[239,570]]},
    {name:'left baskets',polygon:[[100,480],[170,480],[170,550],[100,550]]},
    {name:'drawing desk and tall stool',polygon:[[507,418],[550,402],[651,448],[648,547],[610,557],[509,527]]},
    {name:'old bench stool',polygon:[[239,355],[269,355],[269,391],[239,391]]},
  ];
  const dockDefaults=[[256,437],[285,390],[365,389],[455,389],[590,386],[670,403],[451,394],[333,417],[205,476],[520,552]];
  const roomLayouts={
    dorm:{
      floor:[[700,375],[775,375],[920,383],[1110,398],[1265,390],[1300,420],[1300,575],[740,580],[700,520]],
      furniture:[
        {name:'cedar bunk',polygon:[[778,355],[895,350],[901,410],[782,430]]},
        {name:'patchwork bunk',polygon:[[954,365],[1087,374],[1087,431],[954,414]]},
        {name:'sofa',polygon:[[741,463],[824,452],[855,473],[852,531],[756,535],[738,504]]},
        {name:'flower-quilt bed',polygon:[[972,455],[1020,448],[1064,473],[1090,537],[1085,567],[990,562]]},
        {name:'hammock storage',polygon:[[1144,377],[1228,375],[1241,414],[1226,427],[1143,424]]},
        {name:'stove',polygon:[[1235,431],[1300,428],[1300,496],[1235,496]]},
        {name:'woven nest',polygon:[[1157,513],[1277,507],[1284,551],[1240,572],[1183,569],[1154,551]]},
        {name:'entry candle table',polygon:[[738,395],[775,395],[778,427],[738,432]]},
        {name:'bunk bedside table',polygon:[[901,350],[935,350],[935,400],[901,400]]},
        {name:'hammock candle table',polygon:[[1098,386],[1140,386],[1143,430],[1098,431]]},
        {name:'bed planter table',polygon:[[936,448],[980,448],[980,493],[936,493]]},
        {name:'bed candle table',polygon:[[1098,487],[1144,486],[1148,542],[1100,544]]},
      ],
      docks:[[918,433],[918,433],[932,433],[932,433],[1250,402],[950,511],[870,518],[1136,558],[911,450],[1164,456]],
      hops:{0:[[901,385],[901,337]],1:[[901,397]],2:[[947,378],[947,330]],3:[[948,404]],4:[[1242,366]]},
    },
    music:{
      floor:[[80,812],[482,810],[590,815],[684,815],[684,1015],[108,1020],[80,960]],
      furniture:[
        {name:'record console',polygon:[[295,755],[492,755],[492,803],[295,803]]},
        {name:'left chair',polygon:[[102,796],[182,790],[205,827],[192,863],[117,870],[91,845]]},
        {name:'rocking chair',polygon:[[531,815],[604,815],[622,836],[610,863],[537,863],[522,846]]},
        {name:'mustard chair',polygon:[[533,883],[603,866],[622,882],[622,940],[574,959],[531,938]]},
        {name:'green beanbag',polygon:[[235,914],[255,895],[307,893],[335,909],[341,944],[324,967],[268,978],[238,961],[226,939]]},
        {name:'red beanbag',polygon:[[370,906],[391,891],[439,890],[465,908],[477,941],[464,965],[409,977],[375,964],[359,941]]},
        {name:'floor cushion',polygon:[[482,949],[516,938],[548,950],[550,972],[527,989],[496,983],[480,970]]},
        {name:'cushioned bench',polygon:[[93,920],[147,906],[176,920],[176,973],[105,986],[88,973]]},
        {name:'left record crates',polygon:[[233,769],[296,769],[297,812],[236,820]]},
        {name:'right record crates',polygon:[[612,774],[649,774],[656,861],[625,860]]},
        {name:'entry planter',polygon:[[632,949],[665,948],[670,1000],[631,1000]]},
      ],
      docks:[[291,995],[420,995],[216,865],[640,884],[615,974],[208,896],[350,822],[480,828],[132,1005],[466,1001]],
    },
    mail:{
      floor:[[710,815],[770,815],[782,840],[1174,840],[1236,805],[1286,812],[1300,899],[1256,1005],[1000,1015],[750,1008],[715,960]],
      furniture:[
        {name:'sorting counter',polygon:[[780,781],[1158,781],[1158,839],[783,839]]},
        {name:'rolled-letter basket',polygon:[[786,816],[843,816],[851,834],[848,855],[789,854]]},
        {name:'green chair',polygon:[[747,875],[819,870],[840,887],[833,935],[775,947],[748,930]]},
        {name:'wooden chair',polygon:[[865,921],[921,914],[945,928],[945,973],[882,993],[861,977]]},
        {name:'cushioned bench',polygon:[[959,920],[1118,920],[1128,941],[1125,981],[966,984],[954,976]]},
        {name:'tall stool',polygon:[[1100,848],[1138,845],[1147,875],[1135,897],[1104,886]]},
        {name:'red stool',polygon:[[1195,895],[1236,891],[1247,913],[1244,940],[1200,937],[1191,919]]},
        {name:'doorstep planter',polygon:[[1274,820],[1305,820],[1305,886],[1270,889]]},
      ],
      docks:[[1165,893],[1258,952],[805,964],[949,994],[1003,998],[1070,998],[1254,851],[966,854],[1031,865],[1162,966]],
    },
  };
  const inside=(p,poly)=>{let hit=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;};
  function edgeDistance(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);}
  function create(rooms,room='workshop'){
    const layout=room==='workshop'?null:roomLayouts[room];
    if(room!=='workshop'&&!layout)throw Error('Unknown navigation room');
    const roomFloor=layout?.floor||floor,radius=8,grid=4,obstacles=(layout?.furniture||furniture).map(f=>({...f,polygon:f.polygon.map(p=>[...p])}));
    // Platforms occupy the floor even when their resident is in another room.
    if(room==='workshop')for(const s of rooms.workshop.spots){const p=s.render.platform;if(s.render.side!=='front'||!p)continue;const [x,y]=art(s.position),bottom=y+p.height*.78;obstacles.push({name:s.label+' platform',polygon:[[x-p.width*.38,bottom-15],[x+p.width*.38,bottom-15],[x+p.width*.38,bottom],[x-p.width*.38,bottom]]});}
    const clear=p=>inside(p,roomFloor)&&!obstacles.some(f=>inside(p,f.polygon)||f.polygon.some((a,i)=>edgeDistance(p,a,f.polygon[(i+1)%f.polygon.length])<radius));
    const crosses=(a,b,c,d)=>{
      if(Math.max(a[0],b[0])<Math.min(c[0],d[0])||Math.max(c[0],d[0])<Math.min(a[0],b[0])||Math.max(a[1],b[1])<Math.min(c[1],d[1])||Math.max(c[1],d[1])<Math.min(a[1],b[1]))return false;
      const turn=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);
      return turn(a,b,c)*turn(a,b,d)<=0&&turn(c,d,a)*turn(c,d,b)<=0;
    };
    const obstacleBounds=obstacles.map(f=>({left:Math.min(...f.polygon.map(p=>p[0]))-radius,right:Math.max(...f.polygon.map(p=>p[0]))+radius,top:Math.min(...f.polygon.map(p=>p[1]))-radius,bottom:Math.max(...f.polygon.map(p=>p[1]))+radius}));
    // Test the entire swept foot circle against every nearby furniture edge.
    // Sampling at intervals can miss a shallow graze around a polygon corner.
    const segment=(a,b)=>{
      if(!clear(a)||!clear(b))return false;
      if(roomFloor.some((c,i)=>crosses(a,b,c,roomFloor[(i+1)%roomFloor.length])))return false;
      for(let j=0;j<obstacles.length;j++){
        const bounds=obstacleBounds[j];if(Math.max(a[0],b[0])<bounds.left||Math.min(a[0],b[0])>bounds.right||Math.max(a[1],b[1])<bounds.top||Math.min(a[1],b[1])>bounds.bottom)continue;
        const poly=obstacles[j].polygon;
        for(let i=0;i<poly.length;i++){const c=poly[i],d=poly[(i+1)%poly.length];if(crosses(a,b,c,d)||Math.min(edgeDistance(a,c,d),edgeDistance(b,c,d),edgeDistance(c,a,b),edgeDistance(d,a,b))<radius)return false;}
      }
      return true;
    };
    const bounds=layout?{left:Math.ceil(Math.min(...roomFloor.map(p=>p[0]))/grid)*grid,right:Math.max(...roomFloor.map(p=>p[0])),top:Math.ceil(Math.min(...roomFloor.map(p=>p[1]))/grid)*grid,bottom:Math.max(...roomFloor.map(p=>p[1]))}:{left:132,right:678,top:378,bottom:570};
    const nodes=[],index=new Map();for(let y=bounds.top;y<=bounds.bottom;y+=grid)for(let x=bounds.left;x<=bounds.right;x+=grid){const p=[x,y];if(clear(p)){index.set(p.join(','),nodes.length);nodes.push(p);}}
    let reachable=null;
    const nearest=p=>{let best=null,d=Infinity;for(let i=0;i<nodes.length;i++){if(reachable&&!reachable.has(i))continue;const n=nodes[i],dd=Math.hypot(p[0]-n[0],p[1]-n[1]);if(dd<d){d=dd;best=n;}}if(!best)throw Error('No '+room+' floor route');return clear(p)&&(!layout||segment(p,best))?p:[...best];};
    const neighborCache=new Map();
    function neighbors(i){if(neighborCache.has(i))return neighborCache.get(i);const p=nodes[i],out=[];for(let dy=-grid;dy<=grid;dy+=grid)for(let dx=-grid;dx<=grid;dx+=grid){if(!dx&&!dy)continue;const j=index.get([p[0]+dx,p[1]+dy].join(','));if(j!==undefined&&segment(p,nodes[j]))out.push(j);}neighborCache.set(i,out);return out;}
    function gridNode(p){let best=-1,d=Infinity;for(let i=0;i<nodes.length;i++){const dd=Math.hypot(p[0]-nodes[i][0],p[1]-nodes[i][1]);if(dd<d&&segment(p,nodes[i])){d=dd;best=i;}}if(best<0)throw Error('Unreachable workshop floor anchor');return best;}
    function path(start,end){
      if(!clear(start)||!clear(end))throw Error('Workshop walking endpoint is in furniture');
      if(segment(start,end))return [start,end];
      const first=gridNode(start),last=gridNode(end),open=new Set([first]),cost=new Map([[first,0]]),parent=new Map();
      while(open.size){let current=-1,best=Infinity;for(const i of open){const score=cost.get(i)+Math.hypot(nodes[i][0]-nodes[last][0],nodes[i][1]-nodes[last][1]);if(score<best){best=score;current=i;}}
        if(current===last){const raw=[end,nodes[last]];while(parent.has(current)){current=parent.get(current);raw.push(nodes[current]);}raw.push(start);raw.reverse();const smooth=[raw[0]];for(let i=0;i<raw.length-1;){let j=raw.length-1;while(j>i+1&&!segment(raw[i],raw[j]))j--;smooth.push(raw[j]);i=j;}return smooth;}
        open.delete(current);for(const j of neighbors(current)){const next=cost.get(current)+Math.hypot(nodes[j][0]-nodes[current][0],nodes[j][1]-nodes[current][1]);if(next<(cost.get(j)??Infinity)){cost.set(j,next);parent.set(j,current);open.add(j);}}
      }
      throw Error('No furniture-free workshop route');
    }
    if(layout){const first=gridNode(art(rooms[room].portal)),queue=[first];reachable=new Set(queue);for(let i=0;i<queue.length;i++)for(const j of neighbors(queue[i]))if(!reachable.has(j)){reachable.add(j);queue.push(j);}}
    const docks=(layout?.docks||dockDefaults).map((p,id)=>{if(layout)return nearest(p);const s=rooms.workshop.spots[id],delta=art(s.position).map((v,i)=>v-s.render.at[i]);return nearest(p.map((v,i)=>v+delta[i]));});
    return {room,radius,obstacles,floor:roomFloor,clear,segment,path,docks,art,world,walk:(start,end)=>path(art(start),art(end)).slice(1).map(p=>{const [x,y]=world(p);return {x,y,kind:'walk'};}),dock:id=>world(docks[id]),stationPath:id=>[world(docks[id]),...(layout?.hops?.[id]||[]).map(world),[...rooms[room].seats[id]]]};
  }
  return{create,furniture,floor,roomLayouts,art,world};
}
