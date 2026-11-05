#import <AppKit/AppKit.h>
#import <CoreServices/CoreServices.h>
#include <CommonCrypto/CommonDigest.h>
#include <mach/mach_time.h>
#include <math.h>

static const AESendMode sendFlags=kAEWaitReply|kAENeverInteract|kAEDoNotPromptForUserConsent|kAEDontRecord|kAEDontReconnect;
static const long sendTicks=120;
static double tickMs;
static double nowMs(void) { return mach_continuous_time()*tickMs; }
static NSDictionary *interval(double start,double end) { return @{ @"startedMonotonicMs":@(start), @"endedMonotonicMs":@(end) }; }
static NSDictionary *failure(NSString *code) {
    NSDictionary *details=@{@"unavailable":@"The selected Music process or read is unavailable.",
        @"forbidden":@"Music automation permission is unavailable without prompting.",
        @"invalid-message":@"Music returned an invalid state or position descriptor.",
        @"invalid-request":@"Use --clock, --self-test or explicitly select --read-existing-music."};
    return @{ @"code":code, @"retryable":@([code isEqual:@"unavailable"]), @"detail":details[code] };
}
static NSDictionary *statusFailure(OSStatus status) {
    return failure(status==errAEEventNotPermitted || status==errAEEventWouldRequireUserConsent ? @"forbidden" : @"unavailable");
}
static int emit(NSDictionary *record,int code) {
    NSData *data=[NSJSONSerialization dataWithJSONObject:record options:NSJSONWritingSortedKeys error:nil];
    if (!data || data.length>4095 || fwrite(data.bytes,1,data.length,stdout)!=data.length || fputc('\n',stdout)==EOF || fflush(stdout)!=0) return 1;
    return code;
}
static int unavailable(NSDictionary *error,double start) {
    return emit(@{@"schema":@"music-position-read/1.0",@"status":@"unavailable",@"error":error,@"interval":interval(start,nowMs())},1);
}
static NSAppleEventDescriptor *readRequest(pid_t pid,DescType code) {
    NSAppleEventDescriptor *property=NSAppleEventDescriptor.recordDescriptor;
    [property setDescriptor:[NSAppleEventDescriptor descriptorWithTypeCode:cProperty] forKeyword:keyAEDesiredClass];
    [property setDescriptor:NSAppleEventDescriptor.nullDescriptor forKeyword:keyAEContainer];
    [property setDescriptor:[NSAppleEventDescriptor descriptorWithEnumCode:formPropertyID] forKeyword:keyAEKeyForm];
    [property setDescriptor:[NSAppleEventDescriptor descriptorWithTypeCode:code] forKeyword:keyAEKeyData];
    NSAppleEventDescriptor *event=[NSAppleEventDescriptor appleEventWithEventClass:kAECoreSuite eventID:kAEGetData
        targetDescriptor:[NSAppleEventDescriptor descriptorWithProcessIdentifier:pid]
        returnID:kAutoGenerateReturnID transactionID:kAnyTransactionID];
    [event setParamDescriptor:[property coerceToDescriptorType:typeObjectSpecifier] forKeyword:keyDirectObject];
    return event;
}
static NSString *stateValue(NSAppleEventDescriptor *value) {
    if (value.descriptorType!=typeEnumerated || value.data.length!=sizeof(DescType)) return nil;
    switch (value.enumCodeValue) {
        case 'kPSS': return @"stopped";
        case 'kPSP': return @"playing";
        case 'kPSp': return @"paused";
        case 'kPSF': return @"fast-forwarding";
        case 'kPSR': return @"rewinding";
        default: return nil;
    }
}
static NSNumber *positionValue(NSAppleEventDescriptor *value) {
    NSUInteger length;
    switch (value.descriptorType) {
        case typeSInt16: length=2; break;
        case typeSInt32: case typeUInt32: case typeIEEE32BitFloatingPoint: length=4; break;
        case typeSInt64: case typeIEEE64BitFloatingPoint: length=8; break;
        default: return nil;
    }
    if (value.data.length!=length) return nil;
    NSAppleEventDescriptor *number=[value coerceToDescriptorType:typeIEEE64BitFloatingPoint];
    if (!number || number.descriptorType!=typeIEEE64BitFloatingPoint || number.data.length!=sizeof(double)) return nil;
    double seconds=number.doubleValue;
    return isfinite(seconds) && seconds>=0 && seconds<=9007199254740.991 ? @(seconds) : nil;
}
static NSDictionary *decoded(NSAppleEventDescriptor *reply,DescType code) {
    NSAppleEventDescriptor *error=[reply paramDescriptorForKeyword:keyErrorNumber];
    if (error) {
        if (error.descriptorType!=typeSInt32 || error.data.length!=sizeof(SInt32)) return @{ @"error":failure(@"invalid-message") };
        if (error.int32Value!=noErr) return @{ @"error":statusFailure(error.int32Value) };
    }
    NSAppleEventDescriptor *value=[reply paramDescriptorForKeyword:keyDirectObject];
    id result=code=='pPlS' ? stateValue(value) : positionValue(value);
    return result ? @{ @"value":result } : @{ @"error":failure(@"invalid-message") };
}
static bool stillSelected(pid_t pid,NSDate *launch) {
    NSRunningApplication *current=[NSRunningApplication runningApplicationWithProcessIdentifier:pid];
    return launch && current && current.processIdentifier==pid && !current.terminated &&
        [current.bundleIdentifier isEqualToString:@"com.apple.Music"] && [current.launchDate isEqualToDate:launch];
}
static NSString *instance(pid_t pid,NSDate *launch) {
    double time=launch.timeIntervalSince1970;
    NSMutableData *input=[NSMutableData dataWithBytes:&pid length:sizeof(pid)];
    [input appendBytes:&time length:sizeof(time)];
    [input appendData:[@"com.apple.Music" dataUsingEncoding:NSUTF8StringEncoding]];
    unsigned char digest[CC_SHA256_DIGEST_LENGTH];
    CC_SHA256(input.bytes,(CC_LONG)input.length,digest);
    NSMutableString *hex=[NSMutableString stringWithCapacity:64];
    for (unsigned i=0;i<CC_SHA256_DIGEST_LENGTH;++i) [hex appendFormat:@"%02x",digest[i]];
    return hex;
}
static NSDictionary *readProperty(pid_t pid,DescType code) {
    NSAppleEventDescriptor *request=readRequest(pid,code);
    AppleEvent reply={typeNull,NULL};
    double start=nowMs();
    OSStatus status=AESendMessage(request.aeDesc,&reply,sendFlags,sendTicks);
    double end=nowMs();
    NSMutableDictionary *result;
    if (status==noErr) result=[decoded([[NSAppleEventDescriptor alloc] initWithAEDescNoCopy:&reply],code) mutableCopy];
    else { AEDisposeDesc(&reply); result=[@{@"error":statusFailure(status)} mutableCopy]; }
    result[@"interval"]=interval(start,end);
    return result;
}
static int selfTest(void) {
    bool valid=stateValue([NSAppleEventDescriptor descriptorWithEnumCode:'kPSP'])!=nil &&
        stateValue([NSAppleEventDescriptor descriptorWithEnumCode:'xxxx'])==nil &&
        [positionValue([NSAppleEventDescriptor descriptorWithDouble:12.5]) isEqual:@12.5] &&
        !positionValue([NSAppleEventDescriptor descriptorWithString:@"12.5"]) &&
        !positionValue([NSAppleEventDescriptor descriptorWithDouble:NAN]);
    DescType codes[]={'pPlS','pPos'};
    for (unsigned i=0;i<2;++i) {
        NSAppleEventDescriptor *event=readRequest(999999,codes[i]);
        valid=valid && event.eventClass==kAECoreSuite && event.eventID==kAEGetData &&
            [event attributeDescriptorForKeyword:keyAddressAttr].descriptorType==typeKernelProcessID &&
            [[event paramDescriptorForKeyword:keyDirectObject] descriptorForKeyword:keyAEKeyData].typeCodeValue==codes[i];
    }
    return emit(@{@"schema":@"music-position-self-test/1.0",@"passed":@(valid)},valid ? 0 : 1);
}
int main(int argc,const char *argv[]) {
    @autoreleasepool {
        mach_timebase_info_data_t timebase;
        if (mach_timebase_info(&timebase)!=KERN_SUCCESS || !timebase.denom) return 1;
        tickMs=(double)timebase.numer/timebase.denom/1e6;
        double start=nowMs();
        if (argc==2 && strcmp(argv[1],"--self-test")==0) return selfTest();
        if (argc==2 && strcmp(argv[1],"--clock")==0) return emit(@{@"schema":@"music-position-clock/1.0",@"monotonicMs":@(nowMs())},0);
        if (argc!=2 || strcmp(argv[1],"--read-existing-music")!=0) return unavailable(failure(@"invalid-request"),start);
        NSArray<NSRunningApplication *> *running=[NSRunningApplication runningApplicationsWithBundleIdentifier:@"com.apple.Music"];
        if (running.count!=1) return unavailable(failure(@"unavailable"),start);
        pid_t pid=running.firstObject.processIdentifier;
        NSDate *launch=[running.firstObject.launchDate copy];
        if (!stillSelected(pid,launch)) return unavailable(failure(@"unavailable"),start);
        NSAppleEventDescriptor *target=[NSAppleEventDescriptor descriptorWithProcessIdentifier:pid];
        OSStatus permission=AEDeterminePermissionToAutomateTarget(target.aeDesc,kAECoreSuite,kAEGetData,false);
        if (permission!=noErr) return unavailable(statusFailure(permission),start);
        if (!stillSelected(pid,launch)) return unavailable(failure(@"unavailable"),start);
        NSDictionary *state=readProperty(pid,'pPlS');
        if (!stillSelected(pid,launch)) return unavailable(failure(@"unavailable"),start);
        if (state[@"error"]) return unavailable(state[@"error"],start);
        if (!stillSelected(pid,launch)) return unavailable(failure(@"unavailable"),start);
        NSDictionary *position=readProperty(pid,'pPos');
        if (!stillSelected(pid,launch)) return unavailable(failure(@"unavailable"),start);
        NSDictionary *observation=position[@"error"] ?
            @{ @"status":@"unavailable",@"error":position[@"error"],@"interval":position[@"interval"] } :
            @{ @"status":@"observed",@"seconds":position[@"value"],@"interval":position[@"interval"] };
        return emit(@{@"schema":@"music-position-read/1.0",@"status":@"sample",@"sourceInstance":instance(pid,launch),
            @"interval":interval(start,nowMs()),@"state":state,@"position":observation},0);
    }
}
