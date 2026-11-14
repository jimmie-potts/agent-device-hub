import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  apartmentPngSize, type ApartmentFixture, type ApartmentFurniture, type ApartmentModel, type ApartmentWall, parseApartmentModel,
} from '../src/apartment-model.js';
import {apartmentSha256, validApartmentArtwork} from '../src/apartment/artwork.js';
import {calibrateApartmentPlan, parseApartmentScan, replaceApartmentScan, type ApartmentScan} from '../src/apartment/prepare.js';
import {syntheticApartment, syntheticApartmentArtwork} from './fixtures/apartment.js';

type Room = ApartmentModel['rooms'][number];
function required<T>(item: T|undefined): T { assert.ok(item !== undefined); return item; }

function correction(): ApartmentScan {
  const room = required(syntheticApartment().rooms[0]);
  // Source axes are rotated 90 degrees and origin is 0.2 m from the canonical right corner.
  const toLocal = ([x,z]: [number,number]): [number,number] => [z,4.2-x];
  const walls = room.walls.map(w => ({...w,start:toLocal(w.start),end:toLocal(w.end),source:'measured'}));
  walls.push({id:'west',start:toLocal([0,3]),end:toLocal([0,0]),height:2.7,thickness:.12,source:'measured',openings:[]});
  const scan = parseApartmentScan({schema:'apartment-scan/1.0',
    room:{...room,source:'measured',footprint:room.footprint.map(toLocal),walls,
      scan:{id:'corrected-capture',yaw:-Math.PI/2,translation:[4.2,0,0]}}});
  return required(scan);
}

test('the plan reference scales adjacent rooms, walls, openings and furniture consistently', () => {
  const geometry = syntheticApartment();
  const draft = {...geometry,schema:'apartment-plan/1.0',calibration:{...geometry.calibration,planUnits:400},
    rooms:geometry.rooms.map(room => ({...room,footprint:room.footprint.map(p => p.map(n => n*100)),
      walls:room.walls.map(wall => ({...wall,start:wall.start.map(n => n*100),end:wall.end.map(n => n*100),
        height:wall.height*100,thickness:wall.thickness*100,
        openings:wall.openings.map(o => ({...o,offset:o.offset*100,width:o.width*100,bottom:o.bottom*100,height:o.height*100}))}))})),
    objects:geometry.objects.map(o => ({...o,position:o.position.map(n => n*100),size:o.size.map(n => n*100)}))};
  const prepared = calibrateApartmentPlan(draft);
  assert.deepEqual(prepared.calibration,draft.calibration);
  assert.deepEqual(prepared.rooms[0]?.footprint,[[0,0],[4,0],[4,3],[0,3]]);
  assert.deepEqual(prepared.rooms[1]?.footprint,[[4,0],[7,0],[7,3],[4,3]]);
  assert.equal(prepared.rooms[0]?.walls[1]?.openings[0]?.width,1);
  assert.deepEqual(prepared.objects[0]?.position,[2,.4,.65]);
  assert.throws(() => calibrateApartmentPlan(prepared),/uncalibrated apartment-plan/);
});

test('normalized scan alignment replaces only one room and preserves IDs and curated placements', () => {
  const model = syntheticApartment();
  const original = structuredClone(model);
  const scan = correction();
  const refined = replaceApartmentScan(model,scan);
  assert.deepEqual(model,original);
  const next = required(refined.rooms[0]);
  const before = required(original.rooms[0]);
  for (const [index,point] of next.footprint.entries()) {
    const originalPoint = required(before.footprint[index]);
    assert.ok(Math.hypot(point[0]-originalPoint[0],point[1]-originalPoint[1])<1e-8);
  }
  assert.equal(next.source,'measured');
  assert.deepEqual(next.scan,scan.room.scan);
  assert.deepEqual(next.walls.map(w => w.id),['north','partition','west']);
  assert.deepEqual(next.walls[1]?.openings,before.walls[1]?.openings);
  assert.deepEqual(refined.rooms[1],original.rooms[1]);
  assert.deepEqual(refined.objects,original.objects);
  assert.deepEqual(refined.artwork,original.artwork);
  assert.throws(() => replaceApartmentScan(refined,scan),/new scan identity/);

  const replacement = structuredClone(scan);
  replacement.room.scan.id = 'second-capture';
  replacement.room.walls[2] = {...required(replacement.room.walls[2]),height:2.72};
  assert.equal(replaceApartmentScan(refined,replacement).rooms[0]?.walls[2]?.height,2.72);
});

test('mismatched scan identity, wall identifiers, mirrors and placement conflicts are refused', () => {
  const model = syntheticApartment(), scan = correction();
  const wrongRoom = structuredClone(scan); wrongRoom.room.id = 'missing';
  const lostWall = structuredClone(scan); lostWall.room.walls.splice(0,1);
  const badPlacement = structuredClone(scan); badPlacement.room.scan.translation = [8,0,0];
  assert.throws(() => replaceApartmentScan(model,wrongRoom),/does not match/);
  assert.throws(() => replaceApartmentScan(model,lostWall),/existing wall/);
  assert.throws(() => replaceApartmentScan(model,badPlacement),/placement/);
  assert.equal(parseApartmentScan({...scan,room:{...scan.room,scan:{...scan.room.scan,mirror:true}}}),undefined);
});

test('semantic model rejects unsafe, ambiguous and excessive data', () => {
  const model = syntheticApartment();
  assert.deepEqual(parseApartmentModel(model),model);
  const changes: ((model: ApartmentModel, room: Room, wall: ApartmentWall) => void)[] = [
    (_model,room) => {room.footprint = [[0,0],[4,3],[4,0],[0,3]];},
    (_model,_room,wall) => {wall.end = [15,0];},
    (_model,_room,wall) => {wall.openings.push({id:'oversized',kind:'door',offset:0,width:2,bottom:0,height:8,source:'inferred'});},
    (value,room) => {value.rooms.push(room);},
    (value,room) => {value.rooms.push({...room,id:'clashing'});},
    value => { value.artwork.splice(0,1); },
    value => { value.objects.push({...required(value.objects[0])}); },
    value => {
      const fixture = value.objects.find((object): object is ApartmentFixture => object.kind === 'fixture');
      value.objects.push({...required(fixture),id:'second-fixture'});
    },
  ];
  for (const change of changes) {
    const candidate = structuredClone(model);
    const room = required(candidate.rooms[0]), wall = required(room.walls[0]);
    change(candidate,room,wall);
    assert.equal(parseApartmentModel(candidate),undefined);
  }
  assert.equal(parseApartmentModel({...model,artwork:[{...model.artwork[0],url:'https://example.invalid/art.png'}]}),undefined);

  const concave: Room = {id:'concave',footprint:[[0,0],[6,0],[6,4],[3,4],[3,2],[2,2],[2,4],[0,4]],floorY:0,
    source:'inferred',scan:null,walls:[{id:'baseline',start:[0,0],end:[6,0],height:2.5,thickness:.15,source:'measured',openings:[]}]};
  const table: ApartmentFurniture = {id:'table',roomId:'concave',kind:'furniture',form:'table',label:'Table',
    position:[3,1,3],size:[5,1,1],yaw:0,source:'inferred'};
  assert.equal(parseApartmentModel({...model,rooms:[concave],objects:[table],artwork:[]}),undefined);
  concave.walls.push({id:'crossing',start:[0,3],end:[6,3],height:2.5,thickness:.15,source:'measured',openings:[]});
  assert.equal(parseApartmentModel({...model,rooms:[concave],objects:[],artwork:[]}),undefined);
});

test('PNG must have declared dimensions, CRCs, exact compressed data and a stripped static rendition', () => {
  const {bytes,image} = syntheticApartmentArtwork();
  assert.deepEqual(apartmentPngSize(bytes),{width:image.width,height:image.height});
  assert.equal(validApartmentArtwork(bytes,image),true);
  assert.equal(validApartmentArtwork(bytes,{...image,width:image.width+1}),false);
  assert.equal(validApartmentArtwork(bytes,{...image,id:'0'.repeat(64)}),false);
  const oversized = Buffer.from(bytes); oversized.writeUInt32BE(16384,16);
  assert.equal(apartmentPngSize(oversized),undefined);
  const trailing = Buffer.concat([bytes,Buffer.from([0])]);
  assert.equal(validApartmentArtwork(trailing,{...image,bytes:trailing.length,id:apartmentSha256(trailing)}),false);
  const wrongCrc = Buffer.from(bytes); wrongCrc.writeUInt32BE(0,29);
  assert.equal(validApartmentArtwork(wrongCrc,{...image,id:apartmentSha256(wrongCrc)}),false);
});
