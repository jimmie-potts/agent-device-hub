import { createHash } from 'node:crypto';
import type { LanguageOptions } from './config.js';
import { APPS, CATEGORIES, appCategory, localDate, type App, type Category, type LanguageSection, type LanguageTable, type PresetWindow } from '@jimmie-potts/wispr-contracts';

export const LANGUAGE_VERSION='english-1';
export const STOPWORD_VERSION='english-stop-1';
export const MAX_STAGE_TOKENS=2000;
export const MAX_STAGE_BYTES=65536;
export type Tokenized={tokens:(string|null)[];reason:null|'oversized'|'sensitive'};
export type Counts=[string,number][];
export type WordFeatures={words:Counts;usefulWords:Counts;phrases:Counts};
export const MAX_ALIGNMENT_CELLS=1_000_000;
export type ChangeFeatures={availability:'available';insertions:number;deletions:number;substitutions:number;changed:boolean;pairs:[string,string,number][];longChanges:number};
export type Alignment=ChangeFeatures|{availability:'unavailable';reason:'oversized'|'work-budget'};

/** Unit-cost Levenshtein alignment, with stable substitution/delete/insert tie order. */
export function alignTokens(before:readonly string[],after:readonly string[]):Alignment {
  if(before.length>MAX_STAGE_TOKENS||after.length>MAX_STAGE_TOKENS)return {availability:'unavailable',reason:'oversized'};
  const width=after.length+1,cells=(before.length+1)*width;
  if(cells>MAX_ALIGNMENT_CELLS)return {availability:'unavailable',reason:'work-budget'};
  const distances=new Uint16Array(cells);
  for(let i=0;i<=before.length;i++)distances[i*width]=i;
  for(let j=0;j<width;j++)distances[j]=j;
  for(let i=1;i<=before.length;i++)for(let j=1;j<width;j++)distances[i*width+j]=Math.min(
    distances[(i-1)*width+j]+1,distances[i*width+j-1]+1,distances[(i-1)*width+j-1]+Number(before[i-1]!==after[j-1]));
  const operations:{kind:'same'|'insert'|'delete'|'substitute';before:string;after:string}[]=[];
  let i=before.length,j=after.length;
  while(i||j){
    const cost=distances[i*width+j];
    if(i&&j&&before[i-1]===after[j-1]&&cost===distances[(i-1)*width+j-1]){operations.push({kind:'same',before:before[--i],after:after[--j]});}
    else if(i&&j&&cost===distances[(i-1)*width+j-1]+1){operations.push({kind:'substitute',before:before[--i],after:after[--j]});}
    else if(i&&cost===distances[(i-1)*width+j]+1){operations.push({kind:'delete',before:before[--i],after:''});}
    else {operations.push({kind:'insert',before:'',after:after[--j]});}
  }
  const result:ChangeFeatures={availability:'available',insertions:0,deletions:0,substitutions:0,changed:false,pairs:[],longChanges:0};
  const pairs=new Map<string,number>();let left:string[]=[],right:string[]=[];
  const flush=()=>{
    if(!left.length&&!right.length)return;
    if(left.length>5||right.length>5||left.join(' ').length>200||right.join(' ').length>200)result.longChanges++;
    else {const key=JSON.stringify([left.join(' '),right.join(' ')]);pairs.set(key,(pairs.get(key)??0)+1);}
    left=[];right=[];
  };
  for(const op of operations.reverse()){
    if(op.kind==='same'){flush();continue;}
    result.changed=true;
    if(op.kind==='insert')result.insertions++;else if(op.kind==='delete')result.deletions++;else result.substitutions++;
    if(op.before)left.push(op.before);if(op.after)right.push(op.after);
  }
  flush();result.pairs=[...pairs].sort((a,b)=>ordinal(a[0],b[0])).map(([key,count])=>{const [left,right]=JSON.parse(key) as [string,string];return [left,right,count];});
  return result;
}
const STOPWORDS=new Set(('a an and are as at be been being but by can could did do does doing for from had has have having he her here hers herself him himself his how i if in into is it its itself just me more most my myself no nor not of on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself yourselves').split(' '));
const ordinal=(a:string,b:string)=>a<b?-1:a>b?1:0;
const ordered=(counts:Map<string,number>):Counts=>[...counts].sort((a,b)=>ordinal(a[0],b[0]));

/** Private unordered derivatives; callers never retain the input token sequence. */
export function wordFeatures(tokens:readonly(string|null)[]):WordFeatures {
  const words=new Map<string,number>(),phrases=new Map<string,number>();
  for(let i=0;i<tokens.length;i++){
    const word=tokens[i];if(word===null)continue;
    words.set(word,(words.get(word)??0)+1);
    let phrase=word;
    for(let j=i+1;j<Math.min(i+5,tokens.length)&&tokens[j]!==null;j++){
      phrase+=' '+tokens[j];phrases.set(phrase,(phrases.get(phrase)??0)+1);
    }
  }
  const all=ordered(words);
  return {words:all,usefulWords:all.filter(([word])=>!STOPWORDS.has(word)),phrases:ordered(phrases)};
}

/** Versioned English caseless spelling; punctuation never becomes executable output. */
export function foldEnglish(value:string):string {
  return value.normalize('NFKC').replace(/[’‘ʼ]/g,"'").toUpperCase().toLowerCase();
}
export function tokenizeEnglish(value:string,excludedTerms:readonly string[]=[]):Tokenized {
  const excluded=(reason:Exclude<Tokenized['reason'],null>):Tokenized=>({tokens:[],reason});
  if(Buffer.byteLength(value)>MAX_STAGE_BYTES)return excluded('oversized');
  let text=foldEnglish(value);
  if(Buffer.byteLength(text)>MAX_STAGE_BYTES)return excluded('oversized');
  // Conservative whole-stage exclusion avoids leaking fragments of structured private values.
  if(/(?:https?:\/\/|www\.|(?<![\p{L}\d._%+-])[\p{L}\d._%+-]+@[\p{L}\d.-]+\.[\p{L}]{2,}|\b[a-z]:[\\/]|(?:^|\s)(?:\/|~\/|\.{1,2}\/|\\\\)|(?<![\p{L}\d_.-])[\p{L}\d_.-]+[\\/][\p{L}\d_.\\/-]+|\b(?:sk-|gh[pousr]_|akia)[a-z\d_-]+)/u.test(text))return excluded('sensitive');
  for(const m of text.matchAll(/\+?\d[\d\s().-]{5,}\d/g))if((m[0].match(/\d/g)??[]).length>=7)return excluded('sensitive');
  for(const m of text.matchAll(/[a-z\d_+/=-]{24,}/g))if(/[a-z]/.test(m[0])&&/\d/.test(m[0]))return excluded('sensitive');
  // Match against the original normalized input, including overlapping matches.
  // A difference array masks their union without retaining an unbounded match list.
  const spans=new Int32Array(text.length+1);
  for(const folded of new Set(excludedTerms.map(term=>foldEnglish(term).trim()))){
    if(!folded)continue;
    const escaped=folded.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const matches=new RegExp('(?<![\\p{L}\\p{M}\\p{N}])(?=('+escaped+')(?![\\p{L}\\p{M}\\p{N}]))','gu');
    for(const match of text.matchAll(matches)){spans[match.index]++;spans[match.index+match[1].length]--;}
  }
  const parts:string[]=[];let depth=0,start=0,masked=false;
  for(let i=0;i<=text.length;i++){
    depth+=spans[i];
    if(depth>0&&!masked){parts.push(text.slice(start,i),'\0');masked=true;}
    else if(depth===0&&masked){start=i;masked=false;}
  }
  parts.push(text.slice(start));text=parts.join('');
  const tokens:(string|null)[]=[];let count=0;const window:string[]=[];
  for(const m of text.matchAll(/\0|\p{L}[\p{L}\p{M}]*(?:'\p{L}[\p{L}\p{M}]*)*/gu)){
    if(m[0]==='\0'){tokens.push(null);window.length=0;continue;}
    if(++count>MAX_STAGE_TOKENS)return excluded('oversized');
    window.push(m[0]);if(window.length>5)window.shift();
    // Every possible phrase/change endpoint must fit the unchanged wire string bound.
    if(window.join(' ').length>200)return excluded('oversized');
    tokens.push(m[0]);
  }
  return {tokens,reason:null};
}

export type StageReason='missing'|'unsupportedLanguage'|'oversized'|'uncertain';
export type StageFeatures=WordFeatures & {reason:StageReason|null;comparison:ChangeFeatures|null;comparisonReason:StageReason|null};
export type LanguageFeatures=Record<'raw'|'formatted'|'observed',StageFeatures>;
export type LanguageInput={raw:string|null;formatted:string|null;observed:string|null;language:string|null;observation:'complete'|'partial'|'unknown'|null;oversized?:('raw'|'formatted'|'observed')[]};

/** Completeness qualifies a captured observation, never finality or successful delivery. */
export function analyzeStages(input:LanguageInput,excludedTerms:readonly string[]=[]):LanguageFeatures {
  const stages=['raw','formatted','observed'] as const;
  const tokens:Partial<Record<typeof stages[number],(string|null)[]>>={};
  const result={} as LanguageFeatures;
  for(const stage of stages){
    const value=input[stage];let reason:StageReason|null=null;
    if(input.oversized?.includes(stage))reason='oversized';
    else if(value===null)reason='missing';
    else if(!/^en(?:-[a-z0-9]{2,8})*$/i.test(input.language??''))reason='unsupportedLanguage';
    else if(stage==='observed'&&input.observation!=='complete')reason='uncertain';
    else {
      const parsed=tokenizeEnglish(value,excludedTerms);
      reason=parsed.reason==='sensitive'?'uncertain':parsed.reason;
      if(!reason)tokens[stage]=parsed.tokens;
    }
    result[stage]={...wordFeatures(tokens[stage]??[]),reason,comparison:null,comparisonReason:null};
  }
  for(const [before,after] of [['raw','formatted'],['formatted','observed']] as const){
    const target=result[after],a=tokens[before],b=tokens[after];
    if(result[before].reason||target.reason){target.comparisonReason=target.reason??result[before].reason;continue;}
    if(!a||!b||a.includes(null)||b.includes(null)){target.comparisonReason='uncertain';continue;}
    const comparison=alignTokens(a as string[],b as string[]);
    if(comparison.availability==='available')target.comparison=comparison;
    else target.comparisonReason='oversized';
  }
  return result;
}

export type RetainedLanguage={sourceTime:number;app:App;features:LanguageFeatures|null};
const rankKinds=['words','usefulWords','phrases','changes'] as const;
type RankKind=typeof rankKinds[number];
type RankedEntry=[string,{occurrences:number;dictations:number}];
type Ranked=Map<string,RankedEntry[1]>;
const partitionFull=Symbol('ranking-partition-full');
const rankOrder=(a:RankedEntry,b:RankedEntry)=>b[1].occurrences-a[1].occurrences||b[1].dictations-a[1].dictations||ordinal(a[0],b[0]);
/** Stable disjoint assignment; collisions share a working set, never a count. */
function keyPartition(text:string):number {
  let hash=2166136261;
  for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619);
  return hash>>>28;
}
const corpora=['raw','formatted','observed'] as const;
type Corpus=typeof corpora[number];
const subgroups:[App|'all',Category|'all'][]=[['all','all'],...CATEGORIES.map(c=>['all',c] as ['all',Category]),...APPS.flatMap(a=>[[a,'all'],[a,appCategory(a)]] as [App,Category|'all'][])];

function rankingBatch(readRows:()=>Iterable<RetainedLanguage>,preset:PresetWindow,corpus:Corpus,timezone:string,partitions:1|16):LanguageTable[] {
  const groups:{table:LanguageTable;maps:Record<RankKind,Ranked>;best:Record<RankKind,RankedEntry[]>;qualified:Record<RankKind,number>}[]=[];
  const index=new Map<string,typeof groups[number]>();
  for(const [app,category] of subgroups){
    const table:LanguageTable={preset:preset.key,app,category,corpus,words:[],usefulWords:[],phrases:[],changes:[],omitted:{words:0,usefulWords:0,phrases:0,changes:0},coverage:{eligible:0,missing:0,unsupportedLanguage:0,oversized:0,uncertain:0,longChanges:0},comparison:corpus==='raw'?'none':corpus==='formatted'?'raw-to-formatted':'formatted-to-observed',finality:'unknown',insertions:0,deletions:0,substitutions:0,comparedDictations:0,changedDictations:0};
    const group={table,maps:{words:new Map(),usefulWords:new Map(),phrases:new Map(),changes:new Map()},best:{words:[],usefulWords:[],phrases:[],changes:[]},qualified:{words:0,usefulWords:0,phrases:0,changes:0}};
    groups.push(group);index.set(JSON.stringify([app,category]),group);
  }
  try{
    for(let partition=0;partition<partitions;partition++){
      let keys=0;
      const add=(map:Ranked,text:string,occurrences:number)=>{
        let count=map.get(text);
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- a symbol sentinel the partition loop catches
        if(!count){if(++keys>250_000)throw partitionFull;count={occurrences:0,dictations:0};map.set(text,count);}
        count.occurrences+=occurrences;count.dictations++;
      };
      const select=(counts:Counts):Counts=>partitions===1?counts:counts.filter(([text])=>keyPartition(text)===partition);
      for(const row of readRows()){
        const date=localDate(row.sourceTime,timezone),category=appCategory(row.app);
        if(date>preset.to||(preset.from!==null&&date<preset.from))continue;
        const stage=row.features?.[corpus],comparison=stage?.comparison;
        // Hash each record's key once per pass, then reuse across its four groups.
        const selected:Record<RankKind,Counts>={words:stage?.reason===null?select(stage.words):[],usefulWords:stage?.reason===null?select(stage.usefulWords):[],phrases:stage?.reason===null?select(stage.phrases):[],changes:select(comparison?.pairs.map(([before,after,count])=>[JSON.stringify([before,after]),count])??[])};
        for(const [app,cat] of [['all','all'],['all',category],[row.app,'all'],[row.app,category]]){
          const {table,maps}=index.get(JSON.stringify([app,cat]))!;
          if(!stage){if(partition===0)table.coverage.uncertain++;continue;}
          if(partition===0){
            const reasons=new Set<StageReason>();if(stage.reason)reasons.add(stage.reason);if(stage.comparisonReason)reasons.add(stage.comparisonReason);
            for(const reason of reasons)table.coverage[reason]++;
            if(stage.reason===null)table.coverage.eligible++;
            if(comparison){
              table.comparedDictations++;if(comparison.changed)table.changedDictations++;
              table.insertions+=comparison.insertions;table.deletions+=comparison.deletions;table.substitutions+=comparison.substitutions;table.coverage.longChanges+=comparison.longChanges;
            }
          }
          for(const kind of rankKinds)for(const [text,count] of selected[kind])add(maps[kind],text,count);
        }
      }
      for(const group of groups)for(const kind of rankKinds){
        const qualified=[...group.maps[kind]].filter(([,count])=>count.dictations>=3).sort(rankOrder);
        group.qualified[kind]+=qualified.length;
        // A global top-100 key must appear in its own partition's top 100.
        group.best[kind]=[...group.best[kind],...qualified.slice(0,100)].sort(rankOrder).slice(0,100);
        group.maps[kind].clear();
      }
    }
    for(const {table,best,qualified} of groups)for(const kind of rankKinds){
      table.omitted[kind]=Math.max(0,qualified[kind]-100);
      if(kind==='changes')table.changes=best[kind].map(([key,count])=>{const [before,after]=JSON.parse(key) as [string,string];return {before,after,...count};});
      else table[kind]=best[kind].map(([text,count])=>({text,...count}));
    }
    return groups.map(group=>group.table);
  }finally{
    // An overflowed attempt must release partial maps before the bounded retry.
    for(const group of groups)for(const kind of rankKinds)group.maps[kind].clear();
  }
}

/** Each input is one distinct contribution; every bounded pass reopens its reader. */
export function aggregateLanguage(rows:readonly RetainedLanguage[]|(()=>Iterable<RetainedLanguage>),presets:readonly PresetWindow[],timezone:string):LanguageSection {
  const readRows=typeof rows==='function'?rows:()=>rows;
  const tables=new Map<string,LanguageTable>();
  for(const preset of presets)for(const corpus of corpora){
    let batch:LanguageTable[];
    try{batch=rankingBatch(readRows,preset,corpus,timezone,1);}catch(error){
      if(error!==partitionFull)throw error;
      try{batch=rankingBatch(readRows,preset,corpus,timezone,16);}catch(retryError){
        if(retryError===partitionFull)throw new Error('aggregate-capacity');
        throw retryError;
      }
    }
    for(const table of batch)tables.set(JSON.stringify([preset.key,table.app,table.category,corpus]),table);
  }
  return {availability:'available',algorithmVersion:LANGUAGE_VERSION,stopwordVersion:STOPWORD_VERSION,tables:presets.flatMap(preset=>subgroups.flatMap(([app,category])=>corpora.map(corpus=>tables.get(JSON.stringify([preset.key,app,category,corpus]))!)))};
}

/** Hash options so private owner exclusion strings are not copied into store metadata. */
export function languagePolicy(options:LanguageOptions):string {
  return createHash('sha256').update(JSON.stringify([LANGUAGE_VERSION,STOPWORD_VERSION,[...new Set(options.excludedApps??[])].sort(),[...new Set((options.excludedTerms??[]).map(foldEnglish))].sort()])).digest('hex');
}
