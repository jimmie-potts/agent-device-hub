/** Module-owned read contracts. They contain no Node implementation or shared SDK changes. */
const closed = (properties:Record<string,object>, required=Object.keys(properties)) => ({type:'object' as const,additionalProperties:false,properties,required});
const integer={type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER};
const nullable=(value:object)=>({anyOf:[{type:'null'},value]});
const text={type:'string',maxLength:512};
const identifier={type:'string',pattern:'^[A-Za-z0-9_.-]{1,128}$'};
const list=(items:object,maximum:number)=>({type:'array',items,maxItems:maximum});
const intake={intakeId:identifier,runId:identifier,poll:integer,receivedAtMs:integer};
const gap=closed({...intake,sequence:integer,reason:{enum:['startup','unavailable','busy','storage','clock']}});
const reader=closed({sha256:{type:'string',pattern:'^[a-f0-9]{64}$'},sourceVersion:{type:'string',maxLength:128}});
const accepted={...intake,sequence:integer,deviceElapsedMs:integer,reader};
const fields=['title','displayTitle','subtitle','artist','album','genre','description','mediaId'];
const metadata=nullable(closed({...Object.fromEntries(fields.map(field=>[field,nullable(text)])),durationMs:nullable(integer)}));
const playback=nullable(closed({state:{type:'integer',minimum:0,maximum:11},positionMs:{...integer,minimum:-1},speed:{type:'number'},positionUpdatedElapsedMs:integer}));
const omission=closed({field:{enum:fields},reason:{enum:['credential-redacted','oversized']}});
const projectionOmission=closed({field:{enum:fields},reason:{const:'projection-limit'},originalBytes:integer});
const session={app:{enum:['youtube','stremio']},metadata,playback,omissions:list(omission,16),projectionOmissions:list(projectionOmission,8)};
const coverage=closed({collectionStartedAtMs:nullable(integer),gapCount:integer,recentGaps:list(gap,20),storageAvailable:{type:'boolean'},pendingGap:nullable(closed({...intake,reason:{const:'storage'}})),
  limits:closed(Object.fromEntries(Object.entries({pollMs:5000,staleMs:15000,candidates:500,textBytes:512,responseBytes:131072,recentGaps:20,sourceSessions:8,sourceTextBytes:8192,sourceReplyBytes:262144}).map(([key,value])=>[key,{const:value}]))),semantics:{const:'observations-only'}});
const provenance=closed({source:{const:'android-media-session'},readerSchema:{const:'onn-metadata/2.0'},semantics:{enum:['selected-title-observed','title-observed']}});
const observation=closed({...accepted,...session,id:{type:'string',pattern:'^obs-[1-9][0-9]*$'},provenance});
const occurrence=closed({id:{type:'string',pattern:'^occ-[1-9][0-9]*$'},app:session.app,firstObservedAtMs:integer,matchingObservedAtMs:integer,identityConfidence:{enum:['unsupported','source-id','ambiguous']},observation});
const page={cutoff:integer,nextCursor:nullable({type:'string',maxLength:4096}),coverage,pageOmissions:list(closed({reason:{const:'response-limit'},continuation:{const:true}}),1)};
export const historyStateSchema=closed({schema:{const:'onn-history-state/2.0'},enabled:{type:'boolean'},status:{enum:['disabled','fresh','stale','unavailable']},current:list(closed(session),8),ambiguous:{type:'boolean'},currentEvidence:{enum:['fresh-observation','last-observed','none']},lastAccepted:nullable(closed(accepted)),coverage});
export const historyPageSchema=closed({schema:{const:'onn-history/2.0'},...page,ordering:{const:'evidence-desc'},items:list(occurrence,100)});
export const historyDetailSchema=closed({schema:{const:'onn-history-detail/2.0'},...page,occurrence,observations:list(observation,100)});
export const historyQuerySchema=closed({app:{enum:['youtube','stremio']},fromMs:integer,toMs:integer,title:{type:'string',maxLength:256},limit:{type:'integer',minimum:1,maximum:100},cursor:{type:'string',minLength:1,maxLength:4096}},[]);
export const historyDetailQuerySchema=closed({id:{type:'string',pattern:'^occ-[1-9][0-9]{0,15}$'},limit:{type:'integer',minimum:1,maximum:100},cursor:{type:'string',minLength:1,maxLength:4096}},['id']);
export const historyRecordSchema=closed({...historyStateSchema.properties,id:{type:'string',pattern:'^[a-z0-9]+(?:-[a-z0-9]+)*$',maxLength:128},revision:integer,configurationRevision:{...integer,minimum:1}});
