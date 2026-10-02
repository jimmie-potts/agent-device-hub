import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import * as dictionary from '../dist/dictionary.js';

test('dictionary profile counts active entries and snippets without reading labels, preserving unsupported fields',()=>{
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE Dictionary(isDeleted INTEGER,isSnippet INTEGER,frequencyUsed INTEGER,remoteFrequencyUsed INTEGER,phrase TEXT,replacement TEXT)');
 db.exec("INSERT INTO Dictionary VALUES(0,0,7,10,'PRIVATE_LABEL','PRIVATE_REPLACEMENT'),(0,1,4,8,'PRIVATE_SNIPPET','PRIVATE_BODY'),(1,1,99,99,'DELETED','DELETED')");
 const result=dictionary.readDictionary(db);assert.deepEqual(result,{availability:'available',activeEntries:2,activeSnippets:1,localUsage:11,remoteUsage:18,window:'unknown',segment:0});assert.ok(!JSON.stringify(result).includes('PRIVATE'));
 db.exec('UPDATE Dictionary SET isDeleted=1 WHERE isSnippet=1');assert.equal(dictionary.readDictionary(db).activeSnippets,0);db.close();
 const missing=new DatabaseSync(':memory:');assert.equal(dictionary.readDictionary(missing).availability,'unavailable');
 missing.exec('CREATE TABLE Dictionary(isDeleted INTEGER)');assert.deepEqual(dictionary.readDictionary(missing),{availability:'available',activeEntries:0,activeSnippets:null,localUsage:null,remoteUsage:null,window:'unknown',segment:0});missing.close();
});

test('dictionary snapshots never sum repeated observations and decreases or rebinding advance segments',()=>{
 const previous={availability:'available',activeEntries:2,activeSnippets:1,localUsage:11,remoteUsage:18,window:'unknown',segment:3};
 assert.deepEqual(dictionary.dictionarySnapshot(previous,{...previous,segment:0}),previous);
 assert.equal(dictionary.dictionarySnapshot(previous,{...previous,localUsage:2}).segment,4);
 assert.equal(dictionary.dictionarySnapshot(previous,{...previous,remoteUsage:1}).segment,4);
 assert.equal(dictionary.dictionarySnapshot(previous,previous,true).segment,4);
});

test('unusable flags/counters and views do not become trusted dictionary totals',()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE Dictionary(isDeleted INTEGER,isSnippet INTEGER,frequencyUsed INTEGER,remoteFrequencyUsed INTEGER)');
 db.exec("INSERT INTO Dictionary VALUES(0,1,-1,4),(0,8,2,NULL)");const result=dictionary.readDictionary(db);assert.equal(result.activeEntries,2);assert.equal(result.activeSnippets,null);assert.equal(result.localUsage,null);assert.equal(result.remoteUsage,null);
 db.exec('UPDATE Dictionary SET isDeleted=4');assert.equal(dictionary.readDictionary(db).availability,'unavailable');db.close();
 const view=new DatabaseSync(':memory:');view.exec('CREATE VIEW Dictionary AS SELECT 0 AS isDeleted');assert.equal(dictionary.readDictionary(view).availability,'unavailable');view.close();
});
