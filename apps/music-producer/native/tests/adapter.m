/* Every CoreAudio call in main.m is replaced below. This binary cannot capture audio. */
#import <Foundation/Foundation.h>
#import <AVFoundation/AVFoundation.h>
#import <CoreAudio/CoreAudio.h>
#import <CoreAudio/AudioHardwareTapping.h>
#import <CoreAudio/CATapDescription.h>
#include <assert.h>
#include <stdlib.h>
#include <string.h>

static unsigned hardwareCalls, tapCreated, tapDestroyed, aggregateCreated, aggregateDestroyed;
static unsigned procCreated, procDestroyed, started, stopped, listenerAdded, listenerRemoved;
static unsigned routeListenerAdded, routeListenerRemoved;
static unsigned microphoneListeners, microphoneListenersRemoved, authorizationCalls, permissionRequests;
static bool inputEnabled, outputDisabled, permissionGranted;
static bool routeSwitched;
static AudioObjectPropertyListenerProc routeListener;
static void *routeListenerContext;
static AudioDeviceIOProc ioCallback;
static void *ioContext;
static AudioObjectPropertyListenerProc listener;
static void *listenerContext;
static bool fails(const char *stage) { const char *value=getenv("BUNNY_NATIVE_TEST_FAILURE"); return value && strcmp(value,stage)==0; }
static OSStatus result(const char *stage) { return fails(stage) ? kAudioHardwareUnspecifiedError : noErr; }
@interface FakeCaptureDevice : NSObject
+ (AVAuthorizationStatus)authorizationStatusForMediaType:(AVMediaType)mediaType;
+ (void)requestAccessForMediaType:(AVMediaType)mediaType completionHandler:(void (^)(BOOL))handler;
@end
@implementation FakeCaptureDevice
+ (AVAuthorizationStatus)authorizationStatusForMediaType:(AVMediaType)mediaType {
    assert([mediaType isEqual:AVMediaTypeAudio]);++authorizationCalls;
    if (fails("mic-permission-denied") || (permissionRequests && fails("mic-permission-declined")) || (started && fails("mic-permission-revoked"))) return AVAuthorizationStatusDenied;
    if ((fails("mic-permission-needed") || fails("mic-permission-no-answer") || fails("mic-permission-declined")) && !permissionGranted) return AVAuthorizationStatusNotDetermined;
    return AVAuthorizationStatusAuthorized;
}
+ (void)requestAccessForMediaType:(AVMediaType)mediaType completionHandler:(void (^)(BOOL))handler {
    assert([mediaType isEqual:AVMediaTypeAudio]);++permissionRequests;
    if (fails("mic-permission-no-answer")) return;
    permissionGranted=!fails("mic-permission-declined");handler(permissionGranted);
}
@end
static OSStatus fakeGetSize(AudioObjectID object,const AudioObjectPropertyAddress *address,UInt32 qualifier,const void *qualifierData,UInt32 *size) {
    (void)object;(void)qualifier;(void)qualifierData;++hardwareCalls;
    if (address->mSelector==kAudioHardwarePropertyDevices) {
        *size=(fails("mic-inventory-oversized") ? 65U : 2U)*sizeof(AudioObjectID);return noErr;
    }
    if (address->mSelector==kAudioDevicePropertyStreams) {
        assert(object==300 || object==301);
        *size=object==301 && address->mScope==kAudioObjectPropertyScopeInput ? 0 :
            (fails("mic-many-inputs") && address->mScope==kAudioObjectPropertyScopeInput ? 2U : 1U)*sizeof(AudioStreamID);
        return noErr;
    }
    if (address->mSelector==kAudioProcessPropertyDevices) {
        assert(object==22 && address->mScope==kAudioObjectPropertyScopeOutput);
        *size=fails("route-empty") ? 0 : fails("route-oversized") ? 33*sizeof(AudioObjectID) : sizeof(AudioObjectID);
        return result("route-unavailable");
    }
    assert(address->mSelector==kAudioHardwarePropertyProcessObjectList);
    *size=2*sizeof(AudioObjectID); return noErr;
}
static OSStatus fakeGetData(AudioObjectID object,const AudioObjectPropertyAddress *address,UInt32 qualifier,const void *qualifierData,UInt32 *size,void *out) {
    (void)qualifier;(void)qualifierData;++hardwareCalls;
    switch (address->mSelector) {
        case kAudioHardwarePropertyDevices: {
            assert(object==kAudioObjectSystemObject);AudioObjectID devices[]={300,301};
            memcpy(out,devices,sizeof(devices));*size=sizeof(devices);return noErr;
        }
        case kAudioHardwarePropertyTranslateUIDToDevice: {
            assert(object==kAudioObjectSystemObject && qualifier==sizeof(CFStringRef));
            assert(CFEqual(*(CFStringRef *)qualifierData,CFSTR("synthetic-private-uid")));
            *(AudioObjectID *)out=fails("mic-missing") ? kAudioObjectUnknown : 300;*size=sizeof(AudioObjectID);return noErr;
        }
        case kAudioDevicePropertyStreams: {
            assert(object==300 && address->mScope==kAudioObjectPropertyScopeInput);
            *(AudioStreamID *)out=400;*size=sizeof(AudioStreamID);return noErr;
        }
        case kAudioDevicePropertyDeviceIsAlive: {
            assert(object==300);*(UInt32 *)out=!(started && fails("mic-removed"));*size=sizeof(UInt32);return noErr;
        }
        case kAudioDevicePropertyDeviceUID:
        case kAudioObjectPropertyName: {
            assert(object==300);
            CFStringRef value=address->mSelector==kAudioDevicePropertyDeviceUID ? CFSTR("synthetic-private-uid") : CFSTR("Synthetic microphone");
            if (address->mSelector==kAudioDevicePropertyDeviceUID && started && fails("mic-uid-changed")) value=CFSTR("synthetic-other-uid");
            *(CFStringRef *)out=CFRetain(value);*size=sizeof(value);return noErr;
        }
        case kAudioDevicePropertyStreamConfiguration: {
            assert(object==300 && address->mScope==kAudioObjectPropertyScopeInput);
            AudioBufferList configuration={.mNumberBuffers=1,.mBuffers={{2,0,NULL}}};
            memcpy(out,&configuration,sizeof(configuration));*size=sizeof(configuration);return noErr;
        }
        case kAudioDevicePropertyIOProcStreamUsage: {
            assert(object==300);
            AudioHardwareIOProcStreamUsage *usage=out;
            assert(usage->mIOProc==(void *)(uintptr_t)1 && usage->mNumberStreams==1);
            usage->mStreamIsOn[0]=address->mScope==kAudioObjectPropertyScopeInput ? inputEnabled : (!outputDisabled || fails("mic-output-enabled"));
            return noErr;
        }
        case kAudioProcessPropertyDevices: {
            assert(object==22 && address->mScope==kAudioObjectPropertyScopeOutput);
            *(AudioObjectID *)out=routeSwitched ? 701 : 700;
            if (fails("route-changed-during-setup")) routeListener(object,1,address,routeListenerContext);
            *size=sizeof(AudioObjectID); return noErr;
        }
        case kAudioHardwarePropertyProcessObjectList: {
            AudioObjectID ids[]={22,77}; memcpy(out,ids,sizeof(ids)); *size=sizeof(ids); return noErr;
        }
        case kAudioProcessPropertyBundleID: {
            if (object==22 && started && fails("source-lost")) return kAudioHardwareBadObjectError;
            CFStringRef bundle=object==22 ? CFSTR("com.apple.Music") : CFSTR("com.example.Unrelated");
            *(CFStringRef *)out=CFRetain(bundle); *size=sizeof(bundle); return noErr;
        }
        case kAudioTapPropertyFormat:
        case kAudioStreamPropertyVirtualFormat: {
            assert(object==100 || object==400);
            AudioStreamBasicDescription format={.mSampleRate=48000,.mFormatID=kAudioFormatLinearPCM,
                .mFormatFlags=kAudioFormatFlagIsFloat|kAudioFormatFlagIsPacked,.mBytesPerPacket=8,
                .mFramesPerPacket=1,.mBytesPerFrame=8,.mChannelsPerFrame=2,.mBitsPerChannel=32};
            if (fails("unsupported-format") || fails("mic-format")) format.mFormatFlags=kAudioFormatFlagIsSignedInteger;
            memcpy(out,&format,sizeof(format)); *size=sizeof(format); return result("read-format");
        }
        default: abort();
    }
}
static OSStatus fakeSetData(AudioObjectID object,const AudioObjectPropertyAddress *address,UInt32 qualifier,const void *qualifierData,UInt32 size,const void *data) {
    (void)qualifierData;++hardwareCalls;
    assert(object==300 && address->mSelector==kAudioDevicePropertyIOProcStreamUsage && qualifier==0);
    const AudioHardwareIOProcStreamUsage *usage=data;
    assert(size==offsetof(AudioHardwareIOProcStreamUsage,mStreamIsOn)+sizeof(UInt32));
    assert(usage->mIOProc==(void *)(uintptr_t)1 && usage->mNumberStreams==1);
    if (address->mScope==kAudioObjectPropertyScopeInput) {assert(usage->mStreamIsOn[0]==1);inputEnabled=true;}
    else {assert(address->mScope==kAudioObjectPropertyScopeOutput && usage->mStreamIsOn[0]==0);outputDisabled=true;}
    return result("mic-output-refused");
}
static OSStatus fakeCreateTap(CATapDescription *description,AudioObjectID *out) {
    ++hardwareCalls;
    assert([description.processes isEqualToArray:@[@22]]);
    assert(description.isPrivate && !description.isExclusive && description.muteBehavior==CATapUnmuted);
    if (@available(macOS 26.0,*)) assert(!description.isProcessRestoreEnabled);
    if (fails("create-tap")) return kAudioHardwareUnspecifiedError;
    ++tapCreated; *out=100; return noErr;
}
static OSStatus fakeDestroyTap(AudioObjectID object) { ++hardwareCalls; assert(object==100); ++tapDestroyed; return result("destroy-tap"); }
static OSStatus fakeCreateAggregate(CFDictionaryRef description,AudioObjectID *out) {
    ++hardwareCalls;
    NSDictionary *config=(__bridge NSDictionary *)description;
    assert([config[@kAudioAggregateDeviceIsPrivateKey] boolValue]);
    assert(![config[@kAudioAggregateDeviceTapAutoStartKey] boolValue]);
    assert(config[@kAudioAggregateDeviceSubDeviceListKey]==nil);
    assert([config[@kAudioAggregateDeviceTapListKey] count]==1);
    if (fails("create-aggregate")) return kAudioHardwareUnspecifiedError;
    ++aggregateCreated; *out=200; return noErr;
}
static OSStatus fakeDestroyAggregate(AudioObjectID object) { ++hardwareCalls; assert(object==200); ++aggregateDestroyed; return result("destroy-aggregate"); }
static OSStatus fakeCreateProc(AudioObjectID object,AudioDeviceIOProc callback,void *context,AudioDeviceIOProcID *out) {
    ++hardwareCalls; assert(object==200 || object==300);
    if (fails("create-proc")) return kAudioHardwareUnspecifiedError;
    if (object==300 && fails("mic-change-before-start")) {
        AudioObjectPropertyAddress address={kAudioStreamPropertyVirtualFormat,kAudioObjectPropertyScopeGlobal,kAudioObjectPropertyElementMain};
        listener(400,1,&address,listenerContext);
    }
    if (fails("route-changed-before-start")) {
        AudioObjectPropertyAddress address={kAudioProcessPropertyDevices,kAudioObjectPropertyScopeOutput,kAudioObjectPropertyElementMain};
        routeListener(22,1,&address,routeListenerContext);
    }
    ioCallback=callback; ioContext=context; *out=(AudioDeviceIOProcID)(uintptr_t)1; ++procCreated; return noErr;
}
static OSStatus fakeDestroyProc(AudioObjectID object,AudioDeviceIOProcID proc) { ++hardwareCalls; assert((object==200 || object==300) && proc); ++procDestroyed; return result("destroy-proc"); }
static OSStatus fakeStart(AudioObjectID object,AudioDeviceIOProcID proc);
static OSStatus fakeStop(AudioObjectID object,AudioDeviceIOProcID proc) { ++hardwareCalls; assert((object==200 || object==300) && proc); ++stopped; return result("stop"); }
static OSStatus fakeAddListener(AudioObjectID object,const AudioObjectPropertyAddress *address,AudioObjectPropertyListenerProc callback,void *context) {
    ++hardwareCalls;
    if (object==300 || object==400) {
        if (fails("mic-listener")) return kAudioHardwareUnspecifiedError;
        ++microphoneListeners;listener=callback;listenerContext=context;return noErr;
    }
    if (address->mSelector==kAudioProcessPropertyDevices) {
        assert(object==22 && address->mScope==kAudioObjectPropertyScopeOutput);
        if (fails("add-route-listener")) return kAudioHardwareUnspecifiedError;
        routeListener=callback; routeListenerContext=context; ++routeListenerAdded; return noErr;
    }
    assert(object==100 && address->mSelector==kAudioTapPropertyFormat);
    if (fails("add-listener")) return kAudioHardwareUnspecifiedError;
    listener=callback; listenerContext=context; ++listenerAdded; return noErr;
}
static OSStatus fakeRemoveListener(AudioObjectID object,const AudioObjectPropertyAddress *address,AudioObjectPropertyListenerProc callback,void *context) {
    ++hardwareCalls;
    if (object==300 || object==400) {assert(callback==listener && context==listenerContext);++microphoneListenersRemoved;return result("mic-remove-listener");}
    if (address->mSelector==kAudioProcessPropertyDevices) {
        assert(object==22 && callback==routeListener && context==routeListenerContext);
        ++routeListenerRemoved; return result("remove-route-listener");
    }
    assert(object==100 && callback==listener && context==listenerContext);
    ++listenerRemoved; return result("remove-listener");
}

#define AudioObjectGetPropertyDataSize fakeGetSize
#define AudioObjectGetPropertyData fakeGetData
#define AudioObjectSetPropertyData fakeSetData
#define AudioHardwareCreateProcessTap fakeCreateTap
#define AudioHardwareDestroyProcessTap fakeDestroyTap
#define AudioHardwareCreateAggregateDevice fakeCreateAggregate
#define AudioHardwareDestroyAggregateDevice fakeDestroyAggregate
#define AudioDeviceCreateIOProcID fakeCreateProc
#define AudioDeviceDestroyIOProcID fakeDestroyProc
#define AudioDeviceStart fakeStart
#define AudioDeviceStop fakeStop
#define AudioObjectAddPropertyListener fakeAddListener
#define AudioObjectRemovePropertyListener fakeRemoveListener
#define AVCaptureDevice FakeCaptureDevice
#define main nativeMain
#include "../main.m"
#undef main

static OSStatus fakeStart(AudioObjectID object,AudioDeviceIOProcID proc) {
    ++hardwareCalls; assert((object==200 || object==300) && proc);
    if (object==300) assert(inputEnabled && outputDisabled && permissionRequests==0);
    if (fails("start")) return kAudioHardwareUnspecifiedError;
    ++started;
    if (fails("format-changed")) {
        AudioObjectPropertyAddress address={kAudioTapPropertyFormat,kAudioObjectPropertyScopeGlobal,kAudioObjectPropertyElementMain};
        listener(100,1,&address,listenerContext); return noErr;
    }
    Capture *state=ioContext;
    float samples[9600]; for (unsigned i=0;i<9600;++i) samples[i]=0.25f;
    if (fails("sample-invalid")) samples[9599]=NAN;
    AudioBufferList input={.mNumberBuffers=1,.mBuffers={{2,sizeof(samples),samples}}};
    if (fails("pause")) input.mBuffers[0]=(AudioBuffer){2,0,NULL};
    if (fails("buffer-invalid")) input.mBuffers[0].mNumberChannels=1;
    AudioTimeStamp timestamp={.mSampleTime=0,
        .mHostTime=mach_absolute_time()-(uint64_t)(200/state->hostTickMs),
        .mFlags=kAudioTimeStampHostTimeValid|kAudioTimeStampSampleTimeValid};
    if (fails("timestamp-invalid")) timestamp.mFlags=0;
    AudioBufferList output={.mNumberBuffers=0};
    ioCallback(200,&timestamp,&input,&timestamp,&output,&timestamp,ioContext);
    if (fails("route-changed") || fails("route-changed-poll")) {
        routeSwitched=true;
        AudioObjectPropertyAddress address={kAudioProcessPropertyDevices,kAudioObjectPropertyScopeOutput,kAudioObjectPropertyElementMain};
        if (routeListener && !fails("route-changed-poll")) routeListener(22,1,&address,routeListenerContext);
    }
    return noErr;
}

int main(int argc,const char *argv[]) {
    int resultCode=nativeMain(argc,argv);
    bool microphone=argc==2 && strcmp(argv[1],"--capture-microphone")==0;
    bool inventory=argc==2 && strcmp(argv[1],"--list-microphones")==0;
    bool permission=argc==2 && strcmp(argv[1],"--authorize-microphone")==0;
    if ((!microphone && !inventory && (argc!=2 || strcmp(argv[1],"--capture")!=0)) || getenv("BUNNY_NATIVE_TEST_NO_ACCESS")) assert(hardwareCalls==0);
    if (!microphone && !permission) assert(authorizationCalls==0);
    if (!permission) assert(permissionRequests==0);
    if (getenv("BUNNY_NATIVE_TEST_NO_ACCESS")) assert(authorizationCalls==0 && permissionRequests==0);
    if (inventory || permission) assert(started==0 && procCreated==0);
    assert(microphoneListenersRemoved==microphoneListeners);
    assert(tapDestroyed==tapCreated && aggregateDestroyed==aggregateCreated);
    assert(procDestroyed==procCreated && stopped==started && listenerRemoved==listenerAdded);
    assert(routeListenerRemoved==routeListenerAdded);
    if (fails("route-changed-during-setup")) assert(tapCreated==0);
    if (fails("route-changed-before-start")) assert(started==0);
    if (fails("mic-change-before-start") || fails("mic-output-enabled") || fails("mic-output-refused")) assert(started==0);
    return resultCode;
}
