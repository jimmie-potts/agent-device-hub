#include "music_signal.h"
#include <assert.h>
#include <math.h>
#include <pthread.h>
#include <stdio.h>
#include <string.h>

static const double pi = 3.14159265358979323846;
static float samples[9600];

static MusicFrame run_window(MusicAnalyzer *a, MusicLatest *latest, double start, unsigned channels) {
    MusicBlock b = {.sampleRateHz=48000, .channels=channels, .width=4, .planar=false,
        .data={samples, NULL}, .byteCount={4800 * channels * sizeof(float), 0},
        .frameCount=4800, .sampleTime=start * 48, .hostTimeMs=1000 + start};
    assert(music_analyze(a, &b, latest) == MUSIC_OK);
    MusicFrame frame;
    assert(music_latest_take(latest, &frame));
    return frame;
}

static void levels(void) {
    MusicAnalyzer a; MusicLatest latest; music_latest_init(&latest);
    assert(music_analyzer_init(&a, 48000, 2));
    memset(samples, 0, sizeof(samples));
    MusicFrame frame = run_window(&a, &latest, 0, 2);
    assert(frame.rms == 0 && frame.peak == 0 && frame.bass == 0);
    assert(frame.sequence == 1 && frame.frameCount == 4800 && frame.channels == 2);
    assert(frame.discontinuity && frame.onsetConfidence == 0);
    assert(frame.startMonotonicMs == 1000 && frame.endMonotonicMs == 1100);
    for (unsigned i=0; i<9600; ++i) samples[i] = i % 2 ? -0.5f : 0.5f;
    frame = run_window(&a, &latest, 100, 2);
    assert(fabs(frame.rms - 0.5) < 1e-9 && frame.peak == 0.5);
    assert(frame.clippedFraction == 0 && !frame.discontinuity);
    assert(frame.onsetStrength == 1 && frame.onsetConfidence > 0.9);
    frame = run_window(&a, &latest, 200, 2);
    assert(frame.onsetStrength == 0 && frame.onsetConfidence == 0);
    for (unsigned i=0; i<9600; ++i) samples[i] = i % 2 ? -1.5f : 0.5f;
    frame = run_window(&a, &latest, 300, 2);
    assert(frame.peak == 1.5 && fabs(frame.rms - sqrt(1.25)) < 1e-9);
    assert(frame.clippedFraction == 0.5);
}

static MusicFrame tone(double frequency) {
    MusicAnalyzer a; MusicLatest latest; music_latest_init(&latest);
    assert(music_analyzer_init(&a, 48000, 1));
    MusicFrame frame = {0};
    for (unsigned w=0; w<3; ++w) {
        for (unsigned i=0; i<4800; ++i) samples[i] = (float)(0.5 * sin(2*pi*frequency*i/48000));
        frame = run_window(&a, &latest, w*100, 1);
    }
    assert(fabs(frame.rms - sqrt(0.125)) < 1e-6);
    /* 8 kHz has six samples per cycle, so its sampled peak is below 0.5. */
    assert(frame.peak>0.43 && frame.peak<=0.500001);
    return frame;
}

static void bands(void) {
    MusicFrame low=tone(50), mid=tone(700), high=tone(8000);
    assert(low.bass > 3*low.mid && low.bass > 8*low.treble);
    assert(mid.mid > 2*mid.bass && mid.mid > 2*mid.treble);
    assert(high.treble > 3*high.mid && high.treble > 10*high.bass);
}

static void validation(void) {
    MusicAnalyzer a; MusicLatest latest; music_latest_init(&latest);
    assert(!music_analyzer_init(&a, 7990, 1));
    assert(!music_analyzer_init(&a, 48001, 1));
    assert(!music_analyzer_init(&a, 48000, 3));
    assert(music_analyzer_init(&a, 48000, 1));
    double data[4800] = {0};
    MusicBlock b={.sampleRateHz=48000,.channels=1,.width=8,.planar=true,
        .data={data,NULL},.byteCount={sizeof(data),0},.frameCount=4800,.sampleTime=0,.hostTimeMs=1000};
    data[4799]=NAN;
    assert(music_analyze(&a,&b,&latest)==MUSIC_SAMPLE && a.sequence==0 && a.accumulated==0);
    data[4799]=INFINITY; assert(music_analyze(&a,&b,&latest)==MUSIC_SAMPLE);
    data[4799]=17; assert(music_analyze(&a,&b,&latest)==MUSIC_SAMPLE);
    data[4799]=0; b.byteCount[0]--; assert(music_analyze(&a,&b,&latest)==MUSIC_FORMAT);
    b.byteCount[0]++; b.hostTimeMs=NAN; assert(music_analyze(&a,&b,&latest)==MUSIC_TIMESTAMP);
    b.hostTimeMs=1000; assert(music_analyze(&a,&b,&latest)==MUSIC_OK);
    MusicFrame frame; assert(music_latest_take(&latest,&frame));
    b.hostTimeMs=999; assert(music_analyze(&a,&b,&latest)==MUSIC_TIMESTAMP);
    b.hostTimeMs=1200; b.sampleTime=9600; assert(music_analyze(&a,&b,&latest)==MUSIC_OK);
    assert(music_latest_take(&latest,&frame) && frame.discontinuity && frame.sequence==2);
    assert(frame.startMonotonicMs==1200 && frame.endMonotonicMs==1300);
    b.sampleRateHz=44100; assert(music_analyze(&a,&b,&latest)==MUSIC_FORMAT);
}

static void partial_and_gap(void) {
    MusicAnalyzer a; MusicLatest latest; music_latest_init(&latest);
    assert(music_analyzer_init(&a,48000,1));
    memset(samples,0,sizeof(samples));
    MusicBlock b={.sampleRateHz=48000,.channels=1,.width=4,.data={samples,NULL},
        .byteCount={2400*sizeof(float),0},.frameCount=2400,.hostTimeMs=1000,.sampleTime=0};
    assert(music_analyze(&a,&b,&latest)==MUSIC_OK);
    MusicFrame frame; assert(!music_latest_take(&latest,&frame));
    b.hostTimeMs=1100; b.sampleTime=4800;
    assert(music_analyze(&a,&b,&latest)==MUSIC_OK);
    assert(!music_latest_take(&latest,&frame));
    b.hostTimeMs=1150; b.sampleTime=7200;
    assert(music_analyze(&a,&b,&latest)==MUSIC_OK);
    assert(music_latest_take(&latest,&frame) && frame.startMonotonicMs==1100);
    assert(frame.discontinuity && frame.sequence==1);
}

static void planar_and_bounds(void) {
    MusicAnalyzer a; MusicLatest latest; music_latest_init(&latest);
    assert(music_analyzer_init(&a,48000,2));
    double left[4800],right[4800];
    MusicBlock b={.sampleRateHz=48000,.channels=2,.width=8,.planar=true,
        .data={left,right},.byteCount={sizeof(left),sizeof(right)},.frameCount=4800};
    for (unsigned w=0;w<10;++w) {
        for (unsigned i=0;i<4800;++i) {
            left[i]=w%2 ? -16 : 16;
            right[i]=-left[i];
        }
        b.sampleTime=w*4800; b.hostTimeMs=1000+w*100;
        assert(music_analyze(&a,&b,&latest)==MUSIC_OK);
        MusicFrame frame; assert(music_latest_take(&latest,&frame));
        assert(frame.rms==16 && frame.peak==16 && frame.clippedFraction==1);
        assert(frame.bass>=0 && frame.bass<=32 && frame.mid>=0 && frame.mid<=32 && frame.treble>=0 && frame.treble<=32);
        assert(frame.onsetStrength>=0 && frame.onsetStrength<=1 && frame.onsetConfidence>=0 && frame.onsetConfidence<=1);
    }
    music_analyzer_discontinuity(&a);
    b.sampleTime+=4800; b.hostTimeMs+=100;
    assert(music_analyze(&a,&b,&latest)==MUSIC_OK);
    MusicFrame frame; assert(music_latest_take(&latest,&frame) && frame.discontinuity && frame.onsetConfidence==0);
    b.byteCount[1]--; assert(music_analyze(&a,&b,&latest)==MUSIC_FORMAT);
}

static void *publish_many(void *context) {
    MusicLatest *latest=context;
    for (uint64_t n=1;n<=100000;++n) music_latest_publish(latest,(MusicFrame){.sequence=n,.rms=(double)n,.peak=(double)n});
    return NULL;
}

static void latest_value(void) {
    MusicLatest latest; music_latest_init(&latest);
    assert(music_latest_lock_free(&latest));
    for (uint64_t n=1;n<=100;++n) music_latest_publish(&latest,(MusicFrame){.sequence=n});
    MusicFrame frame;
    assert(music_latest_take(&latest,&frame) && frame.sequence==100 && frame.discontinuity);
    assert(!music_latest_take(&latest,&frame));
    music_latest_init(&latest);
    pthread_t writer; assert(pthread_create(&writer,NULL,publish_many,&latest)==0);
    uint64_t last=0;
    while (last<100000) {
        if (!music_latest_take(&latest,&frame)) continue;
        assert(frame.sequence>last && frame.rms==(double)frame.sequence && frame.peak==frame.rms);
        if (frame.sequence!=last+1) assert(frame.discontinuity);
        last=frame.sequence;
    }
    assert(pthread_join(writer,NULL)==0);
}

int main(void) {
    levels(); bands(); validation(); partial_and_gap(); planar_and_bounds(); latest_value();
    puts("music-native: synthetic signal and concurrent latest-value checks passed; no capture");
    return 0;
}
