import test from 'node:test';
import assert from 'node:assert/strict';
import * as language from '../dist/language.js';
const {tokenizeEnglish}=language;

test('English tokenization folds Unicode and apostrophes deterministically',()=>{
 const text="CAFÉ cafe\u0301 DON’T don't Straße STRASSE rock’n’roll";
 assert.deepEqual(tokenizeEnglish(text).tokens,['café','café',"don't","don't",'strasse','strasse',"rock'n'roll"]);
 assert.deepEqual(tokenizeEnglish(text),tokenizeEnglish(text));
});

test('sensitive stages are excluded and owner terms preserve phrase boundaries',()=>{
 for(const value of ['mail person@example.invalid now','visit https://synthetic.invalid/private','open C:\\Synthetic\\private.txt','open /home/synthetic/private.txt','call +1 (555) 123-4567','key sk-SyntheticCanary123456789','token abcdefghijklmnop123456789012345678']){
  const result=tokenizeEnglish(value);assert.equal(result.reason,'sensitive',value);assert.deepEqual(result.tokens,[]);
 }
 assert.deepEqual(tokenizeEnglish('before PRIVATE phrase after',['private phrase']).tokens,['before',null,'after']);
 assert.deepEqual(tokenizeEnglish('alphabet alpha beta',['alpha']).tokens,['alphabet',null,'beta']);
});

test('oversized language input is excluded rather than truncated',()=>{
 for(const value of ['word '.repeat(2001),'a'.repeat(65537),'a'.repeat(201)]){
  const result=tokenizeEnglish(value);assert.equal(result.reason,'oversized');assert.deepEqual(result.tokens,[]);
 }
 assert.equal(tokenizeEnglish('word '.repeat(2000)).tokens.length,2000);
});

test('word and contiguous phrase counts preserve repetitions and exclusion boundaries',()=>{
 const features=language.wordFeatures(tokenizeEnglish('the hello world hello world').tokens);
 assert.deepEqual(features.words,[['hello',2],['the',1],['world',2]]);
 assert.deepEqual(features.usefulWords,[['hello',2],['world',2]]);
 assert.equal(new Map(features.phrases).get('hello world'),2);
 assert.ok(features.phrases.every(([text])=>text.split(' ').length>=2&&text.split(' ').length<=5));
 const excluded=language.wordFeatures(tokenizeEnglish('before secret after',['secret']).tokens);assert.deepEqual(excluded.phrases,[]);
 assert.deepEqual(language.wordFeatures(tokenizeEnglish('hello').tokens).phrases,[]);
});

test('bounded token alignment separates insertions deletions substitutions and unchanged pairs',()=>{
 for(const [before,after,expected] of [
  [['alpha','beta'],['alpha','beta'],[0,0,0]],
  [['alpha'],['alpha','beta'],[1,0,0]],
  [['alpha','beta'],['alpha'],[0,1,0]],
  [['alpha','beta'],['alpha','gamma'],[0,0,1]],
  [[],['hello'],[1,0,0]],
  [['hello'],[],[0,1,0]],
 ]){
  const result=language.alignTokens(before,after);assert.equal(result.availability,'available');assert.deepEqual([result.insertions,result.deletions,result.substitutions],expected);assert.equal(result.changed,expected.some(Boolean));assert.deepEqual(result,language.alignTokens(before,after));
 }
 assert.deepEqual(language.alignTokens([],['hello']).pairs,[['','hello',1]]);
 assert.deepEqual(language.alignTokens(['hello'],[]).pairs,[['hello','',1]]);
});

test('full rewrites retain counts without sentence pairs and alignment work is bounded',()=>{
 const before='one two three four five six seven eight'.split(' '),after='alpha beta gamma delta epsilon zeta eta theta'.split(' ');
 const result=language.alignTokens(before,after);assert.equal(result.availability,'available');assert.equal(result.substitutions,8);assert.deepEqual(result.pairs,[]);assert.equal(result.longChanges,1);
 assert.deepEqual(language.alignTokens(Array(2000).fill('before'),Array(2000).fill('after')),{availability:'unavailable',reason:'work-budget'});
 assert.deepEqual(language.alignTokens(Array(2001).fill('word'),[]),{availability:'unavailable',reason:'oversized'});
});

test('independent stages distinguish absent partial ambiguous and unchanged observations',()=>{
 const input={raw:'hello world',formatted:'hello world',observed:'hello world',language:'en-US',observation:'complete'};
 const result=language.analyzeStages(input);
 assert.equal(result.raw.reason,null);assert.equal(result.formatted.comparison.changed,false);assert.equal(result.observed.comparison.changed,false);
 assert.deepEqual(result.observed.words,[['hello',1],['world',1]]);
 for(const observation of ['partial','unknown',null]){
  const result=language.analyzeStages({...input,observation});assert.equal(result.observed.reason,'uncertain');assert.equal(result.observed.comparison,null);assert.deepEqual(result.observed.words,[]);
 }
 const missing=language.analyzeStages({...input,observed:null});assert.equal(missing.observed.reason,'missing');assert.equal(missing.observed.comparison,null);
 const absentRaw=language.analyzeStages({...input,raw:null});assert.equal(absentRaw.formatted.reason,null);assert.equal(absentRaw.formatted.comparison,null);assert.equal(absentRaw.formatted.comparisonReason,'missing');
 for(const locale of [null,'unknown','fr','english'])assert.equal(language.analyzeStages({...input,language:locale}).raw.reason,'unsupportedLanguage');
 const empty=language.analyzeStages({...input,observed:''});assert.equal(empty.observed.reason,null);assert.equal(empty.observed.comparison.deletions,2);
});

test('stage comparisons stay separate and excluded spans cannot invent changes',()=>{
 const result=language.analyzeStages({raw:'hello there',formatted:'hello world',observed:'hello brave world',language:'en',observation:'complete'});
 assert.deepEqual(result.formatted.comparison.pairs,[['there','world',1]]);assert.deepEqual(result.observed.comparison.pairs,[['','brave',1]]);
 const excluded=language.analyzeStages({raw:'before secret after',formatted:'before after',observed:null,language:'en',observation:null},['secret']);
 assert.equal(excluded.formatted.comparison,null);assert.equal(excluded.formatted.comparisonReason,'uncertain');assert.deepEqual(excluded.raw.phrases,[]);
 const oversized=language.analyzeStages({raw:'word '.repeat(2001),formatted:'word',observed:null,language:'en',observation:null});assert.equal(oversized.raw.reason,'oversized');assert.equal(oversized.formatted.reason,null);assert.equal(oversized.formatted.comparisonReason,'oversized');
});

test('snippet expansion is a mechanical insertion with its own observed denominator',()=>{
 const result=language.analyzeStages({raw:'hello',formatted:'hello kind friend',observed:'hello kind friend',language:'en',observation:'complete'});
 assert.equal(result.formatted.comparison.insertions,2);assert.deepEqual(result.formatted.comparison.pairs,[['','kind friend',1]]);assert.equal(result.observed.comparison.changed,false);
});

test('maximum-size delimiter-free sensitivity probes do not perform quadratic scans',()=>{
 for(const value of ['a'.repeat(65536),'1'.repeat(65536),'a-'.repeat(32768)]){
  const start=performance.now();const result=tokenizeEnglish(value);const elapsed=performance.now()-start;
  assert.notEqual(result.reason,null);assert.ok(elapsed<1000,`bounded exclusion took ${elapsed}ms`);
 }
});
