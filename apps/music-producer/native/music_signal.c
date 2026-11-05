#include "music_signal.h"
#include <math.h>
#include <string.h>

enum { DIRTY = 4, SLOT = 3 };

void music_latest_init(MusicLatest *q) {
    memset(q,0,sizeof(*q));
    atomic_init(&q->middle,2);
    q->writer=0;
    q->reader=1;
}
bool music_latest_lock_free(MusicLatest *q) { return atomic_is_lock_free(&q->middle); }

void music_latest_publish(MusicLatest *q, MusicFrame f) {
    q->slots[q->writer]=f;
    q->writer=atomic_exchange_explicit(&q->middle,q->writer|DIRTY,memory_order_acq_rel)&SLOT;
}

bool music_latest_take(MusicLatest *q, MusicFrame *f) {
    if (!(atomic_load_explicit(&q->middle,memory_order_acquire)&DIRTY)) return false;
    q->reader=atomic_exchange_explicit(&q->middle,q->reader,memory_order_acq_rel)&SLOT;
    *f=q->slots[q->reader];
    if (f->sequence!=q->lastRead+1) f->discontinuity=true;
    q->lastRead=f->sequence;
    return true;
}

bool music_analyzer_init(MusicAnalyzer *a,unsigned rate,unsigned channels) {
    memset(a,0,sizeof(*a));
    if (rate<8000 || rate>192000 || rate%10 || channels<1 || channels>2) return false;
    a->rate=rate;
    a->channels=channels;
    a->windowFrames=rate/10;
    a->lowAlpha=1-exp(-2*3.14159265358979323846*200/rate);
    a->highAlpha=1-exp(-2*3.14159265358979323846*2000/rate);
    a->discontinuity=true;
    return true;
}

static double sample(const MusicBlock *b,unsigned frame,unsigned channel) {
    const unsigned buffer=b->planar ? channel : 0;
    const size_t index=b->planar ? frame : frame*b->channels+channel;
    const unsigned char *address=(const unsigned char *)b->data[buffer]+index*b->width;
    if (b->width==4) { float value; memcpy(&value,address,4); return value; }
    double value; memcpy(&value,address,8); return value;
}

static void clear_window(MusicAnalyzer *a) {
    a->accumulated=0;
    a->clipped=0;
    a->energy=0;
    a->peak=0;
    a->bassEnergy=0;
    a->midEnergy=0;
    a->trebleEnergy=0;
}

void music_analyzer_discontinuity(MusicAnalyzer *a) {
    clear_window(a);
    memset(a->low,0,sizeof(a->low));
    memset(a->high,0,sizeof(a->high));
    a->hasPrevious=false;
    a->discontinuity=true;
}

static void finish_window(MusicAnalyzer *a,MusicLatest *q) {
    double count=(double)a->windowFrames*a->channels;
    double rms=sqrt(a->energy/count);
    double strength=a->hasPrevious && rms>1e-9 ? fmax(0,(rms-a->previousRms)/rms) : 0;
    MusicFrame frame={.sequence=++a->sequence,.sampleRateHz=a->rate,.channels=a->channels,
        .frameCount=a->windowFrames,.startMonotonicMs=a->windowStart,
        .endMonotonicMs=a->windowStart+100,.rms=rms,.peak=a->peak,
        .clippedFraction=a->clipped/count,.bass=sqrt(a->bassEnergy/count),
        .mid=sqrt(a->midEnergy/count),.treble=sqrt(a->trebleEnergy/count),
        .onsetStrength=strength,.onsetConfidence=strength*fmin(1,rms/0.05),
        .discontinuity=a->discontinuity};
    music_latest_publish(q,frame);
    a->previousRms=rms;
    a->hasPrevious=true;
    a->discontinuity=false;
    clear_window(a);
}

MusicResult music_analyze(MusicAnalyzer *a,const MusicBlock *b,MusicLatest *q) {
    if (!a->rate || b->sampleRateHz!=a->rate || b->channels!=a->channels ||
        (b->width!=4 && b->width!=8) || b->frameCount==0 || b->frameCount>MUSIC_MAX_BLOCK_FRAMES)
        return MUSIC_FORMAT;
    unsigned buffers=b->planar ? b->channels : 1;
    size_t bytes=(size_t)b->frameCount*b->width*(b->planar ? 1 : b->channels);
    for (unsigned n=0;n<buffers;++n) if (!b->data[n] || b->byteCount[n]!=bytes) return MUSIC_FORMAT;
    if (!isfinite(b->sampleTime) || fabs(b->sampleTime)>9007199254740991.0 ||
        !isfinite(b->hostTimeMs) || b->hostTimeMs<0 ||
        b->hostTimeMs>9007199254740000.0 ||
        (a->hasTimestamp && b->hostTimeMs<=a->lastHost)) return MUSIC_TIMESTAMP;
    /* Refuse an entire bad callback before publishing any of its windows. */
    for (unsigned i=0;i<b->frameCount;++i) for (unsigned c=0;c<b->channels;++c) {
        double value=sample(b,i,c);
        if (!isfinite(value) || fabs(value)>16) return MUSIC_SAMPLE;
    }
    if (a->hasTimestamp && (fabs(b->sampleTime-a->expectedSample)>0.5 ||
        fabs(b->hostTimeMs-a->expectedHost)>2)) {
        music_analyzer_discontinuity(a);
    }
    for (unsigned i=0;i<b->frameCount;++i) {
        if (!a->accumulated) a->windowStart=b->hostTimeMs+(double)i*1000/a->rate;
        for (unsigned c=0;c<b->channels;++c) {
            double value=sample(b,i,c), magnitude=fabs(value);
            a->energy+=value*value;
            a->peak=fmax(a->peak,magnitude);
            a->clipped+=magnitude>=1;
            a->low[c]+=a->lowAlpha*(value-a->low[c]);
            a->high[c]+=a->highAlpha*(value-a->high[c]);
            double bass=a->low[c], mid=a->high[c]-bass, treble=value-a->high[c];
            a->bassEnergy+=bass*bass;
            a->midEnergy+=mid*mid;
            a->trebleEnergy+=treble*treble;
        }
        if (++a->accumulated==a->windowFrames) finish_window(a,q);
    }
    a->hasTimestamp=true;
    a->lastHost=b->hostTimeMs;
    a->expectedHost=b->hostTimeMs+(double)b->frameCount*1000/a->rate;
    a->expectedSample=b->sampleTime+b->frameCount;
    return MUSIC_OK;
}
