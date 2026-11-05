#ifndef BUNNY_MUSIC_SIGNAL_H
#define BUNNY_MUSIC_SIGNAL_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdatomic.h>

enum { MUSIC_MAX_BLOCK_FRAMES = 8192 };
typedef enum { MUSIC_OK, MUSIC_FORMAT, MUSIC_SAMPLE, MUSIC_TIMESTAMP } MusicResult;
typedef struct {
    uint64_t sequence;
    unsigned sampleRateHz, channels, frameCount;
    double startMonotonicMs, endMonotonicMs;
    double rms, peak, clippedFraction;
    double bass, mid, treble, onsetStrength, onsetConfidence;
    bool discontinuity;
} MusicFrame;

/* One callback writer and one publisher reader. Each owns its current slot. */
typedef struct {
    MusicFrame slots[3];
    atomic_uint middle;
    unsigned writer, reader;
    uint64_t lastRead;
} MusicLatest;
void music_latest_init(MusicLatest *latest);
bool music_latest_lock_free(MusicLatest *latest);
void music_latest_publish(MusicLatest *latest, MusicFrame frame);
bool music_latest_take(MusicLatest *latest, MusicFrame *frame);

typedef struct {
    unsigned sampleRateHz, channels, width;
    bool planar;
    const void *data[2];
    size_t byteCount[2];
    unsigned frameCount;
    double sampleTime, hostTimeMs;
} MusicBlock;

typedef struct {
    unsigned rate, channels, windowFrames, accumulated;
    uint64_t sequence, clipped;
    double low[2], high[2], lowAlpha, highAlpha;
    double energy, peak, bassEnergy, midEnergy, trebleEnergy, previousRms;
    double windowStart, expectedSample, expectedHost, lastHost;
    bool hasTimestamp, hasPrevious, discontinuity;
} MusicAnalyzer;
bool music_analyzer_init(MusicAnalyzer *analyzer, unsigned rate, unsigned channels);
void music_analyzer_discontinuity(MusicAnalyzer *analyzer);
MusicResult music_analyze(MusicAnalyzer *analyzer, const MusicBlock *block, MusicLatest *latest);

#endif
