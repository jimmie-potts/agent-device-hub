#import <AppKit/AppKit.h>
#import <CoreServices/CoreServices.h>
#include <mach/mach_time.h>
#include <assert.h>
#include <math.h>

static NSString *scenario;
static unsigned sends, controls, checks, discoveries, permissions, itemReads;
static double fakeMs=1000;
static uint64_t fakeTime(void) { return (uint64_t)(fakeMs*1e6); }
static kern_return_t fakeTimebase(mach_timebase_info_t info) { info->numer=1; info->denom=1; return KERN_SUCCESS; }
@interface FakeMusicApplication : NSObject
@property(readonly) pid_t processIdentifier;
@property(readonly) NSString *bundleIdentifier;
@property(readonly) NSDate *launchDate;
@property(readonly) BOOL terminated;
+ (NSArray *)runningApplicationsWithBundleIdentifier:(NSString *)bundle;
+ (instancetype)runningApplicationWithProcessIdentifier:(pid_t)pid;
@end
@implementation FakeMusicApplication
- (pid_t)processIdentifier { return 424242; }
- (NSString *)bundleIdentifier { return [scenario isEqual:@"wrong-bundle"] ? @"invalid.synthetic.application" : @"com.apple.Music"; }
- (BOOL)terminated { return NO; }
- (NSDate *)launchDate {
    if ([scenario isEqual:@"missing-launch"]) return nil;
    return [NSDate dateWithTimeIntervalSince1970:([scenario isEqual:@"restart-read"] && sends>=2) ||
        ([scenario isEqual:@"restart-control"] && controls) || ([scenario isEqual:@"control-restart-before-send"] && permissions) ? 200 : 100];
}
+ (NSArray *)runningApplicationsWithBundleIdentifier:(NSString *)bundle {
    assert([bundle isEqual:@"com.apple.Music"]); ++discoveries;
    if ([scenario isEqual:@"missing"]) return @[];
    if ([scenario isEqual:@"multiple"]) return @[[self new],[self new]];
    return @[[self new]];
}
+ (instancetype)runningApplicationWithProcessIdentifier:(pid_t)pid {
    assert(pid==424242); ++checks;
    if ([scenario isEqual:@"control-slow-process-check"] && checks==4) fakeMs+=1500;
    return [self new];
}
@end

static OSStatus fakePermission(const AEAddressDesc *target,AEEventClass cls,AEEventID event,Boolean ask) {
    assert(target->descriptorType==typeKernelProcessID && !ask); ++permissions;
    assert((cls==kAECoreSuite && event==kAEGetData) || (cls=='hook' && (event=='Play' || event=='Paus' || event=='Next' || event=='Prev')));
    if ([scenario isEqual:@"denied"] || [scenario isEqual:@"control-denied"]) return errAEEventNotPermitted;
    if ([scenario isEqual:@"consent"]) return errAEEventWouldRequireUserConsent;
    return noErr;
}
static NSAppleEventDescriptor *reference(DescType cls,int32_t identifier) {
    NSAppleEventDescriptor *value=NSAppleEventDescriptor.recordDescriptor;
    [value setDescriptor:[NSAppleEventDescriptor descriptorWithTypeCode:cls] forKeyword:keyAEDesiredClass];
    [value setDescriptor:NSAppleEventDescriptor.nullDescriptor forKeyword:keyAEContainer];
    [value setDescriptor:[NSAppleEventDescriptor descriptorWithEnumCode:formUniqueID] forKeyword:keyAEKeyForm];
    [value setDescriptor:[NSAppleEventDescriptor descriptorWithInt32:identifier] forKeyword:keyAEKeyData];
    return [value coerceToDescriptorType:typeObjectSpecifier];
}
static OSStatus fakeSend(const AppleEvent *raw,AppleEvent *reply,AESendMode flags,long timeout) {
    assert(flags==(kAEWaitReply|kAENeverInteract|kAEDoNotPromptForUserConsent|kAEDontRecord|kAEDontReconnect));
    assert(timeout>0 && timeout<=120 && permissions==1 && checks>=2);
    AppleEvent copy={typeNull,NULL}; assert(AEDuplicateDesc(raw,&copy)==noErr);
    NSAppleEventDescriptor *event=[[NSAppleEventDescriptor alloc] initWithAEDescNoCopy:&copy];
    NSAppleEventDescriptor *target=[event attributeDescriptorForKeyword:keyAddressAttr];
    pid_t pid=0; assert(target.descriptorType==typeKernelProcessID && target.data.length==sizeof(pid));
    memcpy(&pid,target.data.bytes,sizeof(pid)); assert(pid==424242);
    NSAppleEventDescriptor *response=[NSAppleEventDescriptor appleEventWithEventClass:kCoreEventClass eventID:kAEAnswer
        targetDescriptor:NSAppleEventDescriptor.nullDescriptor returnID:kAutoGenerateReturnID transactionID:kAnyTransactionID];
    ++sends; fakeMs+=10;
    if (event.eventClass=='hook') {
        ++controls;
        assert(timeout*1000.0/60.0<=4000-(fakeMs-10));
        assert(event.eventID=='Play' || event.eventID=='Paus' || event.eventID=='Next' || event.eventID=='Prev');
        assert([event paramDescriptorForKeyword:keyDirectObject]==nil);
        if ([scenario isEqual:@"control-timeout"]) return errAETimeout;
        if ([scenario isEqual:@"control-refused"]) [response setParamDescriptor:[NSAppleEventDescriptor descriptorWithInt32:-1708] forKeyword:keyErrorNumber];
        if ([scenario isEqual:@"control-invalid-state"]) [response setParamDescriptor:[NSAppleEventDescriptor descriptorWithInt32:-10000] forKeyword:keyErrorNumber];
        if ([scenario isEqual:@"control-invalid-reply"]) response=[NSAppleEventDescriptor descriptorWithString:@"not an event"];
        if ([scenario isEqual:@"control-malformed-error"]) [response setParamDescriptor:[NSAppleEventDescriptor descriptorWithString:@"0"] forKeyword:keyErrorNumber];
        if ([scenario isEqual:@"control-late"]) fakeMs+=4000;
        return AEDuplicateDesc(response.aeDesc,reply);
    }
    assert(event.eventClass==kAECoreSuite && event.eventID==kAEGetData);
    NSAppleEventDescriptor *property=[event paramDescriptorForKeyword:keyDirectObject];
    assert(property.descriptorType==typeObjectSpecifier && property.numberOfItems==4);
    assert([property descriptorForKeyword:keyAEDesiredClass].typeCodeValue==cProperty);
    assert([property descriptorForKeyword:keyAEKeyForm].enumCodeValue==formPropertyID);
    DescType code=[property descriptorForKeyword:keyAEKeyData].typeCodeValue;
    NSAppleEventDescriptor *container=[property descriptorForKeyword:keyAEContainer];
    bool output=container.descriptorType==typeObjectSpecifier && [container descriptorForKeyword:keyAEDesiredClass].typeCodeValue=='cAPD';
    bool track=container.descriptorType==typeObjectSpecifier && [container descriptorForKeyword:keyAEDesiredClass].typeCodeValue=='cTrk';
    assert(output || track || container.descriptorType==typeNull);
    NSAppleEventDescriptor *value=nil;
    switch (code) {
        case 'pPlS': value=[NSAppleEventDescriptor descriptorWithEnumCode:'kPSP']; break;
        case 'pTrk': value=reference('cTrk',100); ++itemReads; break;
        case 'pPIS': assert(track); value=[NSAppleEventDescriptor descriptorWithString:[scenario isEqual:@"changed-item"] && itemReads>1 ? @"beef" : @"cafe"]; break;
        case 'pPos': value=[NSAppleEventDescriptor descriptorWithDouble:12.5]; break;
        case 'pnam': assert(track || output); value=[NSAppleEventDescriptor descriptorWithString:output ? @"Synthetic output" : @"Synthetic title"]; break;
        case 'pArt': assert(track); value=[NSAppleEventDescriptor descriptorWithString:@"Synthetic artist"]; break;
        case 'pAlb': assert(track); value=[NSAppleEventDescriptor descriptorWithString:@"Synthetic album"]; break;
        case 'pDur': assert(track); value=[NSAppleEventDescriptor descriptorWithDouble:120]; break;
        case 'pAPD': {
            value=NSAppleEventDescriptor.listDescriptor;
            unsigned count=[scenario isEqual:@"empty-output"] ? 0 : [scenario isEqual:@"too-many-outputs"] ? 9 :
                [scenario isEqual:@"maximal-json"] ? 8 : 2;
            for (unsigned i=0;i<count;++i) [value insertDescriptor:reference('cAPD',(int32_t)i+1) atIndex:i+1];
            break;
        }
        case 'pKnd': assert(output); value=[NSAppleEventDescriptor descriptorWithEnumCode:'kAPH']; break;
        case 'pAPE': value=[NSAppleEventDescriptor descriptorWithBoolean:YES]; break;
        case 'pAct': case 'pAva': case 'selc': assert(output); value=[NSAppleEventDescriptor descriptorWithBoolean:YES]; break;
        default: assert(!"unexpected or privacy-expanding property");
    }
    if ([scenario isEqual:@"state-invalid"] && code=='pPlS') value=[NSAppleEventDescriptor descriptorWithString:@"playing"];
    if ([scenario isEqual:@"position-zero"] && code=='pPos') value=[NSAppleEventDescriptor descriptorWithDouble:0];
    if ([scenario isEqual:@"position-nan"] && code=='pPos') value=[NSAppleEventDescriptor descriptorWithDouble:NAN];
    if ([scenario isEqual:@"position-string"] && code=='pPos') value=[NSAppleEventDescriptor descriptorWithString:@"12.5"];
    if ([scenario isEqual:@"position-timeout"] && code=='pPos') return errAETimeout;
    if ([scenario isEqual:@"permission-lost"] && code=='pPos') return errAEEventNotPermitted;
    if ([scenario isEqual:@"missing-identity"] && code=='pPIS') return errAENoSuchObject;
    if ([scenario isEqual:@"invalid-identity"] && code=='pPIS') value=[NSAppleEventDescriptor descriptorWithString:@"not a hexadecimal id"];
    if ([scenario isEqual:@"output-unsupported"] && code=='pAPD') return errAEEventNotHandled;
    if ([scenario isEqual:@"output-not-list"] && code=='pAPD') value=reference('cAPD',1);
    if ([scenario isEqual:@"output-not-reference"] && code=='pAPD') { value=NSAppleEventDescriptor.listDescriptor; [value insertDescriptor:[NSAppleEventDescriptor descriptorWithString:@"name"] atIndex:1]; }
    if ([scenario isEqual:@"output-partial"] && code=='pAct') return errAEEventNotHandled;
    if ([scenario isEqual:@"output-invalid-bool"] && code=='selc') value=[NSAppleEventDescriptor descriptorWithInt32:1];
    if ([scenario isEqual:@"output-unknown-kind"] && code=='pKnd') value=[NSAppleEventDescriptor descriptorWithEnumCode:'xxxx'];
    if ([scenario isEqual:@"title-oversized"] && code=='pnam' && track) value=[NSAppleEventDescriptor descriptorWithString:[@"x" stringByPaddingToLength:257 withString:@"x" startingAtIndex:0]];
    if ([scenario isEqual:@"output-label-oversized"] && code=='pnam' && output) value=[NSAppleEventDescriptor descriptorWithString:[@"x" stringByPaddingToLength:129 withString:@"x" startingAtIndex:0]];
    if ([scenario isEqual:@"descriptor-oversized"] && code=='pnam' && track) value=[NSAppleEventDescriptor descriptorWithString:[@"x" stringByPaddingToLength:40000 withString:@"x" startingAtIndex:0]];
    if ([scenario isEqual:@"invalid-utf8"] && code=='pnam' && track) { const unsigned char bytes[]={0xc0,0xaf}; value=[NSAppleEventDescriptor descriptorWithDescriptorType:typeUTF8Text bytes:bytes length:2]; }
    if ([scenario isEqual:@"text-nul"] && code=='pnam' && track) { const unsigned char bytes[]={'a',0,'b'}; value=[NSAppleEventDescriptor descriptorWithDescriptorType:typeUTF8Text bytes:bytes length:3]; }
    if ([scenario isEqual:@"maximal-json"] && (code=='pnam' || code=='pArt' || code=='pAlb')) {
        unichar character=1; NSString *unit=[NSString stringWithCharacters:&character length:1];
        value=[NSAppleEventDescriptor descriptorWithString:[unit stringByPaddingToLength:output ? 128 : 256 withString:unit startingAtIndex:0]];
    }
    if ([scenario isEqual:@"read-invalid-reply"] && code=='pPos') response=[NSAppleEventDescriptor descriptorWithString:@"not an event"];
    else [response setParamDescriptor:value forKeyword:keyDirectObject];
    if ([scenario isEqual:@"slow-reads"]) fakeMs+=fmin(timeout*1000.0/60.0,1800)-10;
    return AEDuplicateDesc(response.aeDesc,reply);
}
#define NSRunningApplication FakeMusicApplication
#define AEDeterminePermissionToAutomateTarget fakePermission
#define AESendMessage fakeSend
#define mach_continuous_time fakeTime
#define mach_timebase_info fakeTimebase
#define main playback_main
#include "../playback.m"
#undef main
int main(int argc,const char *argv[]) {
    @autoreleasepool {
        assert(argc==2); scenario=[NSString stringWithUTF8String:argv[1]];
        bool isControl=[scenario hasPrefix:@"control-"] || [scenario isEqual:@"restart-control"];
        const char *mode=[scenario isEqual:@"clock"] ? "--clock" : [scenario isEqual:@"self-test"] ? "--self-test" :
            [scenario isEqual:@"capture-refused"] ? "--capture" : isControl ? "--control-existing-music" : "--read-existing-music";
        char digest[65]={0};
        if (isControl) {
            MusicPlaybackHost *host=[MusicPlaybackHost new]; assert(selectProcess((__bridge void *)host,digest)==MP_OK);
            discoveries=checks=0;
        }
        const char *action=[scenario isEqual:@"control-play"] ? "play" : [scenario isEqual:@"control-previous"] ? "previous" : [scenario isEqual:@"control-next"] ? "next" : "pause";
        if ([scenario isEqual:@"control-invalid-action"]) action="stop";
        if ([scenario isEqual:@"control-wrong-instance"]) memset(digest,'b',64);
        const char *args[]={"fake-playback",mode,action,digest,[scenario isEqual:@"control-expired"] ? "999" :
            [scenario isEqual:@"control-insufficient-tick"] ? "1000.001" : "4000"};
        int result=playback_main([scenario isEqual:@"no-argument"] ? 1 : isControl ? 5 : 2,args);
        if ([scenario isEqual:@"clock"] || [scenario isEqual:@"self-test"] || [scenario isEqual:@"capture-refused"] || [scenario isEqual:@"no-argument"] || [scenario isEqual:@"control-invalid-action"])
            assert(sends==0 && permissions==0 && checks==0 && discoveries==0);
        if ([scenario isEqual:@"denied"] || [scenario isEqual:@"consent"] || [scenario isEqual:@"control-denied"] || [scenario isEqual:@"control-expired"] || [scenario isEqual:@"control-wrong-instance"]) assert(sends==0);
        if ([scenario isEqual:@"permission-lost"]) assert(sends==4);
        if (isControl) assert(controls<=1);
        return result;
    }
}
