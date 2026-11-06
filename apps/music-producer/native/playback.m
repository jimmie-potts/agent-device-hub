#import <AppKit/AppKit.h>
#import <CoreServices/CoreServices.h>
#include <CommonCrypto/CommonDigest.h>
#include <mach/mach_time.h>
#include <errno.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>
#include "music_playback.h"

static const AESendMode sendFlags=kAEWaitReply|kAENeverInteract|kAEDoNotPromptForUserConsent|kAEDontRecord|kAEDontReconnect;
static double tickMs;
static double nowMs(void) { return mach_continuous_time()*tickMs; }
static double clockNow(void *context) { (void)context; return nowMs(); }
static NSDictionary *interval(MPInterval value) { return @{ @"startedMonotonicMs":@(value.start),@"endedMonotonicMs":@(value.end) }; }
static NSDictionary *failure(MPError error) {
    return @{@"code":@(mp_error_code(error)),@"retryable":@(mp_error_retryable(error)),@"detail":@(mp_error_detail(error))};
}
static MPError statusError(OSStatus status) {
    if (status==errAEEventNotPermitted || status==errAEEventWouldRequireUserConsent) return MP_FORBIDDEN;
    return status==errAEEventNotHandled ? MP_UNSUPPORTED : MP_UNAVAILABLE;
}
static DescType actionCode(MPAction action) {
    switch (action) { case MP_PLAY:return 'Play'; case MP_PAUSE:return 'Paus'; case MP_NEXT:return 'Next'; case MP_PREVIOUS:return 'Prev'; default:return 0; }
}
static NSString *actionName(MPAction action) {
    switch (action) { case MP_PLAY:return @"play"; case MP_PAUSE:return @"pause"; case MP_NEXT:return @"next"; case MP_PREVIOUS:return @"previous"; default:return @""; }
}
static MPAction parseAction(const char *value) {
    if (strcmp(value,"play")==0) return MP_PLAY;
    if (strcmp(value,"pause")==0) return MP_PAUSE;
    if (strcmp(value,"next")==0) return MP_NEXT;
    if (strcmp(value,"previous")==0) return MP_PREVIOUS;
    return MP_READ;
}
static bool bounded(NSAppleEventDescriptor *value) {
    return value && AEGetDescDataSize(value.aeDesc)>=0 && AEGetDescDataSize(value.aeDesc)<=MP_DESCRIPTOR_BYTES;
}
static NSAppleEventDescriptor *property(DescType code,NSAppleEventDescriptor *container) {
    NSAppleEventDescriptor *value=NSAppleEventDescriptor.recordDescriptor;
    [value setDescriptor:[NSAppleEventDescriptor descriptorWithTypeCode:cProperty] forKeyword:keyAEDesiredClass];
    [value setDescriptor:container ?: NSAppleEventDescriptor.nullDescriptor forKeyword:keyAEContainer];
    [value setDescriptor:[NSAppleEventDescriptor descriptorWithEnumCode:formPropertyID] forKeyword:keyAEKeyForm];
    [value setDescriptor:[NSAppleEventDescriptor descriptorWithTypeCode:code] forKeyword:keyAEKeyData];
    return [value coerceToDescriptorType:typeObjectSpecifier];
}
static NSAppleEventDescriptor *readRequest(pid_t pid,DescType code,NSAppleEventDescriptor *container) {
    NSAppleEventDescriptor *event=[NSAppleEventDescriptor appleEventWithEventClass:kAECoreSuite eventID:kAEGetData
        targetDescriptor:[NSAppleEventDescriptor descriptorWithProcessIdentifier:pid] returnID:kAutoGenerateReturnID transactionID:kAnyTransactionID];
    [event setParamDescriptor:property(code,container) forKeyword:keyDirectObject];
    return event;
}
static MPError replyError(NSAppleEventDescriptor *reply) {
    if (!bounded(reply)) return MP_CAPACITY;
    if (reply.descriptorType!=typeAppleEvent || reply.eventClass!=kCoreEventClass || reply.eventID!=kAEAnswer) return MP_INVALID_MESSAGE;
    NSAppleEventDescriptor *error=[reply paramDescriptorForKeyword:keyErrorNumber];
    if (!error) return MP_OK;
    if (error.descriptorType!=typeSInt32 || AEGetDescDataSize(error.aeDesc)!=4) return MP_INVALID_MESSAGE;
    return error.int32Value==0 ? MP_OK : statusError(error.int32Value);
}
static long timeoutTicks(double deadline) {
    double remaining=deadline-nowMs();
    if (!mp_time_valid(deadline) || !isfinite(remaining) || remaining<1000.0/60.0) return 0;
    return (long)fmin(120,floor(remaining*60.0/1000.0));
}
static MPError sendRead(NSAppleEventDescriptor *request,double deadline,NSAppleEventDescriptor **value) {
    long timeout=timeoutTicks(deadline);
    if (!timeout) return MP_EXPIRED;
    AppleEvent raw={typeNull,NULL};
    OSStatus status=AESendMessage(request.aeDesc,&raw,sendFlags,timeout);
    if (status!=noErr) { AEDisposeDesc(&raw); return statusError(status); }
    NSAppleEventDescriptor *reply=[[NSAppleEventDescriptor alloc] initWithAEDescNoCopy:&raw];
    MPError error=replyError(reply);
    if (error!=MP_OK) return error;
    NSAppleEventDescriptor *direct=[reply paramDescriptorForKeyword:keyDirectObject];
    if (!bounded(direct)) return direct ? MP_CAPACITY : MP_INVALID_MESSAGE;
    *value=direct;
    return MP_OK;
}
static MPError textValue(NSAppleEventDescriptor *value,unsigned limit,bool identifier,MPValue *result) {
    if (!bounded(value)) return MP_CAPACITY;
    if (value.descriptorType!=typeUnicodeText && value.descriptorType!=typeUTF8Text && value.descriptorType!=typeChar) return MP_INVALID_MESSAGE;
    NSString *string=value.descriptorType==typeUTF8Text ? [[NSString alloc] initWithData:value.data encoding:NSUTF8StringEncoding] : value.stringValue;
    NSData *bytes=[string dataUsingEncoding:NSUTF8StringEncoding allowLossyConversion:NO];
    if (!bytes || memchr(bytes.bytes,0,bytes.length)) return MP_INVALID_MESSAGE;
    if (bytes.length>limit) return MP_CAPACITY;
    if (identifier && bytes.length==0) return MP_INVALID_MESSAGE;
    result->kind=MP_TEXT;
    memcpy(result->text,bytes.bytes,bytes.length); result->text[bytes.length]='\0';
    if (identifier) for (NSUInteger i=0;i<bytes.length;++i) {
        char c=result->text[i];
        if (c>='a' && c<='f') result->text[i]=(char)(c-'a'+'A');
        else if (!((c>='A' && c<='F') || (c>='0' && c<='9'))) return MP_INVALID_MESSAGE;
    }
    return MP_OK;
}
static MPError numberValue(NSAppleEventDescriptor *value,MPValue *result) {
    if (!bounded(value)) return MP_CAPACITY;
    Size expected;
    switch (value.descriptorType) {
        case typeSInt16:expected=2;break;
        case typeSInt32:case typeUInt32:case typeIEEE32BitFloatingPoint:expected=4;break;
        case typeSInt64:case typeIEEE64BitFloatingPoint:expected=8;break;
        default:return MP_INVALID_MESSAGE;
    }
    if (AEGetDescDataSize(value.aeDesc)!=expected) return MP_INVALID_MESSAGE;
    NSAppleEventDescriptor *number=[value coerceToDescriptorType:typeIEEE64BitFloatingPoint];
    if (!number || number.descriptorType!=typeIEEE64BitFloatingPoint || AEGetDescDataSize(number.aeDesc)!=8) return MP_INVALID_MESSAGE;
    double seconds=number.doubleValue;
    if (!isfinite(seconds) || seconds<0 || seconds>MP_MAX_SECONDS) return MP_INVALID_MESSAGE;
    result->kind=MP_NUMBER; result->number=seconds; return MP_OK;
}
static MPError boolValue(NSAppleEventDescriptor *value,MPValue *result) {
    if (!bounded(value)) return MP_CAPACITY;
    if (value.descriptorType!=typeBoolean || AEGetDescDataSize(value.aeDesc)!=1) return MP_INVALID_MESSAGE;
    unsigned char byte=0; memcpy(&byte,value.data.bytes,1);
    if (byte>1) return MP_INVALID_MESSAGE;
    result->kind=MP_BOOL; result->boolean=byte!=0; return MP_OK;
}
static MPError enumValue(NSAppleEventDescriptor *value,bool state,MPValue *result) {
    if (!bounded(value)) return MP_CAPACITY;
    if (value.descriptorType!=typeEnumerated || AEGetDescDataSize(value.aeDesc)!=4) return MP_INVALID_MESSAGE;
    const DescType states[]={'kPSP','kPSp','kPSS','kPSF','kPSR'};
    const DescType kinds[]={'kAPC','kAPX','kAPT','kAPO','kAPB','kAPH','kAPV','kAPU'};
    const DescType *values=state ? states : kinds;
    unsigned count=state ? 5 : 8;
    for (unsigned i=0;i<count;++i) if (values[i]==value.enumCodeValue) { result->kind=MP_ENUM; result->enumeration=i; return MP_OK; }
    return MP_INVALID_MESSAGE;
}

@interface MusicPlaybackHost : NSObject
@property pid_t pid;
@property(strong) NSDate *launch;
@property(strong) NSAppleEventDescriptor *track;
@property(strong) NSArray<NSAppleEventDescriptor *> *outputs;
@end
@implementation MusicPlaybackHost
@end
static bool sameProcess(void *context) {
    MusicPlaybackHost *host=(__bridge MusicPlaybackHost *)context;
    NSRunningApplication *current=[NSRunningApplication runningApplicationWithProcessIdentifier:host.pid];
    return host.launch && current && current.processIdentifier==host.pid && !current.terminated &&
        [current.bundleIdentifier isEqualToString:@"com.apple.Music"] && [current.launchDate isEqualToDate:host.launch];
}
static MPError selectProcess(void *context,char instance[65]) {
    MusicPlaybackHost *host=(__bridge MusicPlaybackHost *)context;
    NSArray<NSRunningApplication *> *running=[NSRunningApplication runningApplicationsWithBundleIdentifier:@"com.apple.Music"];
    if (running.count!=1) return MP_UNAVAILABLE;
    host.pid=running.firstObject.processIdentifier; host.launch=[running.firstObject.launchDate copy];
    if (!sameProcess(context)) return MP_UNAVAILABLE;
    double launch=host.launch.timeIntervalSince1970;
    if (!isfinite(launch)) return MP_UNAVAILABLE;
    pid_t pid=host.pid;
    NSMutableData *input=[NSMutableData dataWithBytes:&pid length:sizeof(pid)];
    [input appendBytes:&launch length:sizeof(launch)];
    [input appendData:[@"com.apple.Music" dataUsingEncoding:NSUTF8StringEncoding]];
    unsigned char digest[CC_SHA256_DIGEST_LENGTH]; CC_SHA256(input.bytes,(CC_LONG)input.length,digest);
    for (unsigned i=0;i<CC_SHA256_DIGEST_LENGTH;++i) snprintf(instance+i*2,3,"%02x",digest[i]);
    return MP_OK;
}
static MPError permission(void *context,MPAction action) {
    MusicPlaybackHost *host=(__bridge MusicPlaybackHost *)context;
    NSAppleEventDescriptor *target=[NSAppleEventDescriptor descriptorWithProcessIdentifier:host.pid];
    OSStatus status=AEDeterminePermissionToAutomateTarget(target.aeDesc,action==MP_READ ? kAECoreSuite : 'hook',
        action==MP_READ ? kAEGetData : actionCode(action),false);
    return status==noErr ? MP_OK : statusError(status);
}
static MPError readValue(void *context,MPQuery query,unsigned ordinal,double deadline,MPValue *result) {
    MusicPlaybackHost *host=(__bridge MusicPlaybackHost *)context;
    DescType code=0;
    NSAppleEventDescriptor *container=nil,*value=nil;
    if (query==MP_ITEM_BEFORE || query==MP_ITEM_AFTER) {
        MPError error=sendRead(readRequest(host.pid,'pTrk',nil),deadline,&container);
        if (error!=MP_OK) return error;
        if (!sameProcess(context)) return MP_UNAVAILABLE;
        if (container.descriptorType!=typeObjectSpecifier) return MP_INVALID_MESSAGE;
        if (query==MP_ITEM_BEFORE) host.track=container;
        error=sendRead(readRequest(host.pid,'pPIS',container),deadline,&value);
        return error==MP_OK ? textValue(value,MP_ID_BYTES,true,result) : error;
    }
    if (query==MP_OUTPUT_LIST) {
        MPError error=sendRead(readRequest(host.pid,'pAPD',nil),deadline,&value);
        if (error!=MP_OK) return error;
        if (value.descriptorType!=typeAEList || value.numberOfItems<0) return MP_INVALID_MESSAGE;
        if (value.numberOfItems>MP_MAX_OUTPUTS) return MP_CAPACITY;
        NSMutableArray *selected=[NSMutableArray arrayWithCapacity:(NSUInteger)value.numberOfItems];
        for (NSInteger i=1;i<=value.numberOfItems;++i) {
            NSAppleEventDescriptor *item=[value descriptorAtIndex:i];
            if (!bounded(item)) return MP_CAPACITY;
            if (item.descriptorType!=typeObjectSpecifier) return MP_INVALID_MESSAGE;
            [selected addObject:item];
        }
        host.outputs=selected; result->kind=MP_COUNT; result->count=(unsigned)selected.count; return MP_OK;
    }
    switch (query) {
        case MP_STATE:code='pPlS';break;
        case MP_POSITION:code='pPos';break;
        case MP_TITLE:code='pnam';container=host.track;break;
        case MP_ARTIST:code='pArt';container=host.track;break;
        case MP_ALBUM:code='pAlb';container=host.track;break;
        case MP_DURATION:code='pDur';container=host.track;break;
        case MP_AIRPLAY_ENABLED:code='pAPE';break;
        case MP_OUTPUT_NAME:code='pnam';break;
        case MP_OUTPUT_KIND:code='pKnd';break;
        case MP_OUTPUT_ACTIVE:code='pAct';break;
        case MP_OUTPUT_AVAILABLE:code='pAva';break;
        case MP_OUTPUT_SELECTED:code='selc';break;
        default:return MP_INVALID_REQUEST;
    }
    if (query>=MP_TITLE && query<=MP_DURATION && !container) return MP_UNAVAILABLE;
    if (query>=MP_OUTPUT_NAME) {
        if (ordinal>=host.outputs.count) return MP_UNAVAILABLE;
        container=host.outputs[ordinal];
    }
    MPError error=sendRead(readRequest(host.pid,code,container),deadline,&value);
    if (error!=MP_OK) return error;
    if (query==MP_STATE || query==MP_OUTPUT_KIND) return enumValue(value,query==MP_STATE,result);
    if (query==MP_POSITION || query==MP_DURATION) return numberValue(value,result);
    if (query==MP_AIRPLAY_ENABLED || query>=MP_OUTPUT_ACTIVE) return boolValue(value,result);
    return textValue(value,query==MP_OUTPUT_NAME ? MP_OUTPUT_NAME_BYTES : MP_TEXT_BYTES,false,result);
}
static MPControlStatus sendControl(void *context,MPAction action,double deadline,MPError *error,MPInterval *send,bool *attempted) {
    MusicPlaybackHost *host=(__bridge MusicPlaybackHost *)context;
    NSAppleEventDescriptor *event=[NSAppleEventDescriptor appleEventWithEventClass:'hook' eventID:actionCode(action)
        targetDescriptor:[NSAppleEventDescriptor descriptorWithProcessIdentifier:host.pid] returnID:kAutoGenerateReturnID transactionID:kAnyTransactionID];
    if (!sameProcess(context)) { *error=MP_UNAVAILABLE; return MP_UNSENT; }
    long timeout=timeoutTicks(deadline);
    if (!timeout) { *error=MP_EXPIRED; return MP_UNSENT; }
    send->start=nowMs();
    if (send->start>=deadline) { *error=MP_EXPIRED; return MP_UNSENT; }
    *attempted=true;
    AppleEvent raw={typeNull,NULL};
    OSStatus status=AESendMessage(event.aeDesc,&raw,sendFlags,timeout);
    send->end=nowMs();
    if (status!=noErr) { AEDisposeDesc(&raw); *error=MP_UNCERTAIN; return MP_UNKNOWN; }
    NSAppleEventDescriptor *reply=[[NSAppleEventDescriptor alloc] initWithAEDescNoCopy:&raw];
    if (!bounded(reply) || reply.descriptorType!=typeAppleEvent || reply.eventClass!=kCoreEventClass || reply.eventID!=kAEAnswer) { *error=MP_UNCERTAIN; return MP_UNKNOWN; }
    NSAppleEventDescriptor *replyNumber=[reply paramDescriptorForKeyword:keyErrorNumber];
    if (replyNumber && (replyNumber.descriptorType!=typeSInt32 || AEGetDescDataSize(replyNumber.aeDesc)!=4)) { *error=MP_UNCERTAIN; return MP_UNKNOWN; }
    if (replyNumber && replyNumber.int32Value!=0) {
        *error=replyNumber.int32Value==errAEEventNotPermitted ? MP_FORBIDDEN :
            replyNumber.int32Value==errAEEventNotHandled ? MP_UNSUPPORTED : MP_INVALID_STATE;
        return MP_REFUSED;
    }
    *error=MP_OK; return MP_SENT;
}
static NSDictionary *field(MPField value,NSArray<NSString *> *names) {
    if (value.error!=MP_OK) return @{@"status":@"unavailable",@"error":failure(value.error),@"interval":interval(value.interval)};
    id observed=nil;
    switch (value.value.kind) {
        case MP_NUMBER:observed=@(value.value.number);break;
        case MP_TEXT:observed=@(value.value.text);break;
        case MP_ENUM:if (value.value.enumeration<names.count) observed=names[value.value.enumeration];break;
        case MP_BOOL:observed=@(value.value.boolean);break;
        default:break;
    }
    if (!observed) return @{@"status":@"unavailable",@"error":failure(MP_INVALID_MESSAGE),@"interval":interval(value.interval)};
    return @{@"status":@"observed",@"value":observed,@"interval":interval(value.interval)};
}
static NSDictionary *selection(MPSelection value) {
    if (value.error!=MP_OK) return @{@"status":@"unavailable",@"error":failure(value.error),@"interval":interval(value.interval)};
    NSArray *kinds=@[@"computer",@"airport-express",@"apple-tv",@"airplay-device",@"bluetooth",@"homepod",@"tv",@"unknown"];
    NSMutableArray *devices=[NSMutableArray arrayWithCapacity:value.count];
    for (unsigned i=0;i<value.count;++i) {
        MPOutput device=value.devices[i];
        [devices addObject:@{@"ordinal":@(i),@"name":field(device.name,nil),@"kind":field(device.kind,kinds),
            @"active":field(device.active,nil),@"available":field(device.available,nil),@"selected":field(device.selected,nil)}];
    }
    return @{@"status":@"observed",@"provenance":@"music-declared-selection",@"interval":interval(value.interval),
        @"selectionInterval":interval(value.selection_interval),@"airPlayEnabled":field(value.airplay_enabled,nil),@"devices":devices};
}
static NSDictionary *observation(MPObservation value) {
    if (value.error!=MP_OK) return @{@"schema":@"music-playback-read/1.0",@"status":@"unavailable",@"error":failure(value.error),@"interval":interval(value.interval)};
    NSArray *states=@[@"playing",@"paused",@"stopped",@"fast-forwarding",@"rewinding"];
    return @{@"schema":@"music-playback-read/1.0",@"status":@"sample",@"sourceInstance":@(value.instance),@"interval":interval(value.interval),
        @"state":field(value.state,states),@"position":field(value.position,nil),@"item":field(value.item,nil),
        @"itemAssociation":value.item_associated ? @{@"status":@"bounded-match",@"interval":interval(value.association)} : @{@"status":@"unavailable"},
        @"metadata":@{@"title":field(value.title,nil),@"artist":field(value.artist,nil),@"album":field(value.album,nil),@"durationSeconds":field(value.duration,nil)},
        @"outputSelection":selection(value.output)};
}
static NSDictionary *command(MPCommand value) {
    NSArray *statuses=@[@"unsent",@"sent",@"refused",@"uncertain"];
    NSMutableDictionary *record=[@{@"schema":@"music-playback-control/1.0",@"action":actionName(value.action),
        @"expectedSourceInstance":@(value.expected_instance),@"interval":interval(value.interval),
        @"sendInterval":value.attempted ? interval(value.send) : (id)NSNull.null,@"status":statuses[value.status]} mutableCopy];
    if (value.status!=MP_SENT) record[@"error"]=failure(value.error);
    return record;
}
static bool validInterval(MPInterval value) { return mp_time_valid(value.start) && mp_time_valid(value.end) && value.start<=value.end; }
static int emit(NSDictionary *record,int exitCode) {
    NSData *data=[NSJSONSerialization dataWithJSONObject:record options:NSJSONWritingSortedKeys error:nil];
    if (!data || data.length>=MP_RECORD_BYTES) {
        NSDictionary *fallback=@{@"schema":@"music-playback-read/1.0",@"status":@"unavailable",@"error":failure(MP_CAPACITY),
            @"interval":record[@"interval"] ?: interval((MPInterval){nowMs(),nowMs()})};
        data=[NSJSONSerialization dataWithJSONObject:fallback options:NSJSONWritingSortedKeys error:nil]; exitCode=1;
    }
    if (!data || fwrite(data.bytes,1,data.length,stdout)!=data.length || fputc('\n',stdout)==EOF || fflush(stdout)!=0) return 1;
    return exitCode;
}
static int selfTest(void) {
    MPValue result={0};
    bool valid=numberValue([NSAppleEventDescriptor descriptorWithDouble:0],&result)==MP_OK &&
        numberValue([NSAppleEventDescriptor descriptorWithDouble:NAN],&result)==MP_INVALID_MESSAGE &&
        textValue([NSAppleEventDescriptor descriptorWithString:@"cafe"],MP_ID_BYTES,true,&result)==MP_OK && strcmp(result.text,"CAFE")==0;
    NSAppleEventDescriptor *event=readRequest(999999,'pPos',nil);
    valid=valid && event.eventClass==kAECoreSuite && event.eventID==kAEGetData &&
        [event attributeDescriptorForKeyword:keyAddressAttr].descriptorType==typeKernelProcessID;
    return emit(@{@"schema":@"music-playback-self-test/1.0",@"passed":@(valid)},valid ? 0 : 1);
}
int main(int argc,const char *argv[]) {
    @autoreleasepool {
        mach_timebase_info_data_t timebase;
        if (mach_timebase_info(&timebase)!=KERN_SUCCESS || !timebase.denom) return 1;
        tickMs=(double)timebase.numer/timebase.denom/1e6;
        double start=nowMs();
        if (!mp_time_valid(start)) return 1;
        if (argc==2 && strcmp(argv[1],"--clock")==0) return emit(@{@"schema":@"music-playback-clock/1.0",@"monotonicMs":@(nowMs())},0);
        if (argc==2 && strcmp(argv[1],"--self-test")==0) return selfTest();
        bool read=argc==2 && strcmp(argv[1],"--read-existing-music")==0;
        MPAction action=argc==5 && strcmp(argv[1],"--control-existing-music")==0 ? parseAction(argv[2]) : MP_READ;
        double deadline=0; char *end=NULL;
        if (action!=MP_READ) { errno=0; deadline=strtod(argv[4],&end); }
        if (!read && (action==MP_READ || !mp_instance_valid(argv[3]) || !end || *end || errno || !mp_time_valid(deadline))) {
            return emit(@{@"schema":@"music-playback-read/1.0",@"status":@"unavailable",@"error":failure(MP_INVALID_REQUEST),@"interval":interval((MPInterval){start,nowMs()})},1);
        }
        MusicPlaybackHost *host=[MusicPlaybackHost new];
        MPAPI api={(__bridge void *)host,clockNow,selectProcess,sameProcess,permission,readValue,sendControl};
        if (read) { MPObservation value=mp_observe(&api); return emit(observation(value),value.error==MP_OK ? 0 : 1); }
        MPCommand value=mp_command(&api,action,argv[3],deadline);
        if (!validInterval(value.interval) || (value.attempted && (!validInterval(value.send) ||
            value.send.start<value.interval.start || value.send.end>value.interval.end))) return 1;
        return emit(command(value),value.status==MP_SENT ? 0 : 1);
    }
}
