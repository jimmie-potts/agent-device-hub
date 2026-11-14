import type {ApartmentImage,ApartmentModel,ApartmentObject,ApartmentOpening,ApartmentPoint,ApartmentRoom,ApartmentWall} from '../../src/apartment-model.ts';

/** A split synthetic floor plan, including a concave room and coincident walls. */
export function furnishedFixture(image:ApartmentImage):ApartmentModel {
  const wall=(id:string,start:ApartmentPoint,end:ApartmentPoint,openings:ApartmentOpening[]=[]):ApartmentWall=>
    ({id,start,end,openings,source:'inferred',height:2.75,thickness:.14});
  const door:ApartmentOpening={id:'door',kind:'door',offset:1.96,width:.98,bottom:0,height:2.14,source:'measured'};
  const window=(id:string,offset:number,width:number):ApartmentOpening=>({id,kind:'window',offset,width,bottom:.92,height:1.24,source:'measured'});
  const studio:ApartmentRoom={id:'studio',floorY:0,source:'inferred',footprint:[[0,0],[4.5,0],[4.5,4.45],[0,4.45]],
    scan:{id:'studio-sample',yaw:.04,translation:[.12,0,.15]},walls:[
      wall('north',[0,0],[4.5,0],[window('north-window',.42,1.36)]),wall('partition',[4.5,0],[4.5,4.45],[door]),
      wall('south',[4.5,4.45],[0,4.45],[window('south-window',1.8,1.68)]),wall('west',[0,4.45],[0,0]),
    ]};
  const reading:ApartmentRoom={id:'reading',floorY:0,source:'unresolved',footprint:[[4.5,0],[8.1,0],[8.1,3.25],[7,3.25],[7,4.45],[4.5,4.45]],scan:null,walls:[
    wall('north',[4.5,0],[8.1,0]),wall('east',[8.1,0],[8.1,3.25],[window('east-window',1.12,1.45)]),wall('notch-north',[8.1,3.25],[7,3.25]),
    wall('notch-east',[7,3.25],[7,4.45]),wall('south',[7,4.45],[4.5,4.45]),
    wall('partition',[4.5,4.45],[4.5,0],[{...door,offset:1.51}]),
  ]};
  const furniture=(id:string,roomId:string,form:Extract<ApartmentObject,{kind:'furniture'}>['form'],position:ApartmentObject['position'],size:ApartmentObject['size'],yaw=0):ApartmentObject=>
    ({kind:'furniture',id,roomId,form,label:id,position,size,yaw,source:'inferred'});
  return {schema:'apartment-model/1.0',calibration:{planId:'disposable-plan',planUnits:450,referenceMeters:4.5,source:'measured',orientation:'confirmed'},
    rooms:[studio,reading],artwork:[image],objects:[
      furniture('woven-rug','studio','rug',[2.42,.022,2.16],[2.65,.04,2.2]),
      furniture('settee','studio','sofa',[2.8,.49,.67],[2.45,.98,1.02]),
      furniture('lounge-chair','studio','chair',[.78,.52,2.45],[.88,1.04,.90],1.2),
      furniture('coffee-table','studio','table',[2.31,.23,2.24],[1.18,.46,.68]),
      furniture('studio-desk','studio','desk',[3.31,.48,3.89],[1.78,.96,.68],Math.PI),
      furniture('study-chair','studio','chair',[3.32,.41,3.23],[.55,.82,.56],Math.PI),
      furniture('bookcase','reading','shelf',[5.26,.89,.28],[1.17,1.78,.48]),
      furniture('sample-bed','reading','bed',[6.79,.54,1.37],[1.65,1.08,2.26]),
      furniture('end-cabinet','reading','cabinet',[5.29,.38,3.75],[1.12,.76,.80]),
      {kind:'artwork',id:'color-print',roomId:'studio',label:'Abstract sun print',position:[2.82,1.83,0],size:[.87,1.1,.066],yaw:0,source:'measured',asset:image.id},
      {kind:'artwork',id:'study-print',roomId:'reading',label:'Reading room print',position:[7.18,1.89,0],size:[.65,.83,.05],yaw:0,source:'unresolved',asset:null},
      {kind:'fixture',id:'sample-floor-light',roomId:'studio',label:'Studio floor light',form:'floor',position:[.58,.72,.89],size:[.41,1.44,.41],yaw:0,source:'measured',deviceId:'lamp-a',owner:'bunny/modules/lifx'},
      {kind:'fixture',id:'sample-sconce',roomId:'reading',label:'Reading wall light',form:'wall',position:[5.62,1.99,0],size:[.28,.35,.28],yaw:0,source:'measured',deviceId:'lamp-b',owner:'bunny/modules/lifx'},
      {kind:'fixture',id:'sample-table-light',roomId:'reading',label:'Unpaired reading lamp',form:'table',position:[5.30,.98,3.76],size:[.24,.44,.25],yaw:0,source:'inferred',deviceId:null,owner:null},
    ]};
}
