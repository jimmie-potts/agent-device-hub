#ifndef BUNNY_MUSIC_PLAYBACK_H
#define BUNNY_MUSIC_PLAYBACK_H

#include <stdbool.h>

#define MP_MAX_OUTPUTS 8
#define MP_TEXT_BYTES 256
#define MP_OUTPUT_NAME_BYTES 128
#define MP_ID_BYTES 128
#define MP_RECORD_BYTES 16384
#define MP_DESCRIPTOR_BYTES 65536
#define MP_MAX_TIME 9007199254740991.0
#define MP_MAX_SECONDS 9007199254740.991

typedef enum {
    MP_OK, MP_UNAVAILABLE, MP_FORBIDDEN, MP_INVALID_MESSAGE, MP_INVALID_REQUEST,
    MP_CAPACITY, MP_EXPIRED, MP_INVALID_STATE, MP_UNSUPPORTED, MP_UNCERTAIN
} MPError;
typedef enum { MP_READ, MP_PLAY, MP_PAUSE, MP_NEXT, MP_PREVIOUS } MPAction;
typedef enum { MP_UNSENT, MP_SENT, MP_REFUSED, MP_UNKNOWN } MPControlStatus;
typedef enum { MP_EMPTY, MP_NUMBER, MP_TEXT, MP_ENUM, MP_BOOL, MP_COUNT } MPValueKind;
typedef enum { MP_PLAYING, MP_PAUSED, MP_STOPPED, MP_FAST_FORWARDING, MP_REWINDING } MPPlayer;
typedef enum { MP_COMPUTER, MP_AIRPORT_EXPRESS, MP_APPLE_TV, MP_AIRPLAY_DEVICE, MP_BLUETOOTH, MP_HOME_POD, MP_TV, MP_UNKNOWN_OUTPUT } MPOutputKind;
typedef enum {
    MP_STATE, MP_ITEM_BEFORE, MP_POSITION, MP_TITLE, MP_ARTIST, MP_ALBUM, MP_DURATION, MP_ITEM_AFTER,
    MP_OUTPUT_LIST, MP_AIRPLAY_ENABLED, MP_OUTPUT_NAME, MP_OUTPUT_KIND, MP_OUTPUT_ACTIVE, MP_OUTPUT_AVAILABLE, MP_OUTPUT_SELECTED
} MPQuery;
typedef struct { double start, end; } MPInterval;
typedef struct {
    MPValueKind kind;
    union { double number; char text[MP_TEXT_BYTES+1]; unsigned enumeration; bool boolean; unsigned count; };
} MPValue;
typedef struct { MPError error; MPInterval interval; MPValue value; } MPField;
typedef struct { MPField name, kind, active, available, selected; } MPOutput;
typedef struct {
    MPError error;
    MPInterval interval, selection_interval;
    MPField airplay_enabled;
    unsigned count;
    MPOutput devices[MP_MAX_OUTPUTS];
} MPSelection;
typedef struct {
    MPError error;
    MPInterval interval;
    char instance[65];
    MPField state, position, item, title, artist, album, duration;
    bool item_associated;
    MPInterval association;
    MPSelection output;
} MPObservation;
typedef struct {
    MPAction action;
    MPControlStatus status;
    MPError error;
    MPInterval interval, send;
    bool attempted;
    char expected_instance[65];
} MPCommand;

/* This private adapter describes only the Music scripting operations used here. */
typedef struct {
    void *context;
    double (*now)(void *context);
    MPError (*select)(void *context, char instance[65]);
    bool (*same)(void *context);
    MPError (*permission)(void *context, MPAction action);
    MPError (*read)(void *context, MPQuery query, unsigned ordinal, double deadline, MPValue *value);
    MPControlStatus (*control)(void *context, MPAction action, double deadline, MPError *error, MPInterval *send, bool *attempted);
} MPAPI;

MPObservation mp_observe(const MPAPI *api);
MPCommand mp_command(const MPAPI *api, MPAction action, const char *expected_instance, double deadline);
const char *mp_error_code(MPError error);
const char *mp_error_detail(MPError error);
bool mp_error_retryable(MPError error);
bool mp_instance_valid(const char *instance);
bool mp_time_valid(double value);

#endif
