#include "music_playback.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>

typedef struct {
    double now;
    unsigned reads, controls, permissions, same_checks;
    unsigned outputs;
    unsigned lose_after;
    bool denied, changed_item;
    double read_ms, control_ms;
    MPControlStatus control_result;
    char instance[65];
    MPQuery queried[64];
} Fake;
static double clock_now(void *context) { return ((Fake *)context)->now; }
static MPError select_music(void *context, char instance[65]) {
    Fake *fake=context; strcpy(instance,fake->instance); return MP_OK;
}
static bool same_music(void *context) {
    Fake *fake=context; ++fake->same_checks; return !fake->lose_after || fake->reads<fake->lose_after;
}
static MPError permission(void *context, MPAction action) {
    Fake *fake=context; ++fake->permissions; assert(action>=MP_READ && action<=MP_PREVIOUS);
    return fake->denied ? MP_FORBIDDEN : MP_OK;
}
static MPError read_value(void *context, MPQuery query, unsigned ordinal, double deadline, MPValue *value) {
    Fake *fake=context; assert(deadline>fake->now && deadline-fake->now<=2000); fake->queried[fake->reads++]=query;
    if (fake->now+fake->read_ms>deadline) { fake->now=deadline; return MP_UNAVAILABLE; }
    fake->now+=fake->read_ms;
    assert(ordinal<MP_MAX_OUTPUTS);
    if (query==MP_STATE) { value->kind=MP_ENUM; value->enumeration=MP_PLAYING; }
    else if (query==MP_POSITION || query==MP_DURATION) { value->kind=MP_NUMBER; value->number=12.5; }
    else if (query==MP_ITEM_BEFORE || query==MP_ITEM_AFTER) {
        value->kind=MP_TEXT; strcpy(value->text,fake->changed_item && query==MP_ITEM_AFTER ? "BEEF" : "CAFE");
    } else if (query==MP_OUTPUT_LIST) { value->kind=MP_COUNT; value->count=fake->outputs; }
    else if (query==MP_OUTPUT_KIND) { value->kind=MP_ENUM; value->enumeration=MP_HOME_POD; }
    else if (query>=MP_AIRPLAY_ENABLED && query!=MP_OUTPUT_NAME) { value->kind=MP_BOOL; value->boolean=true; }
    else { value->kind=MP_TEXT; strcpy(value->text,"Synthetic"); }
    return MP_OK;
}
static MPControlStatus control(void *context, MPAction action, double deadline, MPError *error, MPInterval *send, bool *attempted) {
    Fake *fake=context; assert(action>=MP_PLAY && action<=MP_PREVIOUS && deadline>fake->now);
    *attempted=true; send->start=fake->now;
    ++fake->controls; fake->now+=fake->control_ms; send->end=fake->now;
    *error=fake->control_result==MP_REFUSED ? MP_INVALID_STATE : MP_UNCERTAIN;
    return fake->control_result;
}
static MPAPI api(Fake *fake) {
    *fake=(Fake){.now=1000,.outputs=2,.read_ms=10,.control_ms=10,.control_result=MP_SENT};
    memset(fake->instance,'a',64); fake->instance[64]='\0';
    return (MPAPI){fake,clock_now,select_music,same_music,permission,read_value,control};
}
int main(void) {
    Fake fake; MPAPI callbacks=api(&fake);
    MPObservation value=mp_observe(&callbacks);
    assert(value.error==MP_OK && value.state.error==MP_OK && value.position.value.number==12.5);
    assert(value.item.error==MP_OK && value.item_associated && value.output.error==MP_OK && value.output.count==2);
    assert(value.association.start<=value.position.interval.start && value.position.interval.end<=value.association.end);
    callbacks=api(&fake); fake.changed_item=true; value=mp_observe(&callbacks);
    assert(value.error==MP_OK && value.position.error==MP_OK && !value.item_associated && value.item.error!=MP_OK);
    callbacks=api(&fake); fake.lose_after=2; value=mp_observe(&callbacks);
    assert(value.error==MP_UNAVAILABLE && fake.reads==2);
    callbacks=api(&fake); fake.outputs=9; value=mp_observe(&callbacks);
    assert(value.error==MP_OK && value.output.error==MP_CAPACITY && value.output.count==0);
    callbacks=api(&fake); fake.denied=true; value=mp_observe(&callbacks);
    assert(value.error==MP_FORBIDDEN && fake.reads==0);
    callbacks=api(&fake); fake.read_ms=1800; value=mp_observe(&callbacks);
    assert(value.error==MP_OK && value.output.interval.start>=1000 && value.interval.end<=6000);
    assert(fake.queried[fake.reads-1]==MP_OUTPUT_LIST && value.output.error==MP_UNAVAILABLE && !value.item_associated);
    callbacks=api(&fake);
    MPCommand result=mp_command(&callbacks,MP_NEXT,fake.instance,999);
    assert(result.status==MP_UNSENT && result.error==MP_EXPIRED && fake.controls==0 && fake.permissions==0);
    callbacks=api(&fake);
    result=mp_command(&callbacks,MP_NEXT,"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",3000);
    assert(result.status==MP_UNSENT && result.error==MP_UNAVAILABLE && fake.controls==0);
    for (MPAction action=MP_PLAY;action<=MP_PREVIOUS;++action) {
        callbacks=api(&fake); result=mp_command(&callbacks,action,fake.instance,4000);
        assert(result.status==MP_SENT && result.attempted && fake.controls==1);
    }
    callbacks=api(&fake); fake.control_result=MP_REFUSED; result=mp_command(&callbacks,MP_PAUSE,fake.instance,4000);
    assert(result.status==MP_REFUSED && result.attempted && result.error==MP_INVALID_STATE);
    callbacks=api(&fake); fake.control_ms=5000; result=mp_command(&callbacks,MP_PLAY,fake.instance,2000);
    assert(result.status==MP_SENT && result.send.end>2000); /* A real late definitive reply is evidence. */
    assert(strcmp(mp_error_code(MP_UNCERTAIN),"uncertain-result")==0 && !mp_error_retryable(MP_UNCERTAIN));
    assert(mp_error_retryable(MP_CAPACITY) && mp_error_retryable(MP_UNAVAILABLE) && !mp_error_retryable(MP_EXPIRED));
    puts("Music playback portable policy: process, partial identity, output cap, deadlines and four controls passed.");
    return 0;
}
