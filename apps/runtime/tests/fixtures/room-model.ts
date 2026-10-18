/** Synthetic geometry only. Never replace this fixture with an apartment scan. */
export function roomModelFixture(): object {
  const vertices = new Float32Array([0,0,0,0,1,0, 2,0,0,0,1,0, 2,0,2,0,1,0, 0,0,2,0,1,0]);
  const indices = new Uint16Array([0,2,1,0,3,2]);
  return {schema:'room-model/1.0',id:'studio',roomId:'studio',calibration:{wallLengthMeters:2,source:'measured',otherDimensions:'estimated'},
    anchors:[{id:'a',label:'Desk lamp',position:[.25,1,.5],group:'fixture-a',deviceId:'lamp-a',owner:'bunny/modules/lifx'},
      {id:'b',label:'Wall lamp',position:[1.5,1,.5],group:'fixture-b',deviceId:'lamp-b',owner:'bunny/modules/lifx'},
      {id:'c',label:'Unpaired lamp',position:[1.5,1,1.5],group:'fixture-c',deviceId:null,owner:null}],
    scene:{width:2,depth:2,height:2.4,materials:[{color:[.55,.45,.3],roughness:.8}],batches:
      ['architecture','fixture-a','fixture-b','fixture-c'].map(group=>({group,material:0,count:indices.length,
        vertices:Buffer.from(vertices.buffer).toString('base64'),indices:Buffer.from(indices.buffer).toString('base64')}))}};
}
