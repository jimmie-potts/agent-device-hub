import {
  apartmentPlacementFits, isApartmentAlignment, isApartmentRoom, parseApartmentModel,
  type ApartmentAlignment, type ApartmentModel, type ApartmentPoint, type ApartmentRoom,
} from '../apartment-model.js';
import {ApartmentRefusal} from './content.js';

const record = (value: unknown): value is Record<string,unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const scaleNumber = (value: unknown, scale: number): unknown => typeof value === 'number' ? value*scale : value;
const scaleVector = (value: unknown, scale: number): unknown =>
  Array.isArray(value) && value.length<=3 ? value.map(n => scaleNumber(n,scale)) : value;

function scaleFields(value: unknown, fields: readonly string[], convert: (value: unknown) => unknown): unknown {
  if (!record(value)) return value;
  const result = {...value};
  for (const field of fields) if (Object.hasOwn(result,field)) result[field] = convert(result[field]);
  return result;
}

function scaleRooms(value: unknown, scale: number): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((room: unknown) => {
    if (!record(room) || !Array.isArray(room.walls)) return room;
    const footprint = Array.isArray(room.footprint) ? room.footprint.map(point => scaleVector(point,scale)) : room.footprint;
    return {...room, footprint, floorY:scaleNumber(room.floorY,scale), walls:room.walls.map((wall: unknown) => {
      if (!record(wall) || !Array.isArray(wall.openings)) return wall;
      return {...wall, start:scaleVector(wall.start,scale),end:scaleVector(wall.end,scale),
        height:scaleNumber(wall.height,scale),thickness:scaleNumber(wall.thickness,scale),
        openings:wall.openings.map((opening: unknown) => scaleFields(opening,['offset','width','bottom','height'],n => scaleNumber(n,scale)))};
    })};
  });
}

/** Scale plan-local coordinates once, then validate the complete meter model. */
export function calibrateApartmentPlan(draft: unknown): ApartmentModel {
  const invalid = new ApartmentRefusal('invalid-request','Use an uncalibrated apartment-plan/1.0 draft with a valid scale reference.');
  if (!record(draft) || draft.schema !== 'apartment-plan/1.0' || !record(draft.calibration)) throw invalid;
  const {planUnits,referenceMeters} = draft.calibration;
  if (typeof planUnits !== 'number' || !Number.isFinite(planUnits) || planUnits < .001 || planUnits > 100_000
    || typeof referenceMeters !== 'number' || !Number.isFinite(referenceMeters) || referenceMeters < .02 || referenceMeters > 100) throw invalid;
  const scale = referenceMeters/planUnits;
  const objects = Array.isArray(draft.objects) ? draft.objects.map((item: unknown) => scaleFields(item,['position','size'],n => scaleVector(n,scale))) : draft.objects;
  const calibrated = parseApartmentModel({...draft,schema:'apartment-model/1.0',rooms:scaleRooms(draft.rooms,scale),objects});
  if (calibrated === undefined || calibrated.rooms.some(room => room.scan !== null)) {
    throw new ApartmentRefusal('invalid-request','Calibrated plan exceeds the geometry bounds or already contains an aligned scan.');
  }
  return calibrated;
}

/** A privately prepared normalized scan. The geometry is already scaled in room-local meters. */
export type ApartmentScan = {schema: 'apartment-scan/1.0'; room: ApartmentRoom & {scan: ApartmentAlignment}};
export function parseApartmentScan(value: unknown): ApartmentScan | undefined {
  if (typeof value !== 'object' || value === null || !('schema' in value) || value.schema !== 'apartment-scan/1.0'
    || !('room' in value) || Object.keys(value).length !== 2 || !isApartmentRoom(value.room) || !isApartmentAlignment(value.room.scan)) return undefined;
  return {schema:value.schema,room:{...value.room,scan:value.room.scan}};
}

function placementOnWall(room: ApartmentRoom, position: readonly [number, number, number]): boolean {
  const [x,y,z] = position;
  return room.walls.some(wall => {
    const dx = wall.end[0]-wall.start[0], dz = wall.end[1]-wall.start[1];
    const length = Math.hypot(dx,dz);
    const offset = ((x-wall.start[0])*dx+(z-wall.start[1])*dz)/length;
    const distance = Math.abs((x-wall.start[0])*dz-(z-wall.start[1])*dx)/length;
    const height = y-room.floorY;
    return offset>=0 && offset<=length && height>=0 && height<=wall.height && distance <= wall.thickness/2+.12
      && !wall.openings.some(o => offset>o.offset && offset<o.offset+o.width && height>o.bottom && height<o.bottom+o.height);
  });
}

/** Install surveyed room geometry while keeping curated apartment-space poses and bindings. */
export function replaceApartmentScan(model: ApartmentModel, scan: ApartmentScan): ApartmentModel {
  const previous = model.rooms.find(room => room.id === scan.room.id);
  if (previous === undefined) throw new ApartmentRefusal('invalid-request', 'Scan room does not match a prepared room.');
  if (previous.scan?.id === scan.room.scan.id) {
    throw new ApartmentRefusal('invalid-request', 'Use a new scan identity for a correction.');
  }
  for (const wall of previous.walls) {
    const next = scan.room.walls.find(candidate => candidate.id === wall.id);
    if (next === undefined || wall.openings.some(o => !next.openings.some(n => n.id === o.id && n.kind === o.kind))) {
      throw new ApartmentRefusal('invalid-request', 'The replacement lost an existing wall or opening identity.');
    }
  }
  const {yaw, translation:[x,y,z]} = scan.room.scan;
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  const transform = ([u,v]: ApartmentPoint): ApartmentPoint => [u*cos+v*sin+x, -u*sin+v*cos+z];
  const room: ApartmentRoom = {...scan.room, floorY:scan.room.floorY+y, footprint:scan.room.footprint.map(transform),
    walls:scan.room.walls.map(wall => ({...wall,start:transform(wall.start),end:transform(wall.end)}))};
  if (!isApartmentRoom(room)) throw new ApartmentRefusal('invalid-request', 'The aligned room exceeds the geometry bounds.');
  if (model.objects.some(object => {
    if (object.roomId !== room.id) return false;
    if (!apartmentPlacementFits(object,room)) return true;
    const mounted = object.kind === 'artwork' || object.kind === 'fixture' && object.form === 'wall';
    return mounted && placementOnWall(previous,object.position) && !placementOnWall(room,object.position);
  })) {
    throw new ApartmentRefusal('invalid-request', 'The aligned room conflicts with a curated object placement. Reconcile it in the private plan.');
  }
  const updated = parseApartmentModel({...model, rooms:model.rooms.map(candidate => candidate.id === room.id ? room : candidate)});
  if (updated === undefined) throw new ApartmentRefusal('invalid-request', 'The aligned room conflicts with the apartment model.');
  return updated;
}
