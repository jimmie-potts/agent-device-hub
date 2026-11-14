import {createHash} from 'node:crypto';
import {crc32, deflateSync} from 'node:zlib';
import type {ApartmentImage, ApartmentModel} from '../../src/apartment-model.js';

export function syntheticApartmentArtwork(background = [31,97,106]): {bytes: Buffer; image: ApartmentImage} {
  const width = 24, height = 32;
  const pixels = Buffer.alloc((1 + width*3) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (1 + width*3)*y + 1 + x*3;
      const arc = (x-11)**2 + (y-14)**2 < 47;
      pixels.set(arc ? [239,134,81] : y+x/3<23 ? background : [234,198,136], index);
    }
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const result = Buffer.alloc(data.length+12);
    result.writeUInt32BE(data.length);
    result.write(type,4,'ascii');
    data.copy(result,8);
    result.writeUInt32BE(crc32(result.subarray(4,8+data.length)),8+data.length);
    return result;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height,4);
  header[8] = 8;
  header[9] = 2;
  const bytes = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),
    chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
  return {bytes,image:{id:createHash('sha256').update(bytes).digest('hex'),width,height,bytes:bytes.length}};
}

export function syntheticApartment(image = syntheticApartmentArtwork().image): ApartmentModel {
  return {
    schema: 'apartment-model/1.0',
    calibration:{planId:'sample-plan',planUnits:100,referenceMeters:4,source:'measured',orientation:'confirmed'},
    rooms:[
      {id:'studio', footprint:[[0,0],[4,0],[4,3],[0,3]], floorY:0, source:'inferred', scan:null, walls:[
        {id:'north',start:[0,0],end:[4,0],height:2.7,thickness:.12,source:'inferred',openings:[]},
        {id:'partition',start:[4,0],end:[4,3],height:2.7,thickness:.12,source:'inferred',openings:[
          {id:'passage',kind:'door',offset:1.2,bottom:0,width:1,height:2.1,source:'measured'}]},
      ]},
      {id:'reading',footprint:[[4,0],[7,0],[7,3],[4,3]],floorY:0,source:'unresolved',scan:null,walls:[
        {id:'east',start:[7,0],end:[7,3],height:2.7,thickness:.12,source:'unresolved',openings:[]},
      ]},
    ],
    objects:[
      {id:'settee',roomId:'studio',label:'Settee',kind:'furniture',form:'sofa',position:[2,.4,.65],size:[1.6,.8,.7],yaw:0,source:'inferred'},
      {id:'sample-print',roomId:'studio',label:'Sample print',kind:'artwork',position:[1.8,1.8,0],size:[.6,.8,.04],yaw:0,source:'measured',asset:image.id},
      {id:'studio-lamp',roomId:'studio',label:'Studio lamp',kind:'fixture',form:'floor',position:[.65,.75,.6],size:[.35,1.5,.35],yaw:0,source:'measured',
        owner:'bunny/modules/nanoleaf',deviceId:'studio-panel'},
    ],
    artwork: [image],
  };
}
