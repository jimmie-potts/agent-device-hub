#import <Foundation/Foundation.h>
#import <CoreAudio/CoreAudio.h>
#import <CoreAudio/AudioHardwareTapping.h>
#import <CoreAudio/CATapDescription.h>
#include "music_signal.h"
#include <errno.h>
#include <fcntl.h>
#include <mach/mach_time.h>
#include <math.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

typedef enum { FAULT_NONE, FAULT_FORMAT, FAULT_SAMPLE, FAULT_TIMESTAMP, FAULT_SOURCE,
    FAULT_CAPTURE, FAULT_CLEANUP, FAULT_OUTPUT, FAULT_INPUT, FAULT_USAGE, FAULT_CAPACITY, FAULT_ROUTE } Fault;

enum { MAX_MUSIC_PROCESSES = 32, MAX_PROCESS_OUTPUTS = 32 };
typedef struct {
    AudioObjectID process, devices[MAX_PROCESS_OUTPUTS];
    unsigned count;
} OutputRoute;

typedef struct {
    AudioStreamBasicDescription format;
    MusicAnalyzer analyzer;
    MusicLatest latest;
    atomic_int fault;
    double hostTickMs;
    double clockOffsetMs;
    bool hasClockOffset;
} Capture;

/* Static lifetime survives a failed IOProc destruction until process exit. */
static Capture captureState;
static volatile sig_atomic_t stopRequested;
static const double maximumCaptureMs=24*60*60*1000.0;

static void handleSignal(int number) { (void)number; stopRequested=1; }
static double hostNowMs(const Capture *state) { return mach_continuous_time()*state->hostTickMs; }
static void recordFault(Capture *state,Fault fault) {
    int expected=FAULT_NONE;
    atomic_compare_exchange_strong_explicit(&state->fault,&expected,fault,memory_order_release,memory_order_relaxed);
}

static const char *faultCode(Fault fault) {
    switch (fault) {
        case FAULT_FORMAT: return "unsupported-capability";
        case FAULT_SAMPLE: case FAULT_TIMESTAMP: return "invalid-message";
        case FAULT_INPUT: case FAULT_USAGE: return "invalid-request";
        case FAULT_CAPACITY: return "capacity";
        default: return "unavailable";
    }
}
static const char *faultDetail(Fault fault) {
    switch (fault) {
        case FAULT_FORMAT: return "Music capture format is unsupported or changed.";
        case FAULT_SAMPLE: return "Music capture contains invalid sample values.";
        case FAULT_TIMESTAMP: return "Music capture timestamps are invalid.";
        case FAULT_SOURCE: return "The selected Music audio process is unavailable.";
        case FAULT_ROUTE: return "The selected Music output route changed or is unavailable.";
        case FAULT_CAPTURE: return "Music capture could not be opened or continued.";
        case FAULT_CLEANUP: return "Music capture cleanup did not complete.";
        case FAULT_OUTPUT: return "The Music feature consumer is unavailable.";
        case FAULT_INPUT: return "The Music capture control input is invalid.";
        case FAULT_CAPACITY: return "Music capture requires lock-free transfer.";
        default: return "Use --clock, --self-test or explicitly select --capture.";
    }
}
static size_t terminalRecord(char *out,size_t size,Fault fault) {
    const char *code=faultCode(fault);
    bool retryable=strcmp(code,"unavailable")==0 || strcmp(code,"capacity")==0;
    int count=snprintf(out,size,"{\"schema\":\"music-native-terminal/1.0\",\"error\":{\"code\":\"%s\",\"retryable\":%s,\"detail\":\"%s\"}}\n",
        code,retryable ? "true" : "false",faultDetail(fault));
    return count>0 && (size_t)count<size ? (size_t)count : 0;
}
static size_t frameRecord(char *out,size_t size,const MusicFrame *f,double emitted) {
    int count=snprintf(out,size,
        "{\"schema\":\"music-native-frame/1.0\",\"sequence\":%llu,\"sampleRateHz\":%u,\"channels\":%u,\"frameCount\":%u,"
        "\"startMonotonicMs\":%.9f,\"endMonotonicMs\":%.9f,\"emittedMonotonicMs\":%.9f,"
        "\"rms\":%.12g,\"peak\":%.12g,\"clippedFraction\":%.12g,"
        "\"bands\":{\"bass\":%.12g,\"mid\":%.12g,\"treble\":%.12g},"
        "\"onset\":{\"strength\":%.12g,\"confidence\":%.12g},\"discontinuity\":%s}\n",
        (unsigned long long)f->sequence,f->sampleRateHz,f->channels,f->frameCount,
        f->startMonotonicMs,f->endMonotonicMs,emitted,f->rms,f->peak,f->clippedFraction,
        f->bass,f->mid,f->treble,f->onsetStrength,f->onsetConfidence,f->discontinuity ? "true" : "false");
    return count>0 && (size_t)count<size ? (size_t)count : 0;
}

static OSStatus readProperty(AudioObjectID object,AudioObjectPropertySelector selector,UInt32 *size,void *value) {
    AudioObjectPropertyAddress address={selector,kAudioObjectPropertyScopeGlobal,kAudioObjectPropertyElementMain};
    return AudioObjectGetPropertyData(object,&address,0,NULL,size,value);
}

static const AudioObjectPropertyAddress routeAddress={kAudioProcessPropertyDevices,kAudioObjectPropertyScopeOutput,kAudioObjectPropertyElementMain};

/* Main-thread observation of only the selected Music process's output devices. */
static bool readRoute(AudioObjectID process,OutputRoute *route) {
    UInt32 size=0;
    if (AudioObjectGetPropertyDataSize(process,&routeAddress,0,NULL,&size)!=noErr || !size ||
        size>sizeof(route->devices) || size%sizeof(AudioObjectID)) return false;
    UInt32 expectedSize=size;
    if (AudioObjectGetPropertyData(process,&routeAddress,0,NULL,&size,route->devices)!=noErr || size!=expectedSize) return false;
    route->process=process;
    route->count=size/sizeof(AudioObjectID);
    for (unsigned i=0;i<route->count;++i) {
        if (route->devices[i]==kAudioObjectUnknown) return false;
        for (unsigned j=i;j>0 && route->devices[j]<route->devices[j-1];--j) {
            AudioObjectID previous=route->devices[j-1];
            route->devices[j-1]=route->devices[j]; route->devices[j]=previous;
        }
    }
    for (unsigned i=1;i<route->count;++i) if (route->devices[i]==route->devices[i-1]) return false;
    return true;
}

static OSStatus routeChanged(AudioObjectID object,UInt32 count,const AudioObjectPropertyAddress addresses[],void *context) {
    (void)object; (void)count; (void)addresses;
    recordFault(context,FAULT_ROUTE);
    return noErr;
}

static bool isMusicProcess(AudioObjectID object) {
    CFStringRef bundle=NULL;
    UInt32 size=sizeof(bundle);
    OSStatus status=readProperty(object,kAudioProcessPropertyBundleID,&size,&bundle);
    bool matches=status==noErr && bundle!=NULL && CFEqual(bundle,CFSTR("com.apple.Music"));
    if (bundle) CFRelease(bundle);
    return matches;
}

static NSArray<NSNumber *> *musicProcesses(void) {
    AudioObjectPropertyAddress address={kAudioHardwarePropertyProcessObjectList,
        kAudioObjectPropertyScopeGlobal,kAudioObjectPropertyElementMain};
    UInt32 size=0;
    if (AudioObjectGetPropertyDataSize(kAudioObjectSystemObject,&address,0,NULL,&size)!=noErr ||
        size>1024*1024 || size%sizeof(AudioObjectID)) return nil;
    if (!size) return @[];
    NSMutableData *data=[NSMutableData dataWithLength:size];
    UInt32 capacity=size;
    if (AudioObjectGetPropertyData(kAudioObjectSystemObject,&address,0,NULL,&size,data.mutableBytes)!=noErr ||
        size>capacity || size%sizeof(AudioObjectID)) return nil;
    const AudioObjectID *objects=data.bytes;
    NSMutableArray<NSNumber *> *matches=[NSMutableArray array];
    for (UInt32 index=0;index<size/sizeof(AudioObjectID);++index)
        if (isMusicProcess(objects[index])) [matches addObject:@(objects[index])];
    return matches;
}

static bool supportedFormat(AudioStreamBasicDescription f) {
    UInt32 channels=(f.mFormatFlags&kAudioFormatFlagIsNonInterleaved) ? 1 : f.mChannelsPerFrame;
    UInt32 knownFlags=kAudioFormatFlagIsFloat|kAudioFormatFlagIsPacked|kAudioFormatFlagIsNonInterleaved;
    return f.mFormatID==kAudioFormatLinearPCM && (f.mFormatFlags&kAudioFormatFlagIsFloat) &&
        (f.mFormatFlags&kAudioFormatFlagIsPacked) && !(f.mFormatFlags&kAudioFormatFlagIsBigEndian) &&
        !(f.mFormatFlags&~knownFlags) &&
        !(f.mFormatFlags&kAudioFormatFlagIsAlignedHigh) && (f.mBitsPerChannel==32 || f.mBitsPerChannel==64) &&
        f.mChannelsPerFrame>=1 && f.mChannelsPerFrame<=2 && f.mBytesPerFrame==channels*f.mBitsPerChannel/8 &&
        f.mFramesPerPacket==1 && f.mBytesPerPacket==f.mBytesPerFrame &&
        isfinite(f.mSampleRate) && f.mSampleRate>=8000 && f.mSampleRate<=192000 &&
        fmod(f.mSampleRate,10)==0;
}

static OSStatus formatChanged(AudioObjectID object,UInt32 count,const AudioObjectPropertyAddress addresses[],void *context) {
    (void)object; (void)count; (void)addresses;
    recordFault(context,FAULT_FORMAT);
    return noErr;
}

static OSStatus audioCallback(AudioObjectID device,const AudioTimeStamp *now,const AudioBufferList *input,
    const AudioTimeStamp *inputTime,AudioBufferList *output,const AudioTimeStamp *outputTime,void *context) {
    (void)device; (void)now; (void)output; (void)outputTime;
    Capture *state=context;
    if (atomic_load_explicit(&state->fault,memory_order_acquire)!=FAULT_NONE) return noErr;
    const AudioStreamBasicDescription *f=&state->format;
    /* CoreAudio timestamps exclude sleep; the publication clock includes it. */
    double offset=hostNowMs(state)-mach_absolute_time()*state->hostTickMs;
    if (state->hasClockOffset && fabs(offset-state->clockOffsetMs)>2)
        music_analyzer_discontinuity(&state->analyzer);
    state->clockOffsetMs=offset;
    state->hasClockOffset=true;
    bool planar=(f->mFormatFlags&kAudioFormatFlagIsNonInterleaved)!=0;
    unsigned buffers=planar ? f->mChannelsPerFrame : 1;
    if (!input || input->mNumberBuffers!=buffers) { recordFault(state,FAULT_FORMAT); return noErr; }
    MusicBlock block={.sampleRateHz=(unsigned)f->mSampleRate,.channels=f->mChannelsPerFrame,
        .width=f->mBitsPerChannel/8,.planar=planar};
    for (unsigned b=0;b<buffers;++b) {
        const AudioBuffer *buffer=&input->mBuffers[b];
        unsigned channels=planar ? 1 : f->mChannelsPerFrame;
        if (buffer->mNumberChannels!=channels || buffer->mDataByteSize%(channels*block.width)) {
            recordFault(state,FAULT_FORMAT); return noErr;
        }
        unsigned frames=buffer->mDataByteSize/(channels*block.width);
        if (b && frames!=block.frameCount) { recordFault(state,FAULT_FORMAT); return noErr; }
        block.frameCount=frames;
        block.data[b]=buffer->mData;
        block.byteCount[b]=buffer->mDataByteSize;
    }
    if (!block.frameCount) return noErr;
    if (!inputTime || !(inputTime->mFlags&kAudioTimeStampHostTimeValid) ||
        !(inputTime->mFlags&kAudioTimeStampSampleTimeValid)) {
        recordFault(state,FAULT_TIMESTAMP); return noErr;
    }
    block.sampleTime=inputTime->mSampleTime;
    block.hostTimeMs=inputTime->mHostTime*state->hostTickMs+offset;
    MusicResult result=music_analyze(&state->analyzer,&block,&state->latest);
    if (result!=MUSIC_OK) recordFault(state,result==MUSIC_FORMAT ? FAULT_FORMAT :
        result==MUSIC_SAMPLE ? FAULT_SAMPLE : FAULT_TIMESTAMP);
    return noErr;
}

/* EOF ends the session. Any control bytes must form the one command, stop\n. */
static bool controlClosed(Fault *fault) {
    static char command[5];
    static size_t used;
    struct pollfd input={.fd=STDIN_FILENO,.events=POLLIN};
    int ready=poll(&input,1,0);
    if (ready<0) { if (errno!=EINTR) *fault=FAULT_INPUT; return *fault!=FAULT_NONE; }
    if (!ready) return false;
    if (input.revents&(POLLERR|POLLNVAL)) { *fault=FAULT_INPUT; return true; }
    if (!(input.revents&(POLLIN|POLLHUP))) return false;
    ssize_t count=read(STDIN_FILENO,command+used,sizeof(command)-used);
    if (!count) return true;
    if (count<0) { if (errno==EINTR || errno==EAGAIN) return false; *fault=FAULT_INPUT; return true; }
    used+=(size_t)count;
    if (memcmp(command,"stop\n",used)!=0) { *fault=FAULT_INPUT; return true; }
    return used==sizeof(command);
}

static Fault capture(NSArray<NSNumber *> *processes,Capture *state) {
    AudioObjectID tap=kAudioObjectUnknown,aggregate=kAudioObjectUnknown;
    AudioDeviceIOProcID proc=NULL;
    bool started=false,listening=false;
    OutputRoute routes[MAX_MUSIC_PROCESSES]={0};
    unsigned routeCount=0;
    Fault fault=FAULT_NONE;
    OSStatus status;
    AudioObjectPropertyAddress formatAddress={kAudioTapPropertyFormat,kAudioObjectPropertyScopeGlobal,kAudioObjectPropertyElementMain};
    char pending[2048];
    size_t length=0,offset=0;
    double outputStarted=0,lastSourceCheck=0,start=hostNowMs(state);
    CATapDescription *description=[[CATapDescription alloc] initStereoMixdownOfProcesses:processes];
    description.name=@"Bunny Music input";
    description.UUID=NSUUID.UUID;
    description.privateTap=YES;
    description.exclusive=NO;
    description.muteBehavior=CATapUnmuted;
    if (@available(macOS 26.0,*)) description.processRestoreEnabled=NO;
    NSDictionary *composition=@{
        @kAudioAggregateDeviceNameKey:@"Bunny private Music input",
        @kAudioAggregateDeviceUIDKey:[@"bunny-music-" stringByAppendingString:NSUUID.UUID.UUIDString],
        @kAudioAggregateDeviceIsPrivateKey:@YES,@kAudioAggregateDeviceTapAutoStartKey:@NO,
        @kAudioAggregateDeviceTapListKey:@[@{@kAudioSubTapUIDKey:description.UUID.UUIDString,
            @kAudioSubTapDriftCompensationKey:@YES}]
    };
    if (!processes.count || processes.count>MAX_MUSIC_PROCESSES) { fault=FAULT_ROUTE; goto cleanup; }
    for (NSNumber *process in processes) {
        AudioObjectID object=process.unsignedIntValue;
        if (AudioObjectAddPropertyListener(object,&routeAddress,routeChanged,state)!=noErr) { fault=FAULT_ROUTE; goto cleanup; }
        routes[routeCount].process=object;
        ++routeCount;
        if (!readRoute(object,&routes[routeCount-1])) { fault=FAULT_ROUTE; goto cleanup; }
    }
    fault=(Fault)atomic_load_explicit(&state->fault,memory_order_acquire);
    if (fault!=FAULT_NONE || stopRequested || controlClosed(&fault)) goto cleanup;
    status=AudioHardwareCreateProcessTap(description,&tap);
    if (status!=noErr) { fault=FAULT_CAPTURE; goto cleanup; }
    if (stopRequested || controlClosed(&fault)) goto cleanup;
    if (AudioObjectAddPropertyListener(tap,&formatAddress,formatChanged,state)!=noErr) { fault=FAULT_CAPTURE; goto cleanup; }
    listening=true;
    UInt32 size=sizeof(state->format);
    if (readProperty(tap,kAudioTapPropertyFormat,&size,&state->format)!=noErr || size!=sizeof(state->format)) { fault=FAULT_CAPTURE; goto cleanup; }
    if (!supportedFormat(state->format) || !music_analyzer_init(&state->analyzer,(unsigned)state->format.mSampleRate,state->format.mChannelsPerFrame)) {
        fault=FAULT_FORMAT; goto cleanup;
    }
    if (AudioHardwareCreateAggregateDevice((__bridge CFDictionaryRef)composition,&aggregate)!=noErr ||
        AudioDeviceCreateIOProcID(aggregate,audioCallback,state,&proc)!=noErr) { fault=FAULT_CAPTURE; goto cleanup; }
    fault=(Fault)atomic_load_explicit(&state->fault,memory_order_acquire);
    if (fault!=FAULT_NONE || stopRequested || controlClosed(&fault)) goto cleanup;
    if (AudioDeviceStart(aggregate,proc)!=noErr) { fault=FAULT_CAPTURE; goto cleanup; }
    started=true;
    while (!stopRequested && !controlClosed(&fault)) {
        double now=hostNowMs(state);
        if (now-start>=maximumCaptureMs) break;
        fault=(Fault)atomic_load_explicit(&state->fault,memory_order_acquire);
        if (fault!=FAULT_NONE) break;
        if (now-lastSourceCheck>=1000) {
            for (NSNumber *process in processes) if (!isMusicProcess(process.unsignedIntValue)) { fault=FAULT_SOURCE; break; }
            for (unsigned i=0;fault==FAULT_NONE && i<routeCount;++i) {
                OutputRoute current;
                if (!readRoute(routes[i].process,&current) || current.count!=routes[i].count ||
                    memcmp(current.devices,routes[i].devices,current.count*sizeof(AudioObjectID))!=0) fault=FAULT_ROUTE;
            }
            lastSourceCheck=now;
            if (fault!=FAULT_NONE) break;
        }
        if (!length) {
            MusicFrame frame;
            if (music_latest_take(&state->latest,&frame)) {
                if (frame.endMonotonicMs>now) { fault=FAULT_TIMESTAMP; break; }
                length=frameRecord(pending,sizeof(pending),&frame,now);
                offset=0; outputStarted=now;
                if (!length) { fault=FAULT_OUTPUT; break; }
            }
        }
        if (length) {
            fault=(Fault)atomic_load_explicit(&state->fault,memory_order_acquire);
            if (fault!=FAULT_NONE) break;
            ssize_t sent=write(STDOUT_FILENO,pending+offset,length-offset);
            if (sent>0) { offset+=(size_t)sent; if (offset==length) length=0; }
            else if (sent<0 && errno!=EAGAIN && errno!=EWOULDBLOCK && errno!=EINTR) { fault=FAULT_OUTPUT; break; }
            if (length && now-outputStarted>1000) { fault=FAULT_OUTPUT; break; }
        }
        struct pollfd control={.fd=STDIN_FILENO,.events=POLLIN};
        if (poll(&control,1,10)<0 && errno!=EINTR) { fault=FAULT_INPUT; break; }
    }
cleanup:
    /* Fence new callbacks and stop publication before resource teardown. */
    stopRequested=1;
    atomic_store_explicit(&state->fault,FAULT_CAPTURE,memory_order_release);
    if (started && AudioDeviceStop(aggregate,proc)!=noErr) fault=FAULT_CLEANUP;
    if (proc && AudioDeviceDestroyIOProcID(aggregate,proc)!=noErr) fault=FAULT_CLEANUP;
    if (listening && AudioObjectRemovePropertyListener(tap,&formatAddress,formatChanged,state)!=noErr) fault=FAULT_CLEANUP;
    if (aggregate!=kAudioObjectUnknown && AudioHardwareDestroyAggregateDevice(aggregate)!=noErr) fault=FAULT_CLEANUP;
    if (tap!=kAudioObjectUnknown && AudioHardwareDestroyProcessTap(tap)!=noErr) fault=FAULT_CLEANUP;
    for (unsigned i=0;i<routeCount;++i)
        if (AudioObjectRemovePropertyListener(routes[i].process,&routeAddress,routeChanged,state)!=noErr) fault=FAULT_CLEANUP;
    /* A partial record cannot be followed by a terminal record. Exit remains authoritative. */
    if (length && offset) return FAULT_OUTPUT;
    return fault;
}

static int selfTest(void) {
    Capture test={0};
    atomic_init(&test.fault,FAULT_NONE);
    music_latest_init(&test.latest);
    test.hostTickMs=0;
    test.format=(AudioStreamBasicDescription){.mSampleRate=48000,.mFormatID=kAudioFormatLinearPCM,
        .mFormatFlags=kAudioFormatFlagIsFloat|kAudioFormatFlagIsPacked,.mBytesPerPacket=8,
        .mFramesPerPacket=1,.mBytesPerFrame=8,.mChannelsPerFrame=2,.mBitsPerChannel=32};
    if (!supportedFormat(test.format) || !music_analyzer_init(&test.analyzer,48000,2)) return 1;
    float samples[9600];
    for (unsigned i=0;i<9600;++i) samples[i]=i%2 ? -0.25f : 0.25f;
    AudioBufferList input={.mNumberBuffers=1,.mBuffers={{2,sizeof(samples),samples}}};
    AudioTimeStamp time={.mSampleTime=0,.mHostTime=1000000,
        .mFlags=kAudioTimeStampHostTimeValid|kAudioTimeStampSampleTimeValid};
    audioCallback(0,NULL,&input,&time,NULL,NULL,&test);
    MusicFrame frame;
    if (atomic_load(&test.fault)!=FAULT_NONE || !music_latest_take(&test.latest,&frame) || frame.rms!=0.25) return 1;
    char record[2048];
    size_t size=frameRecord(record,sizeof(record),&frame,100);
    if (!size || fwrite(record,1,size,stdout)!=size) return 1;
    time.mFlags=0;
    audioCallback(0,NULL,&input,&time,NULL,NULL,&test);
    return atomic_load(&test.fault)==FAULT_TIMESTAMP ? 0 : 1;
}

int main(int argc,const char *argv[]) {
    @autoreleasepool {
        signal(SIGPIPE,SIG_IGN);
        if (argc==2 && strcmp(argv[1],"--clock")==0) {
            mach_timebase_info_data_t timebase;
            if (mach_timebase_info(&timebase)!=KERN_SUCCESS || !timebase.denom) return 1;
            double clockMs=(double)mach_continuous_time()*timebase.numer/timebase.denom/1e6;
            printf("{\"schema\":\"music-native-clock/1.0\",\"monotonicMs\":%.9f}\n",clockMs);
            return 0;
        }
        if (argc==2 && strcmp(argv[1],"--self-test")==0) return selfTest();
        Fault fault=FAULT_USAGE;
        if (argc==2 && strcmp(argv[1],"--capture")==0) {
            signal(SIGTERM,handleSignal); signal(SIGINT,handleSignal);
            fault=FAULT_NONE;
            /* A dead parent cannot start a tap, including after a delayed permission response. */
            if (controlClosed(&fault)) goto finished;
            struct stat output;
            int flags=fcntl(STDOUT_FILENO,F_GETFL);
            if (fstat(STDOUT_FILENO,&output)!=0 || (!S_ISFIFO(output.st_mode) && !S_ISSOCK(output.st_mode)) ||
                flags<0 || fcntl(STDOUT_FILENO,F_SETFL,flags|O_NONBLOCK)<0) { fault=FAULT_OUTPUT; goto finished; }
            mach_timebase_info_data_t timebase;
            if (mach_timebase_info(&timebase)!=KERN_SUCCESS || !timebase.denom) { fault=FAULT_TIMESTAMP; goto finished; }
            captureState.hostTickMs=(double)timebase.numer/timebase.denom/1e6;
            atomic_init(&captureState.fault,FAULT_NONE);
            music_latest_init(&captureState.latest);
            if (!music_latest_lock_free(&captureState.latest) || !atomic_is_lock_free(&captureState.fault)) { fault=FAULT_CAPACITY; goto finished; }
            NSArray<NSNumber *> *processes=musicProcesses();
            if (processes==nil) fault=FAULT_CAPTURE;
            else if (!processes.count) fault=FAULT_SOURCE;
            else if (!stopRequested && !controlClosed(&fault)) fault=capture(processes,&captureState);
        }
finished:
        if (fault!=FAULT_NONE && fault!=FAULT_OUTPUT) {
            char record[512];
            size_t size=terminalRecord(record,sizeof(record),fault);
            if (size) (void)write(STDOUT_FILENO,record,size);
        }
        return fault==FAULT_NONE ? 0 : fault==FAULT_USAGE ? 2 : 1;
    }
}
