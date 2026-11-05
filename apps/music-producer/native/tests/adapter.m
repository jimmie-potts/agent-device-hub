/* Every CoreAudio call in main.m is replaced below. This binary cannot capture audio. */
#import <Foundation/Foundation.h>
#import <CoreAudio/CoreAudio.h>
#import <CoreAudio/AudioHardwareTapping.h>
#import <CoreAudio/CATapDescription.h>
#include <assert.h>
#include <stdlib.h>
#include <string.h>

static unsigned hardwareCalls, tapCreated, tapDestroyed, aggregateCreated, aggregateDestroyed;
static unsigned procCreated, procDestroyed, started, stopped, listenerAdded, listenerRemoved;
static unsigned routeListenerAdded, routeListenerRemoved;
static bool routeSwitched;
static AudioObjectPropertyListenerProc routeListener;
static void *routeListenerContext;
static AudioDeviceIOProc ioCallback;
static void *ioContext;
static AudioObjectPropertyListenerProc listener;
static void *listenerContext;
static bool fails(const char *stage) { const char *value=getenv("BUNNY_NATIVE_TEST_FAILURE"); return value && strcmp(value,stage)==0; }
static OSStatus result(const char *stage) { return fails(stage) ? kAudioHardwareUnspecifiedError : noErr; }
static OSStatus fakeGetSize(AudioObjectID object,const AudioObjectPropertyAddress *address,UInt32 qualifier,const void *qualifierData,UInt32 *size) {
    (void)object;(void)qualifier;(void)qualifierData;++hardwareCalls;
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
        case kAudioTapPropertyFormat: {
            AudioStreamBasicDescription format={.mSampleRate=48000,.mFormatID=kAudioFormatLinearPCM,
                .mFormatFlags=kAudioFormatFlagIsFloat|kAudioFormatFlagIsPacked,.mBytesPerPacket=8,
                .mFramesPerPacket=1,.mBytesPerFrame=8,.mChannelsPerFrame=2,.mBitsPerChannel=32};
            if (fails("unsupported-format")) format.mFormatFlags=kAudioFormatFlagIsSignedInteger;
            memcpy(out,&format,sizeof(format)); *size=sizeof(format); return result("read-format");
        }
        default: abort();
    }
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
    ++hardwareCalls; assert(object==200);
    if (fails("create-proc")) return kAudioHardwareUnspecifiedError;
    if (fails("route-changed-before-start")) {
        AudioObjectPropertyAddress address={kAudioProcessPropertyDevices,kAudioObjectPropertyScopeOutput,kAudioObjectPropertyElementMain};
        routeListener(22,1,&address,routeListenerContext);
    }
    ioCallback=callback; ioContext=context; *out=(AudioDeviceIOProcID)(uintptr_t)1; ++procCreated; return noErr;
}
static OSStatus fakeDestroyProc(AudioObjectID object,AudioDeviceIOProcID proc) { ++hardwareCalls; assert(object==200 && proc); ++procDestroyed; return result("destroy-proc"); }
static OSStatus fakeStart(AudioObjectID object,AudioDeviceIOProcID proc);
static OSStatus fakeStop(AudioObjectID object,AudioDeviceIOProcID proc) { ++hardwareCalls; assert(object==200 && proc); ++stopped; return result("stop"); }
static OSStatus fakeAddListener(AudioObjectID object,const AudioObjectPropertyAddress *address,AudioObjectPropertyListenerProc callback,void *context) {
    ++hardwareCalls;
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
    if (address->mSelector==kAudioProcessPropertyDevices) {
        assert(object==22 && callback==routeListener && context==routeListenerContext);
        ++routeListenerRemoved; return result("remove-route-listener");
    }
    assert(object==100 && callback==listener && context==listenerContext);
    ++listenerRemoved; return result("remove-listener");
}

#define AudioObjectGetPropertyDataSize fakeGetSize
#define AudioObjectGetPropertyData fakeGetData
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
#define main nativeMain
#include "../main.m"
#undef main

static OSStatus fakeStart(AudioObjectID object,AudioDeviceIOProcID proc) {
    ++hardwareCalls; assert(object==200 && proc);
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
    if (argc!=2 || strcmp(argv[1],"--capture")!=0 || getenv("BUNNY_NATIVE_TEST_NO_ACCESS")) assert(hardwareCalls==0);
    assert(tapDestroyed==tapCreated && aggregateDestroyed==aggregateCreated);
    assert(procDestroyed==procCreated && stopped==started && listenerRemoved==listenerAdded);
    assert(routeListenerRemoved==routeListenerAdded);
    if (fails("route-changed-during-setup")) assert(tapCreated==0);
    if (fails("route-changed-before-start")) assert(started==0);
    return resultCode;
}
