/** Prepared, renderer-independent apartment content. Positions use meters and +Y up. */
export type Provenance = 'measured' | 'inferred' | 'unresolved';
export type ApartmentPoint = [number, number];
export type ApartmentVector = [number, number, number];
export type ApartmentOpening = {
  id: string;
  kind: 'door' | 'window' | 'opening';
  offset: number;
  width: number;
  bottom: number;
  height: number;
  source: Provenance;
};
export type ApartmentWall = {
  id: string;
  start: ApartmentPoint;
  end: ApartmentPoint;
  height: number;
  thickness: number;
  source: Provenance;
  openings: ApartmentOpening[];
};
export type ApartmentAlignment = {id: string; yaw: number; translation: ApartmentVector};
export type ApartmentRoom = {
  id: string;
  footprint: ApartmentPoint[];
  floorY: number;
  source: Provenance;
  walls: ApartmentWall[];
  scan: ApartmentAlignment | null;
};
type ApartmentPlacement = {
  id: string;
  roomId: string;
  label: string;
  position: ApartmentVector;
  size: ApartmentVector;
  yaw: number;
  source: Provenance;
};
export type ApartmentFurniture = ApartmentPlacement & {
  kind: 'furniture';
  form: 'sofa' | 'chair' | 'table' | 'bed' | 'cabinet' | 'shelf' | 'desk' | 'rug' | 'other';
};
export type ApartmentArt = ApartmentPlacement & {kind: 'artwork'; asset: string | null};
export type ApartmentFixture = ApartmentPlacement & {
  kind: 'fixture';
  form: 'ceiling' | 'wall' | 'floor' | 'table' | 'strip' | 'other';
  deviceId: string | null;
  owner: string | null;
};
export type ApartmentObject = ApartmentFurniture | ApartmentArt | ApartmentFixture;
export type ApartmentImage = {id: string; width: number; height: number; bytes: number};
export type ApartmentModel = {
  schema: 'apartment-model/1.0';
  calibration: {
    planId: string;
    planUnits: number;
    referenceMeters: number;
    source: 'measured' | 'inferred';
    orientation: 'confirmed' | 'inferred' | 'unresolved';
  };
  rooms: ApartmentRoom[];
  objects: ApartmentObject[];
  artwork: ApartmentImage[];
};

export const apartmentModelPath = '/modules/core/content/apartment-model';
export const apartmentArtPath = (id: string): string => '/modules/core/content/apartment-art-' + id;
export const MAX_APARTMENT_BYTES = 512 * 1024;
export const MAX_APARTMENT_IMAGE_BYTES = 1024 * 1024;
const MAX_IMAGE_EDGE = 1024;
const MAX_ARTWORK_BYTES = 4 * 1024 * 1024;
const MAX_ARTWORK_PIXELS = 4 * 1024 * 1024;
const EPSILON = 1e-6;

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const closed = (value: Record<string, unknown>, fields: readonly string[]): boolean =>
  Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
const id = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 128 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
const finite = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const integer = (value: unknown, min: number, max: number): value is number =>
  finite(value, min, max) && Number.isInteger(value);
const point = (value: unknown): value is ApartmentPoint =>
  Array.isArray(value) && value.length === 2 && value.every(n => finite(n, -100, 100));
const vector = (value: unknown, min: number, max: number): value is ApartmentVector =>
  Array.isArray(value) && value.length === 3 && value.every(n => finite(n, min, max));
const source = (value: unknown): value is Provenance =>
  value === 'measured' || value === 'inferred' || value === 'unresolved';
const yaw = (value: unknown): value is number => finite(value, -Math.PI, Math.PI);
const unique = (values: readonly string[]): boolean => new Set(values).size === values.length;

export const apartmentDigest = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function orientation(a: ApartmentPoint, b: ApartmentPoint, p: ApartmentPoint): number {
  return (b[0]-a[0])*(p[1]-a[1]) - (b[1]-a[1])*(p[0]-a[0]);
}

function onSegment(a: ApartmentPoint, b: ApartmentPoint, p: ApartmentPoint): boolean {
  return Math.abs(orientation(a, b, p)) <= EPSILON
    && p[0] >= Math.min(a[0], b[0])-EPSILON && p[0] <= Math.max(a[0], b[0])+EPSILON
    && p[1] >= Math.min(a[1], b[1])-EPSILON && p[1] <= Math.max(a[1], b[1])+EPSILON;
}

function intersects(a: ApartmentPoint, b: ApartmentPoint, c: ApartmentPoint, d: ApartmentPoint): boolean {
  return onSegment(a,b,c) || onSegment(a,b,d) || onSegment(c,d,a) || onSegment(c,d,b)
    || (orientation(a,b,c)*orientation(a,b,d)<0 && orientation(c,d,a)*orientation(c,d,b)<0);
}

/** Boundary points belong to a room so wall-mounted objects can use the wall centerline. */
export function apartmentContains(footprint: readonly ApartmentPoint[], p: ApartmentPoint): boolean {
  let inside = false;
  for (let index = 0; index < footprint.length; index++) {
    const a = footprint[index], b = footprint[(index+1)%footprint.length];
    if (a === undefined || b === undefined) return false;
    if (onSegment(a,b,p)) return true;
    if ((a[1]>p[1]) !== (b[1]>p[1]) && p[0] < (b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]) inside = !inside;
  }
  return inside;
}

function simpleFootprint(points: ApartmentPoint[]): boolean {
  let area = 0;
  for (let index = 0; index < points.length; index++) {
    const a = points[index], b = points[(index+1)%points.length];
    if (a === undefined || b === undefined || Math.hypot(b[0]-a[0],b[1]-a[1])<.02) return false;
    area += a[0]*b[1] - b[0]*a[1];
    for (let later = index+2; later < points.length; later++) {
      if (index === 0 && later === points.length-1) continue;
      const c = points[later], d = points[(later+1)%points.length];
      if (c === undefined || d === undefined || intersects(a,b,c,d)) return false;
    }
  }
  return Math.abs(area) >= .02;
}

function opening(value: unknown, length: number, height: number): value is ApartmentOpening {
  return record(value) && closed(value,['id','kind','offset','width','bottom','height','source']) && id(value.id)
    && (value.kind==='door' || value.kind==='window' || value.kind==='opening')
    && finite(value.offset,0,length) && finite(value.width,.02,length)
    && finite(value.bottom,0,height) && finite(value.height,.02,height)
    && value.offset+value.width<=length+EPSILON && value.bottom+value.height<=height+EPSILON
    && source(value.source);
}

function overlappingOpenings(openings: readonly ApartmentOpening[]): boolean {
  return openings.some((a,index) => openings.slice(index+1).some(b =>
    Math.min(a.offset+a.width,b.offset+b.width)-Math.max(a.offset,b.offset)>EPSILON
      && Math.min(a.bottom+a.height,b.bottom+b.height)-Math.max(a.bottom,b.bottom)>EPSILON));
}

function wall(value: unknown): value is ApartmentWall {
  if (!record(value) || !closed(value,['id','start','end','height','thickness','source','openings']) || !id(value.id)
    || !point(value.start) || !point(value.end) || !finite(value.height,.1,10) || !finite(value.thickness,.01,1)
    || !source(value.source) || !Array.isArray(value.openings) || value.openings.length>12) return false;
  const length = Math.hypot(value.start[0]-value.end[0],value.start[1]-value.end[1]);
  const height = value.height;
  return length >= .02 && length <= 80
    && value.openings.every(entry => opening(entry,length,height)) && !overlappingOpenings(value.openings);
}

export function isApartmentAlignment(value: unknown): value is ApartmentAlignment {
  return record(value) && closed(value,['id','yaw','translation']) && id(value.id)
    && yaw(value.yaw) && vector(value.translation,-100,100);
}

export function isApartmentRoom(value: unknown): value is ApartmentRoom {
  if (!record(value) || !closed(value,['id','footprint','floorY','source','walls','scan']) || !id(value.id)
    || !finite(value.floorY,-20,20) || !source(value.source) || (value.scan!==null && !isApartmentAlignment(value.scan))
    || !Array.isArray(value.footprint) || value.footprint.length<3 || value.footprint.length>40
    || !Array.isArray(value.walls) || value.walls.length<1 || value.walls.length>32) return false;
  if (!value.footprint.every(point) || !simpleFootprint(value.footprint) || !value.walls.every(wall)) return false;
  const footprint = value.footprint;
  const structureIds = value.walls.flatMap(w => [w.id,...w.openings.map(o => o.id)]);
  return unique(structureIds) && value.walls.every(({start,end}) =>
    apartmentContains(footprint,start) && apartmentContains(footprint,end)
      && apartmentContains(footprint,[(start[0]+end[0])/2,(start[1]+end[1])/2]));
}

const furnitureForms = new Set<unknown>(['sofa','chair','table','bed','cabinet','shelf','desk','rug','other']);
const fixtureForms = new Set<unknown>(['ceiling','wall','floor','table','strip','other']);
const placementFields = ['id','roomId','label','position','size','yaw','source','kind'];

function placed(value: unknown): value is ApartmentObject {
  if (!record(value) || !id(value.id) || !id(value.roomId) || typeof value.label!=='string'
    || value.label.trim()==='' || value.label.length>80 || !vector(value.position,-100,100)
    || !vector(value.size,.005,12) || !yaw(value.yaw) || !source(value.source)) return false;
  switch (value.kind) {
    case 'furniture': return closed(value,[...placementFields,'form']) && furnitureForms.has(value.form);
    case 'artwork': return closed(value,[...placementFields,'asset']) && (value.asset===null || apartmentDigest(value.asset));
    case 'fixture': return closed(value,[...placementFields,'form','owner','deviceId']) && fixtureForms.has(value.form)
      && (value.owner===null && value.deviceId===null || id(value.deviceId) && typeof value.owner==='string'
        && value.owner.length<=128 && /^bunny\/modules\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.owner));
    default: return false;
  }
}

export function apartmentPlacementFits(object: ApartmentObject, room: ApartmentRoom): boolean {
  const [x,y,z] = object.position;
  const ceiling = room.floorY + Math.max(...room.walls.map(item => item.height));
  if (y<room.floorY-EPSILON || y>ceiling+EPSILON || !apartmentContains(room.footprint,[x,z])) return false;
  if (object.kind!=='furniture') return true;
  const [width,height,depth] = object.size;
  if (y-height/2<room.floorY-EPSILON || y+height/2>ceiling+EPSILON) return false;
  const cos = Math.cos(object.yaw), sin = Math.sin(object.yaw);
  return [-width/2,width/2].every(dx => [-depth/2,depth/2].every(dz =>
    apartmentContains(room.footprint,[x+dx*cos+dz*sin,z-dx*sin+dz*cos])));
}

function image(value: unknown): value is ApartmentImage {
  return record(value) && closed(value,['id','width','height','bytes']) && apartmentDigest(value.id)
    && integer(value.width,1,MAX_IMAGE_EDGE) && integer(value.height,1,MAX_IMAGE_EDGE)
    && integer(value.bytes,45,MAX_APARTMENT_IMAGE_BYTES);
}

export function parseApartmentModel(value: unknown): ApartmentModel | undefined {
  if (!record(value) || !closed(value,['schema','calibration','rooms','objects','artwork'])
    || value.schema!=='apartment-model/1.0') return undefined;
  const calibration = value.calibration;
  if (!record(calibration) || !closed(calibration,['planId','planUnits','referenceMeters','source','orientation'])
    || !id(calibration.planId) || !finite(calibration.planUnits,.001,100_000) || !finite(calibration.referenceMeters,.02,100)
    || (calibration.source!=='measured' && calibration.source!=='inferred')
    || (calibration.orientation!=='confirmed' && calibration.orientation!=='inferred' && calibration.orientation!=='unresolved')) return undefined;
  const {rooms,objects,artwork} = value;
  if (!Array.isArray(rooms) || rooms.length<1 || rooms.length>16 || !rooms.every(isApartmentRoom)
    || !Array.isArray(objects) || objects.length>160 || !objects.every(placed)
    || !Array.isArray(artwork) || artwork.length>16 || !artwork.every(image)) return undefined;
  const roomIndex = new Map(rooms.map(item => [item.id,item]));
  const assets = new Set(artwork.map(item => item.id));
  if (roomIndex.size!==rooms.length || assets.size!==artwork.length || !unique(objects.map(item => item.id))
    || rooms.reduce((n,item) => n+item.walls.length,0)>128
    || rooms.reduce((n,item) => n+item.walls.reduce((total,w) => total+w.openings.length,0),0)>128
    || artwork.reduce((n,item) => n+item.width*item.height,0)>MAX_ARTWORK_PIXELS
    || artwork.reduce((n,item) => n+item.bytes,0)>MAX_ARTWORK_BYTES) return undefined;
  const devices = new Set<string>(), referenced = new Set<string>();
  for (const item of objects) {
    const containing = roomIndex.get(item.roomId);
    if (containing===undefined || !apartmentPlacementFits(item, containing)) return undefined;
    if (item.kind==='fixture' && item.deviceId!==null) {
      if (devices.has(item.deviceId)) return undefined;
      devices.add(item.deviceId);
    }
    if (item.kind==='artwork' && item.asset!==null) {
      if (!assets.has(item.asset)) return undefined;
      referenced.add(item.asset);
    }
  }
  if (referenced.size!==assets.size) return undefined;
  return value as ApartmentModel;
}

/** Checks dimensions and supported static RGB/RGBA format before browser decoding. */
export function apartmentPngSize(bytes: Uint8Array): {width: number; height: number} | undefined {
  const signature = [137,80,78,71,13,10,26,10];
  if (bytes.byteLength<45 || bytes.byteLength>MAX_APARTMENT_IMAGE_BYTES
    || !signature.every((byte,index) => bytes[index]===byte)) return undefined;
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = data.getUint32(16), height = data.getUint32(20);
  if (!integer(width,1,MAX_IMAGE_EDGE) || !integer(height,1,MAX_IMAGE_EDGE)
    || data.getUint32(8)!==13 || data.getUint32(12)!==0x49484452
    || bytes[24]!==8 || (bytes[25]!==2 && bytes[25]!==6)
    || bytes[26]!==0 || bytes[27]!==0 || bytes[28]!==0) return undefined;
  return {width, height};
}
