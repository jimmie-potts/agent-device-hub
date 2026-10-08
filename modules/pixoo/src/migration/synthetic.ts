// A synthetic Pixoo library at the installed release's schema version 3 (Hub #931), for the migration's tests and the
// disposable run a reviewer migrates. It is built with the library's own code: its first three migrations create the
// catalog, its media store renders every rendition, and its rows are what the release's imports, playlist edits and
// playback checkpoint write. It also holds what the migration leaves behind: a session with the player's checkpoint, a
// pending cleanup with its orphaned original, and a leftover staging folder. Every name, picture and date is made up.
import {constants} from 'node:fs';
import {mkdir, open, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createCheckpoint} from '../library/checkpoint.js';
import type {Playlist} from '../library/contracts.js';
import {MIGRATIONS, migrate, transaction} from '../library/migrations.js';
import {DEFAULT_TRANSFORM, PIXOO64_SMOKE_PROFILE, SIMULATOR_PROFILE, type MediaProfile, type Rendition, type Transform} from '../media/contracts.js';
import {encodeHostedGif} from '../media/hosted-gif.js';
import {MediaStore} from '../media/store.js';
import {INSTALLED_LIBRARY, sha256} from './contracts.js';

/** What a synthetic library holds, for a test to compare a migration against. */
export type SyntheticLibrary = {
  assets: number; renditions: number; playlists: number; items: number; sessions: number; checkpoints: number; cleanupJobs: number;
  largeGifOriginals: number;
  /** Every asset and playlist name, so a test can show that none reaches a report. */
  names: string[];
  /** Each playlist's ID and its items' rendition IDs in order. */
  order: {id: string; renditionIds: string[]}[];
};

const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const at = (minute: number): string => new Date(Date.UTC(2026, 8, 1, 9, minute)).toISOString();

/** A GIF whose logical screen is `width` x `height` with one 1 x 1 image of the second color, shown for 100 ms. */
function canvasGif(width: number, height: number): Buffer {
  const word = (n: number): number[] => [n & 255, n >> 8];
  // Literal LZW codes at a fixed three-bit width: clear (4), color 1, end of information (5).
  const codes = [4, 1, 5];
  let bits = 0, count = 0;
  const packed: number[] = [];
  for (const code of codes) {
    bits |= code << count;
    count += 3;
    while (count >= 8) {
      packed.push(bits & 255);
      bits >>= 8;
      count -= 8;
    }
  }
  if (count > 0) packed.push(bits & 255);
  return Buffer.from([
    ...Buffer.from('GIF89a'), ...word(width), ...word(height), 0x81, 0, 0, 0, 0, 0, 40, 90, 200, 0, 0, 0, 255, 255, 255,
    0x21, 0xf9, 4, 4, ...word(10), 0, 0,
    0x2c, ...word(0), ...word(0), ...word(1), ...word(1), 0, 2, packed.length, ...packed, 0, 0x3b,
  ]);
}

/** Three 64 x 64 frames at 100 ms that differ, which every profile the release knew plays. */
function blinkGif(): Buffer {
  return encodeHostedGif([0, 1, 2].map(frame => {
    const rgb = new Uint8Array(12288);
    for (let pixel = 0; pixel < 4096; pixel += 1) rgb.set((pixel + frame) % 3 === 0 ? [250, 200, 20] : [10, 40 * frame, 90], pixel * 3);
    return {rgb, delayMs: 100};
  }));
}

/** Creates a file private to its owner, as the release's library did before SQLite opened it. */
async function privateFile(path: string): Promise<void> {
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  await handle.close();
}

/**
 * Writes a synthetic library at schema version 3 into `directory`, which must not exist: `catalog.sqlite`, closed cleanly
 * in WAL mode as the release left it, `owner.sqlite` with no holder, and `media/`. It renders through the media store's
 * child process, so it takes a few seconds.
 */
export async function writeSyntheticLibrary(directory: string): Promise<SyntheticLibrary> {
  await mkdir(directory, {mode: 0o700});
  const {default: sharp} = await import('sharp');
  // The release rendered a GIF whose logical screen was up to 50 megapixels; the module refuses one over 4096 x 4096.
  const media = new MediaStore({directory: join(directory, 'media'), limits: {maxGifCanvasPixels: 50_000_000}});
  const render = (bytes: Buffer, profile: MediaProfile = SIMULATOR_PROFILE, transform: Transform = DEFAULT_TRANSFORM): Promise<Rendition> =>
    media.render((async function* () { yield await Promise.resolve(bytes); })(), {profile, transform});
  const red = await sharp({create: {width: 8, height: 8, channels: 3, background: {r: 200, g: 30, b: 30}}}).png().toBuffer();
  const photo = await sharp({create: {width: 32, height: 24, channels: 3, background: {r: 30, g: 120, b: 60}}}).jpeg().toBuffer();
  const assets = [
    {id: uuid(1), name: 'Synthetic red tile', renditions: [await render(red), await render(red, PIXOO64_SMOKE_PROFILE, {fit: 'crop', scaling: 'smooth', background: [0, 0, 0]})]},
    {id: uuid(2), name: 'Synthetic blink', renditions: [await render(blinkGif())]},
    {id: uuid(3), name: 'Synthetic photo ❄ private-931', renditions: [await render(photo, SIMULATOR_PROFILE, {fit: 'crop', scaling: 'smooth', background: [10, 10, 10]})]},
    {id: uuid(4), name: 'Synthetic wide canvas', renditions: [await render(canvasGif(4100, 4100))]},
  ];
  const rendition = (asset: number, index = 0): string => {
    const id = assets[asset]?.renditions[index]?.id;
    if (id === undefined) throw new RangeError('no such rendition');
    return id;
  };
  const playlists: Playlist[] = [
    {id: uuid(101), name: 'Synthetic morning', revision: 4, repeat: true, shuffle: false, createdAt: at(10), updatedAt: at(14), items: [
      {id: uuid(203), renditionId: rendition(0), playback: {mode: 'duration', durationMs: 30_000}},
      {id: uuid(201), renditionId: rendition(1), playback: {mode: 'plays', totalPlays: 3}},
      {id: uuid(202), renditionId: rendition(2), playback: {mode: 'duration', durationMs: 5000}},
    ]},
    {id: uuid(102), name: 'Synthetic loop', revision: 2, repeat: false, shuffle: true, createdAt: at(20), updatedAt: at(21), items: [
      {id: uuid(212), renditionId: rendition(1), playback: {mode: 'plays', totalPlays: 2}},
      {id: uuid(210), renditionId: rendition(3), playback: {mode: 'duration', durationMs: 10_000}},
      {id: uuid(211), renditionId: rendition(0, 1), playback: {mode: 'duration', durationMs: 2000}},
      {id: uuid(213), renditionId: rendition(1), playback: {mode: 'plays', totalPlays: 1}},
    ]},
    {id: uuid(103), name: 'Synthetic empty', revision: 1, repeat: true, shuffle: false, createdAt: at(30), updatedAt: at(30), items: []},
  ];

  // What a deleted asset left: its cleanup job and its original, which no catalog entry names, and a staging folder.
  const orphan = Buffer.from('synthetic original of a deleted asset');
  await writeFile(join(directory, 'media', 'originals', sha256(orphan)), orphan, {mode: 0o600, flag: 'wx'});
  await mkdir(join(directory, 'media', 'staging', 'request-a1b2c3'), {mode: 0o700});
  await writeFile(join(directory, 'media', 'staging', 'request-a1b2c3', 'original'), orphan, {mode: 0o600, flag: 'wx'});

  await privateFile(join(directory, 'owner.sqlite'));
  const owner = new DatabaseSync(join(directory, 'owner.sqlite'));
  owner.exec('PRAGMA journal_mode=DELETE; CREATE TABLE IF NOT EXISTS owner(id INTEGER PRIMARY KEY)');
  owner.close();
  await privateFile(join(directory, 'catalog.sqlite'));
  const db = new DatabaseSync(join(directory, 'catalog.sqlite'), {enableForeignKeyConstraints: true});
  try {
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF');
    migrate(db, MIGRATIONS.slice(0, INSTALLED_LIBRARY.version));
    transaction(db, () => {
      for (const [index, asset] of assets.entries()) {
        const first = asset.renditions[0];
        if (first === undefined) throw new RangeError('an asset needs a rendition');
        db.prepare('INSERT INTO assets VALUES (?,?,?,?,?)').run(asset.id, first.sourceHash, asset.name, JSON.stringify(first.source), at(index));
        for (const made of asset.renditions) db.prepare('INSERT INTO renditions VALUES (?,?,?,?)').run(made.id, asset.id, JSON.stringify(made), at(index));
      }
      for (const playlist of playlists) {
        db.prepare('INSERT INTO playlists VALUES (?,?,?,?,?,?,?)').run(playlist.id, playlist.name, playlist.revision, Number(playlist.repeat), Number(playlist.shuffle), playlist.createdAt, playlist.updatedAt);
        for (const [position, item] of playlist.items.entries()) {
          db.prepare('INSERT INTO items VALUES (?,?,?,?,?)').run(item.id, playlist.id, position, item.renditionId, JSON.stringify(item.playback));
        }
      }
      const [morning] = playlists;
      if (morning === undefined) throw new RangeError('no playlist');
      createCheckpoint(db, morning);
      db.prepare('INSERT INTO cleanup_jobs VALUES (?,?,?)').run(uuid(9), sha256(orphan), '[]');
    });
  } finally {
    db.close();
  }
  return {
    assets: assets.length, renditions: assets.reduce((total, asset) => total + asset.renditions.length, 0), playlists: playlists.length,
    items: playlists.reduce((total, playlist) => total + playlist.items.length, 0), sessions: 1, checkpoints: 1, cleanupJobs: 1, largeGifOriginals: 1,
    names: [...assets.map(asset => asset.name), ...playlists.map(playlist => playlist.name)],
    order: playlists.map(playlist => ({id: playlist.id, renditionIds: playlist.items.map(item => item.renditionId)})),
  };
}
