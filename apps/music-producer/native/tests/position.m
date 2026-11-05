#import <AppKit/AppKit.h>
#import <CoreServices/CoreServices.h>
#include <assert.h>
#include <math.h>

static NSString *scenario;
static unsigned sends, checks, permissions;
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
- (NSString *)bundleIdentifier { return @"com.apple.Music"; }
- (BOOL)terminated { return NO; }
- (NSDate *)launchDate {
    if ([scenario isEqual:@"missing-launch"]) return nil;
    return [NSDate dateWithTimeIntervalSince1970:[scenario isEqual:@"new-instance"] || ([scenario isEqual:@"restart-state"] && sends>=1) ||
        ([scenario isEqual:@"restart-position"] && sends>=2) ? 200 : 100];
}
+ (NSArray *)runningApplicationsWithBundleIdentifier:(NSString *)bundle {
    assert([bundle isEqual:@"com.apple.Music"]);
    if ([scenario isEqual:@"missing"]) return @[];
    if ([scenario isEqual:@"multiple"]) return @[[self new],[self new]];
    return @[[self new]];
}
+ (instancetype)runningApplicationWithProcessIdentifier:(pid_t)pid { assert(pid==424242); ++checks; return [self new]; }
@end

static __attribute__((unused)) OSStatus fakePermission(const AEAddressDesc *target, AEEventClass cls, AEEventID event, Boolean ask) {
    assert(target->descriptorType==typeKernelProcessID && cls==kAECoreSuite && event==kAEGetData && !ask);
    ++permissions;
    if ([scenario isEqual:@"denied"]) return errAEEventNotPermitted;
    if ([scenario isEqual:@"consent"]) return errAEEventWouldRequireUserConsent;
    if ([scenario isEqual:@"permission-process-missing"]) return procNotFound;
    return noErr;
}
static __attribute__((unused)) OSStatus fakeSend(const AppleEvent *raw, AppleEvent *reply, AESendMode flags, long timeout) {
    AppleEvent copy={typeNull,NULL}; assert(AEDuplicateDesc(raw,&copy)==noErr);
    NSAppleEventDescriptor *event=[[NSAppleEventDescriptor alloc] initWithAEDescNoCopy:&copy];
    assert(event.eventClass==kAECoreSuite && event.eventID==kAEGetData);
    assert(flags==(kAEWaitReply|kAENeverInteract|kAEDoNotPromptForUserConsent|kAEDontRecord|kAEDontReconnect));
    assert(timeout>0 && timeout<=120 && permissions==1);
    NSAppleEventDescriptor *target=[event attributeDescriptorForKeyword:keyAddressAttr];
    pid_t targetPID=0; assert(target.data.length==sizeof(targetPID)); memcpy(&targetPID,target.data.bytes,sizeof(targetPID));
    assert(target.descriptorType==typeKernelProcessID && targetPID==424242);
    NSAppleEventDescriptor *property=[event paramDescriptorForKeyword:keyDirectObject];
    assert(property.descriptorType==typeObjectSpecifier && property.numberOfItems==4);
    assert([property descriptorForKeyword:keyAEDesiredClass].typeCodeValue==cProperty);
    assert([property descriptorForKeyword:keyAEContainer].descriptorType==typeNull);
    assert([property descriptorForKeyword:keyAEKeyForm].enumCodeValue==formPropertyID);
    DescType code=[property descriptorForKeyword:keyAEKeyData].typeCodeValue;
    assert((sends==0 && code=='pPlS') || (sends==1 && code=='pPos'));
    assert(checks>=2+sends*2);
    ++sends;
    if ([scenario isEqual:@"state-timeout"] || ([scenario isEqual:@"position-timeout"] && code=='pPos')) return errAETimeout;
    NSAppleEventDescriptor *response=[NSAppleEventDescriptor appleEventWithEventClass:kCoreEventClass eventID:kAEAnswer
        targetDescriptor:NSAppleEventDescriptor.nullDescriptor returnID:kAutoGenerateReturnID transactionID:kAnyTransactionID];
    NSAppleEventDescriptor *value;
    if (code=='pPlS') {
        NSDictionary *states=@{@"stopped":@((DescType)'kPSS'),@"paused":@((DescType)'kPSp'),@"fast-forwarding":@((DescType)'kPSF'),@"rewinding":@((DescType)'kPSR'),@"unknown-state":@((DescType)'xxxx')};
        value=[NSAppleEventDescriptor descriptorWithEnumCode:states[scenario] ? [states[scenario] unsignedIntValue] : 'kPSP'];
        if ([scenario isEqual:@"state-short"] || [scenario isEqual:@"state-long"]) {
            NSMutableData *bytes=[value.data mutableCopy]; [bytes setLength:[scenario isEqual:@"state-short"] ? 1 : 8];
            value=[NSAppleEventDescriptor descriptorWithDescriptorType:typeEnumerated bytes:bytes.bytes length:bytes.length];
        }
    } else {
        value=[NSAppleEventDescriptor descriptorWithDouble:12.5];
        if ([scenario isEqual:@"integer"]) value=[NSAppleEventDescriptor descriptorWithInt32:12];
        if ([scenario isEqual:@"int16"]) { int16_t number=12; value=[NSAppleEventDescriptor descriptorWithDescriptorType:typeSInt16 bytes:&number length:sizeof(number)]; }
        if ([scenario isEqual:@"int64"]) { int64_t number=12; value=[NSAppleEventDescriptor descriptorWithDescriptorType:typeSInt64 bytes:&number length:sizeof(number)]; }
        if ([scenario isEqual:@"uint32"]) { uint32_t number=12; value=[NSAppleEventDescriptor descriptorWithDescriptorType:typeUInt32 bytes:&number length:sizeof(number)]; }
        if ([scenario isEqual:@"float32"]) { float number=12.5; value=[NSAppleEventDescriptor descriptorWithDescriptorType:typeIEEE32BitFloatingPoint bytes:&number length:sizeof(number)]; }
        if ([scenario isEqual:@"zero"]) value=[NSAppleEventDescriptor descriptorWithDouble:0];
        if ([scenario isEqual:@"string"]) value=[NSAppleEventDescriptor descriptorWithString:@"12.5"];
        if ([scenario isEqual:@"boolean"]) value=[NSAppleEventDescriptor descriptorWithBoolean:YES];
        if ([scenario isEqual:@"negative"]) value=[NSAppleEventDescriptor descriptorWithDouble:-1];
        if ([scenario isEqual:@"nan"]) value=[NSAppleEventDescriptor descriptorWithDouble:NAN];
        if ([scenario isEqual:@"infinite"]) value=[NSAppleEventDescriptor descriptorWithDouble:INFINITY];
        if ([scenario isEqual:@"oversized"]) value=[NSAppleEventDescriptor descriptorWithDouble:1e15];
        if ([scenario isEqual:@"malformed-error"]) [response setParamDescriptor:[NSAppleEventDescriptor descriptorWithString:@"0"] forKeyword:keyErrorNumber];
        if ([scenario isEqual:@"position-short"] || [scenario isEqual:@"position-long"]) {
            unsigned char bytes[16]={0};
            value=[NSAppleEventDescriptor descriptorWithDescriptorType:typeIEEE64BitFloatingPoint bytes:bytes
                length:[scenario isEqual:@"position-short"] ? 1 : 16];
        }
        if ([scenario isEqual:@"error-short"]) {
            unsigned char zero=0;
            [response setParamDescriptor:[NSAppleEventDescriptor descriptorWithDescriptorType:typeSInt32 bytes:&zero length:1] forKeyword:keyErrorNumber];
        }
    }
    [response setParamDescriptor:value forKeyword:keyDirectObject];
    return AEDuplicateDesc(response.aeDesc,reply);
}
#define NSRunningApplication FakeMusicApplication
#define AEDeterminePermissionToAutomateTarget fakePermission
#define AESendMessage fakeSend
#define main position_main
#include "../position.m"
#undef main
int main(int argc,const char *argv[]) {
    @autoreleasepool {
        assert(argc==2); scenario=[NSString stringWithUTF8String:argv[1]];
        const char *mode=[scenario isEqual:@"clock"] ? "--clock" : [scenario isEqual:@"self-test"] ? "--self-test" :
            [scenario isEqual:@"capture-refused"] ? "--capture" : "--read-existing-music";
        const char *args[]={"fake-position",mode};
        int result=position_main([scenario isEqual:@"no-argument"] ? 1 : 2,args);
        if ([scenario isEqual:@"clock"] || [scenario isEqual:@"self-test"] || [scenario isEqual:@"capture-refused"] || [scenario isEqual:@"no-argument"])
            assert(sends==0 && permissions==0 && checks==0);
        if ([scenario isEqual:@"denied"] || [scenario isEqual:@"consent"] || [scenario isEqual:@"permission-process-missing"]) assert(sends==0);
        if ([scenario isEqual:@"state-timeout"] || [scenario isEqual:@"unknown-state"] || [scenario isEqual:@"restart-state"]) assert(sends==1);
        return result;
    }
}
