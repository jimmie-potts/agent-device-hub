export function createModel() {
  function roomFor(agent, music, previousRoom = 'dorm') {
    switch (agent.state) {
      case 'working': case 'question': return 'workshop';
      case 'approval': case 'input': return 'mail';
      case 'finished': return 'mail';
      case 'unknown': case 'interrupted': return previousRoom;
      default: return music ? 'music' : 'dorm';
    }
  }
  function poseFor(agent, room, music) {
    const place=rooms[room]?.spots?.[agent.id];
    const waitingPose=place?.type==='rug'?'curled':['chair','stool','bench','beanbag','cushion'].includes(place?.type)?'waiting-seated':'waiting';
    if (agent.state === 'unknown' || agent.state === 'interrupted') return room==='dorm'?'curled':waitingPose;
    if (agent.state === 'working' || agent.state === 'question') return 'working';
    if (agent.state === 'approval' || agent.state === 'input' || agent.state === 'finished') return waitingPose;
    if (room === 'dorm') return 'sleeping';
    if(music&&room==='music')return place?.type==='dance'?'dancing':place?.type==='rug'?'curled':'listening';
    return 'idle';
  }
  // Art coordinates anchor each resident to one of the ten physical places.
  const point=(x,y)=>[Math.round(x*1600/1341),Math.round(y*1400/1173)];
  const spot=(type,label,x,y,facing=1)=>({type,label,position:point(x,y),facing});
  const room=(name,portal,spots)=>({name,portal,spots,seats:spots.map(s=>s.position)});
  const rooms = {
    workshop:room('Workshop',point(674,385),[
      spot('workbench','Left woodworking corner',140,370),spot('workbench','Back tool bench',252,309),
      spot('workbench','Clockwork workbench',360,306),spot('desk','Plant-side repair counter',450,321),
      spot('pottery','Pottery wheel',538,303),spot('repair','Standing repair shelf',633,340,-1),
      spot('table','Assembly island end',424,448),spot('table','Woodcarving table',340,438),
      spot('stump','Carving stump',211,531),spot('desk','Drawing desk',566,469),
    ]),
    dorm:room('Sleeping area',point(713,385),[
      spot('bunk','Upper cedar bunk',827,280),spot('bunk','Lower cedar bunk',819,366),
      spot('bunk','Upper patchwork bunk',1014,294),spot('bunk','Lower patchwork bunk',1025,379),
      spot('hammock','Hanging hammock',1190,343,-1),spot('bed','Flower-quilt bed',1035,507),
      spot('sofa','Reading alcove',791,482),spot('nest','Woven sleeping basket',1207,523,-1),
      spot('rug','Round straw mat',888,435),spot('rug','Fireside rug',1143,433,-1),
    ]),
    music:room('Music room',point(674,830),[
      spot('beanbag','Moss beanbag',288,952),spot('beanbag','Terracotta beanbag',413,947),
      spot('chair','Green armchair',137,805),spot('chair','Wooden rocking chair',577,795,-1),
      spot('chair','Mustard armchair',588,926,-1),spot('rug','Curl-up rug',211,905),
      spot('dance','Dance beside the horn',350,818),spot('dance','Dance by the record shelves',480,826,-1),
      spot('bench','Little cushioned bench',130,949),spot('cushion','Small floor cushion',500,975,-1),
    ]),
    mail:room('Mailroom',point(720,830),[
      spot('stool','High sorting stool',1124,849),spot('stool','Low red stool',1220,916,-1),
      spot('chair','Green waiting armchair',777,889),spot('chair','Wooden letter chair',902,950),
      spot('bench','Bench by the cushions',1001,953),spot('bench','Bench by the quilt',1086,951,-1),
      spot('standing','Doorway waiting nook',1259,788,-1),spot('standing','Sorting counter',971,809),
      spot('rug','Quiet corner mat',861,826),spot('rug','Front woven rug',1171,974,-1),
    ]),
  };
  // Visual feet anchors, facing, arrival lanes and foreground furniture in art pixels.
  const musicDetails=[
    {at:[292,936],width:100,frame:14,approach:[[350,857],[350,978],[292,974]],front:[]},
    {at:[420,933],width:100,frame:14,approach:[[491,856],[491,978],[420,973]],front:[]},
    {at:[156,835],width:96,frame:12,approach:[[350,850],[214,851],[177,862]],frontDepth:855,front:[[[111,792],[120,791],[134,796],[145,804],[148,810],[144,817],[136,819],[120,814],[112,806]]]},
    {at:[570,806],width:96,frame:12,approach:[[611,872],[570,859]],frontOverSeated:true,frontDepth:852,front:[[[560,794],[568,790],[582,788],[597,783],[600,785],[600,792],[590,798],[578,802],[567,804],[559,801]]]},
    {at:[562,904],width:90,frame:16,layout:'rear-facing-v1',approach:[[638,935],[552,937]],frontOverSeated:true,frontDepth:925,visibleBottomOffset:48,front:[[[565,852],[603,838],[615,837],[623,845],[624,857],[620,895],[570,910],[562,902]],[[525,864],[533,857],[570,874],[574,881],[570,911],[527,897]]]},
    {at:[211,905],width:90,frame:9,approach:[[350,851],[211,866]],front:[]},
    {at:[350,822],width:90,frame:10,approach:[[490,853],[350,859]],front:[]},
    {at:[480,828],width:90,frame:10,approach:[[491,859]],front:[]},
    {at:[132,933],width:96,frame:12,approach:[[350,852],[206,868],[180,966],[132,964]],front:[]},
    {at:[518,955],width:82,frame:18,layout:'rear-facing-v1',approach:[[628,982],[570,987],[518,987]],front:[]},
  ];
  rooms.music.spots.forEach((s,id)=>{
    const detail=musicDetails[id];s.position=point(...detail.at);s.render=detail;
    if([0,2,4,8,9].includes(id))s.facing=1;else if(id===1||id===3)s.facing=-1;
  });
  rooms.music.seats=rooms.music.spots.map(s=>s.position);
  const workshopDetails=[
    {at:[215,390],width:88,frames:[20,21],facing:-1,side:'front',platform:{width:58,height:58},approach:[[620,405],[550,535],[270,466],[240,425]]},
    {at:[270,332],width:84,frames:[20,21],facing:1,side:'front',platform:{width:56,height:48},approach:[[620,405],[550,365],[285,374]]},
    {at:[365,328],width:84,frames:[20,21],facing:1,side:'front',platform:{width:56,height:48},approach:[[620,405],[550,365],[365,374]]},
    {at:[455,332],width:84,frames:[20,21],facing:1,side:'front',platform:{width:56,height:48},approach:[[620,405],[550,365],[455,374]]},
    {at:[561,318],width:84,frames:[22,23],facing:1,side:'front',platform:{width:55,height:62},approach:[[620,405],[585,371]]},
    {at:[631,370],width:84,frames:[3,7],facing:-1,side:'front',platform:{width:52,height:34},approach:[[650,405],[650,394]]},
    {at:[442,445],width:86,frames:[3,7],facing:1,side:'behind-island',platform:{width:54,height:44},approach:[[620,405],[550,380],[490,383]]},
    {at:[333,472],width:86,frames:[3,7],facing:1,side:'behind-island',platform:{width:54,height:44},approach:[[620,405],[550,380],[337,398]]},
    {at:[205,508],width:86,frames:[3,7],facing:1,side:'behind-stump',platform:{width:52,height:35},approach:[[620,405],[550,535],[279,574],[161,570]]},
    {at:[539,457],width:88,frames:[24,25],facing:1,side:'front',platform:null,approach:[[620,405],[617,520],[580,533]]},
  ];
  rooms.workshop.spots.forEach((s,id)=>{const detail=workshopDetails[id];s.position=point(...detail.at);s.facing=detail.facing;s.render={...detail,layout:id===8?'carver-behind-v2':id===9?'drafting-stool-v2':'workshop-supported-v2'};if(id<4)s.render.platform.facing=-1;if(id>=1&&id<=3){s.render.platform.variant='front';s.render.platform.facing=1;}});
  rooms.workshop.seats=rooms.workshop.spots.map(s=>s.position);
  const dormDetails=[
    {at:[853,288],width:104,facing:-1}, {at:[824,369],width:102,facing:1},
    {at:[1011,302],width:104,facing:1}, {at:[1028,383],width:102,facing:-1},
    {at:[1195,347],width:96,facing:-1}, {at:[1016,480],width:100,facing:1},
    {at:[791,482],width:100,facing:1}, {at:[1212,520],width:98,facing:1},
    {at:[872,423],width:94,facing:1}, {at:[1156,433],width:92,facing:-1},
  ];
  rooms.dorm.spots.forEach((s,id)=>{const detail=dormDetails[id];s.position=point(...detail.at);s.facing=detail.facing;s.render={...detail,frame:4,layout:'sleeping-places-v1'};});
  // Pose offsets change how the new sprite fits its bedding, not the owner's
  // saved X/Y, facing preferences or sleeping-place layout version.
  Object.assign(rooms.dorm.spots[0].render,{frame:4,sleepWidth:90,sleepOffset:[-4,-5],sleepFacing:-1,sleepAngle:-5,variant:'bunk-curled',badgeOffset:-57});
  Object.assign(rooms.dorm.spots[1].render,{frame:27,sleepWidth:110,sleepOffset:[2,-3],sleepFacing:1,sleepAngle:-8,variant:'bunk-back',badgeOffset:-54});
  Object.assign(rooms.dorm.spots[2].render,{frame:26,sleepWidth:84,sleepOffset:[35,23],sleepFacing:1,sleepAngle:-50,variant:'bunk-reclined',badgeOffset:-62});
  Object.assign(rooms.dorm.spots[3].render,{frame:4,sleepWidth:88,sleepOffset:[5,-5],sleepFacing:-1,sleepAngle:5,variant:'bunk-side',badgeOffset:-57});
  Object.assign(rooms.dorm.spots[4].render,{frame:27,sleepWidth:110,sleepOffset:[0,1],sleepFacing:-1,sleepClip:[[0,85],[45,85],[50,101],[44,116],[34,128],[0,128]],variant:'hammock-back',badgeOffset:-75});
  Object.assign(rooms.dorm.spots[5].render,{frame:26,sleepWidth:96,sleepOffset:[5,24],sleepFacing:1,variant:'bed-lengthwise',badgeOffset:-104});
  // Only the head rises above these covers. Clip in sprite coordinates so
  // the torso cannot reappear through a gap when the owner nudges a place.
  const tuckedHead=[[0,0],[96,0],[96,60],[76,60],[69,64],[55,68],[39,73],[29,72],[23,68],[0,68]];
  Object.assign(rooms.dorm.spots[5].render,{sleepClip:tuckedHead});
  Object.assign(rooms.dorm.spots[6].render,{frame:26,sleepWidth:96,sleepOffset:[51,-39],sleepFacing:-1,sleepAngle:90,variant:'sofa-reclined',badgeOffset:-18});
  rooms.dorm.seats=rooms.dorm.spots.map(s=>s.position);
  const mailDetails=[
    {at:[1122,835],width:90,frame:8,approach:[[1180,850],[1170,900],[1146,902]]},
    {at:[1222,895],width:88,frame:8,approach:[[1180,850],[1265,875],[1245,935]]},
    {at:[788,903],width:96,frame:8,frontOverSeated:true,approach:[[850,926],[811,940]]},
    {at:[897,943],width:90,frame:16,approach:[[936,870],[936,974],[909,978]]},
    {at:[1003,951],width:90,frame:8,approach:[[950,870],[950,983],[1003,984]]},
    {at:[1068,951],width:88,frame:12,approach:[[950,870],[950,1000],[1090,1000]]},
    {at:[1254,813],width:86,frame:6,approach:[[1180,850],[1256,848]]},
    {at:[966,849],width:86,frame:6,approach:[[966,850]]},
    {at:[1031,865],width:82,frame:9,approach:[[990,850],[1031,879]]},
    {at:[1162,966],width:84,frame:9,approach:[[950,870],[950,1000],[1162,1000]]},
  ];
  rooms.mail.spots.forEach((s,id)=>{const detail=mailDetails[id];s.position=point(...detail.at);s.render={...detail,layout:'mail-places-v1'};});
  rooms.mail.spots[8].label='Green sorting rug';
  rooms.mail.seats=rooms.mail.spots.map(s=>s.position);
  const mailFront=[
    {label:'Sorting counter',owners:[],depth:841,polygons:[[[780,757],[1142,755],[1158,765],[1158,785],[1146,787],[1146,837],[785,839],[782,787]]]},
    // The chair's right arm is on the viewer's left, beside the candle table.
    {label:'Green chair near arm',owners:[2],depth:936,polygons:[[[751,873],[758,871],[778,876],[787,877],[794,882],[797,889],[796,911],[795,924],[787,930],[776,925],[775,902],[774,893],[758,890],[751,885]]]},
    {label:'Wooden chair back',owners:[3],depth:986,polygons:[[[869,875],[877,874],[877,921],[908,931],[908,884],[916,883],[918,947],[910,953],[867,938]],[[880,891],[888,894],[888,929],[880,926]],[[895,895],[902,898],[902,934],[895,931]]]},
    {label:'Bench front lip',owners:[4,5],depth:986,polygons:[[[962,937],[1117,939],[1118,950],[1080,955],[962,951]]]},
    {label:'Doorstep plant',owners:[],depth:887,polygons:[[[1270,811],[1292,799],[1304,816],[1300,879],[1284,889],[1270,878]],[[1263,810],[1270,799],[1282,797],[1285,806],[1276,815]]]},
  ];
  mailFront.find(f=>f.label==='Green chair near arm').walkingPolygons=[[[739,845],[755,826],[782,816],[812,823],[821,851],[836,860],[838,876],[832,890],[832,929],[814,939],[776,935],[762,912],[744,901]]];
  mailFront.find(f=>f.label==='Wooden chair back').walkingPolygons=[[[865,874],[876,872],[915,882],[918,912],[944,921],[946,965],[932,980],[878,990],[862,974]]];
  mailFront.find(f=>f.label==='Bench front lip').walkingPolygons=[[[966,916],[985,912],[1102,914],[1122,924],[1123,972],[1111,987],[965,986],[956,975],[958,941]]];
  mailFront.push(
    {label:'Tall stool',owners:[],depth:897,polygons:[[[1098,802],[1115,795],[1136,799],[1147,808],[1140,831],[1145,888],[1134,897],[1104,888],[1097,879],[1101,825]]]},
    {label:'Red stool',owners:[],depth:938,polygons:[[[1194,875],[1208,867],[1235,872],[1248,883],[1243,904],[1248,931],[1236,938],[1200,930],[1192,921],[1197,895]]]},
  );
  // Near rails, sling and basket weave sit in front of the sleeper; the
  // original mattress, pillow and backrest remain behind the whole sprite.
  const dormFront=[
    {label:'Upper cedar guard',owners:[0],depth:324,polygons:[[[783,283],[849,278],[851,285],[784,292]],[[781,306],[891,290],[891,303],[782,323]],[[784,270],[793,269],[794,319],[784,322]]]},
    {label:'Lower cedar frame',owners:[1],depth:400,polygons:[[[781,382],[889,363],[890,378],[781,398]],[[781,310],[790,309],[791,396],[781,402]]]},
    {label:'Upper patchwork rail',owners:[2],depth:339,polygons:[[[958,310],[1074,325],[1075,337],[958,323]],[[1074,291],[1083,292],[1084,338],[1074,338]]]},
    {label:'Lower patchwork frame',owners:[3],depth:412,polygons:[[[959,379],[1077,397],[1077,411],[958,394]],[[1074,336],[1085,338],[1085,410],[1075,412]]]},
    {label:'Hammock front sling',owners:[4],depth:360,polygons:[[[1135,314],[1164,326],[1188,330],[1209,324],[1239,303],[1252,420],[1130,420]]]},
    {label:'Bed green blanket fold',owners:[5],depth:552,polygons:[[[980,468],[1000,460],[1025,461],[1047,469],[1062,478],[1067,489],[1086,534],[1084,546],[1018,537],[996,549]]]},
    {label:'Flower quilt and footboard',owners:[5],depth:552,polygons:[[[982,481],[1002,475],[1039,481],[1063,490],[1086,533],[1084,545],[1072,540],[1054,542],[1018,536],[996,548]],[[996,542],[1082,549],[1082,557],[996,551]]]},
    {label:'Sofa near arm',owners:[6],depth:530,polygons:[[[835,461],[845,456],[851,461],[850,473],[845,480],[844,502],[835,511],[829,509],[831,480]],[[756,494],[784,497],[817,490],[821,503],[784,516],[755,509]]]},
    {label:'Woven nest front rim',owners:[7],depth:560,polygons:[[[1160,518],[1174,524],[1203,531],[1234,530],[1262,520],[1275,507],[1277,532],[1269,543],[1247,554],[1205,560],[1175,551],[1159,537]]]},
  ];
  // Full silhouettes apply only to floor travel. Seated and tucked poses keep
  // their established near-arm, rail and blanket masks above.
  const travelFront={
    dorm:[
      {depth:432,polygons:[[[730,390],[747,383],[759,385],[777,394],[782,403],[778,425],[767,431],[739,429],[731,420]],[[749,376],[751,367],[754,369],[757,378],[757,390],[750,391]]]},
      {depth:535,polygons:[[[741,420],[758,414],[789,418],[800,432],[822,440],[837,437],[849,444],[855,456],[853,487],[849,509],[844,521],[819,525],[777,532],[754,526],[744,511],[735,479],[731,453]]]},
      {depth:410,polygons:[[[778,270],[785,258],[797,258],[799,276],[851,266],[857,252],[867,252],[867,325],[887,322],[887,250],[899,246],[904,258],[901,399],[888,410],[781,431]]]},
      {depth:431,polygons:[[[953,276],[961,264],[973,264],[974,286],[1054,297],[1073,282],[1086,285],[1088,415],[1078,431],[957,412]]]},
      {depth:400,polygons:[[[901,335],[916,331],[934,341],[936,392],[929,400],[903,397]]]},
      {depth:493,polygons:[[[936,448],[944,444],[970,447],[979,457],[980,486],[972,493],[938,487]],[[946,439],[941,430],[947,421],[955,414],[965,419],[974,427],[971,441],[960,450],[949,446]]]},
      {depth:542,polygons:[[[1098,489],[1111,482],[1138,487],[1148,498],[1144,536],[1136,542],[1101,538]],[[1114,481],[1115,465],[1120,461],[1125,467],[1126,486]]]},
      {depth:567,polygons:[[[972,463],[982,453],[998,453],[1016,448],[1049,453],[1065,473],[1089,530],[1088,553],[1079,566],[993,563],[982,549],[978,504]]]},
      {depth:431,polygons:[[[1097,389],[1116,382],[1136,391],[1143,402],[1141,424],[1130,432],[1100,426]],[[1111,385],[1112,367],[1116,362],[1120,370],[1120,391]]]},
      {depth:427,polygons:[[[1145,379],[1158,373],[1225,376],[1239,390],[1241,415],[1228,428],[1145,422]]]},
      {depth:496,polygons:[[[1236,397],[1250,393],[1289,403],[1300,419],[1298,481],[1282,497],[1240,486]]]},
      {depth:572,polygons:[[[1155,520],[1161,507],[1179,498],[1201,495],[1233,497],[1256,504],[1277,517],[1283,537],[1275,553],[1247,568],[1204,573],[1174,561],[1156,545]]]},
    ],
    music:[
      {depth:870,polygons:[[[96,785],[104,761],[126,746],[151,741],[167,747],[177,773],[192,772],[202,782],[205,795],[200,813],[196,851],[185,864],[155,872],[119,866],[109,852],[102,815],[94,803]]]},
      {depth:863,polygons:[[[528,785],[538,777],[548,779],[564,728],[577,731],[576,739],[605,746],[610,737],[620,740],[625,749],[608,807],[611,836],[622,842],[622,849],[608,862],[584,864],[526,849],[522,838],[526,830],[534,828],[537,813],[521,805]]]},
      {depth:959,polygons:[[[532,865],[545,858],[563,864],[576,844],[611,832],[623,838],[622,922],[627,941],[621,951],[612,943],[609,925],[579,937],[580,954],[573,960],[569,948],[538,931],[534,943],[528,941],[531,922],[528,889]]]},
      {depth:978,polygons:[[[226,932],[233,910],[252,889],[278,877],[306,882],[328,897],[340,920],[343,944],[333,964],[308,975],[265,979],[239,966],[228,949]]]},
      {depth:977,polygons:[[[359,931],[369,908],[388,886],[415,869],[439,873],[460,890],[474,912],[479,940],[469,961],[445,974],[405,978],[378,967],[363,951]]]},
      {depth:989,polygons:[[[482,950],[489,936],[506,923],[525,920],[542,928],[550,942],[551,967],[540,982],[523,990],[496,984],[482,971]]]},
      {depth:986,polygons:[[[87,903],[100,891],[133,887],[165,898],[179,913],[178,962],[170,980],[164,981],[161,943],[109,930],[109,982],[101,987],[96,981],[95,931],[88,925]]]},
      {depth:1000,polygons:[[[632,951],[641,942],[658,943],[668,953],[670,983],[662,997],[646,1002],[634,990]],[[639,948],[628,936],[631,924],[638,926],[646,937],[647,923],[653,910],[661,915],[659,931],[671,925],[676,934],[662,949]]]},
    ],
    mail:[
      {depth:855,polygons:[[[786,819],[794,811],[806,811],[810,798],[816,795],[822,799],[820,813],[830,805],[835,810],[834,818],[844,818],[851,828],[849,850],[836,857],[797,853],[788,845]],[[789,815],[784,798],[788,795],[794,796],[798,811]],[[799,815],[795,800],[799,797],[805,799],[808,815]]]},
      {depth:936,polygons:[[[729,883],[737,876],[756,875],[768,883],[769,925],[760,936],[739,932],[730,922]],[[746,874],[746,857],[751,852],[756,860],[755,879]]]},
      {depth:848,polygons:[[[1160,804],[1171,800],[1190,805],[1204,814],[1204,839],[1191,848],[1160,845]],[[1172,803],[1170,789],[1175,781],[1181,784],[1186,796],[1183,807]]]},
    ],
  };
  // Furniture silhouettes and the floor depth at which a bunny passes in front.
  const workshopFront=[
    {label:'Left bench',depth:432,polygons:[[[79,388],[218,329],[245,331],[245,348],[182,406],[177,418],[79,419]]]},
    {label:'Back tool bench',depth:360,polygons:[[[214,325],[290,301],[407,301],[407,355],[288,355],[214,366]]]},
    {label:'Repair counter',depth:359,polygons:[[[407,304],[496,304],[496,355],[407,355]]]},
    {label:'Pottery wheel and bowl',depth:359,polygons:[[[495,302],[514,291],[551,293],[568,304],[567,318],[568,319],[566,348],[550,352],[539,354],[539,322],[512,320],[495,311]],[[515,281],[519,274],[540,275],[548,282],[546,296],[539,303],[524,301]]]},
    {label:'Repair crates',depth:379,polygons:[[[599,330],[617,323],[639,334],[639,352],[623,366],[599,357]],[[635,350],[648,345],[660,352],[661,374],[641,380]]]},
    {label:'Assembly island',depth:538,polygons:[[[273,452],[375,427],[438,411],[483,429],[483,445],[326,485],[273,468]],[[276,468],[287,472],[287,512],[278,518],[276,516]],[[306,481],[326,485],[326,529],[317,532],[307,529]],[[456,450],[476,446],[476,491],[466,497],[456,493]],[[287,478],[365,476],[367,504],[326,516],[305,507],[287,513]],[[425,458],[444,456],[449,463],[449,484],[436,495],[418,489],[418,470]]]},
    {label:'Carving stump',depth:560,polygons:[[[170,497],[176,492],[187,487],[205,485],[224,488],[235,492],[241,498],[243,547],[237,559],[221,567],[193,567],[176,562],[168,551]]]},
    {label:'Foreground desk lamp',depth:490,polygons:[[[608,371],[610,370],[612,372],[612,375],[610,377],[610,381],[612,383],[611,386],[605,386],[604,384],[607,380],[608,376]],[[603,384],[613,384],[615,387],[619,389],[620,392],[617,395],[604,396],[599,393],[599,389],[602,387]],[[601,394],[616,394],[619,398],[622,403],[625,412],[624,418],[620,422],[602,423],[596,419],[595,413],[597,404]],[[595,418],[598,422],[620,422],[625,419],[626,426],[622,430],[614,432],[601,431],[595,428]]]},
    {label:'Drawing desk',depth:547,polygons:[
      [[509,418],[550,402],[651,448],[651,465],[586,478],[509,434]],
      [[509,432],[521,438],[522,508],[515,517],[507,512]],
      [[581,470],[597,474],[597,537],[589,543],[580,535]],
      [[630,469],[645,465],[644,536],[637,544],[629,540]],
    ]},
    // These silhouettes rise above the desktop and must also cover travellers.
    {label:'Drawing desk pen cup',depth:547,polygons:[
      [[549,383],[555,381],[568,381],[573,385],[573,407],[570,413],[560,415],[550,411]],
      [[549,367],[551,366],[553,372],[553,377],[558,386],[554,388],[550,378],[547,372]],
      [[557,366],[560,365],[561,367],[561,384],[558,388]],
      [[562,368],[564,366],[566,368],[565,386],[562,387]],
      [[570,369],[573,369],[575,372],[574,376],[572,379],[570,387],[566,387],[568,377]],
    ]},
    {label:'Drawing desk brass tools',depth:547,polygons:[
      [[625,426],[639,426],[638,435],[636,439],[636,443],[640,445],[640,449],[633,451],[624,450],[621,447],[622,443],[626,439]],
      [[628,390],[632,388],[634,389],[634,394],[630,401],[629,414],[628,427],[624,427],[626,407],[626,397]],
      [[635,398],[638,398],[640,400],[639,407],[637,413],[635,426],[630,427],[633,411]],
      [[640,408],[643,408],[646,412],[645,417],[641,421],[639,427],[635,428],[638,416]],
      [[623,400],[625,402],[626,414],[625,426],[621,426]],
    ]},
  ];
  function musicApproach(id){return [[642,844],[642,878],...rooms.music.spots[id].render.approach].map(p=>point(...p));}
  function workshopApproach(id){return rooms.workshop.spots[id].render.approach.map(p=>point(...p));}
  function mailApproach(id){return [[760,850],[860,850],...rooms.mail.spots[id].render.approach].map(p=>point(...p));}
  function bodyBoundsFor(agent,room,music){
    const [x,y]=rooms[room].seats[agent.id],pose=poseFor(agent,room,music);
    const musicPlace=room==='music'?rooms.music.spots[agent.id]:null;
    if(room==='dorm'){const w=rooms.dorm.spots[agent.id].render.width;return {left:x-w*.4,right:x+w*.4,top:y-(pose==='sleeping'?w*.65:w*.85),bottom:y};}
    if(room==='workshop'){
      const detail=rooms.workshop.spots[agent.id].render;
      return {left:x-detail.width*.34,right:x+detail.width*.34,top:y-detail.width*4/3,bottom:y};
    }
    if(room==='mail'){
      // Head and torso clearance follows the tailored poses. Ear tips and
      // the transparent padding in the atlas are outside these body boxes.
      const width=rooms.mail.spots[agent.id].render.width,w=width*(pose==='curled'?.9:.78),h=width*(pose==='curled'?.65:1);
      return {left:x-w/2,right:x+w/2,top:y-h,bottom:y};
    }
    const w=musicPlace?['chair','bench'].includes(musicPlace.type)?70:musicPlace.type==='cushion'?66:musicPlace.render.width:pose==='sleeping'||pose==='dancing'?100:90;
    const h=pose==='sleeping'?65:pose==='curled'?63:pose==='dancing'?130:musicPlace?.type==='beanbag'?95:musicPlace?.type==='cushion'?100:musicPlace?114:120;
    return {left:x-w/2,right:x+w/2,top:y-h,bottom:y-(musicPlace?.render.visibleBottomOffset||0)};
  }
  return {roomFor, poseFor, bodyBoundsFor, musicApproach, workshopApproach, mailApproach, workshopFront, dormFront, mailFront, travelFront, rooms, world:{width:1600,height:1400}};
}
