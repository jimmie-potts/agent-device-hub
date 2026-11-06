#include "music_playback.h"
#include <math.h>
#include <string.h>

static const char *codes[]={"", "unavailable", "forbidden", "invalid-message", "invalid-request", "capacity", "expired", "invalid-state", "unsupported-capability", "uncertain-result"};
static const char *details[]={"",
    "The selected Music process or requested field is unavailable.",
    "Music automation permission is unavailable without prompting.",
    "Music returned an invalid playback descriptor.",
    "Use a supported explicit Music playback helper command.",
    "Music playback data exceeds the helper's fixed limits.",
    "The Music playback operation deadline passed before transmission.",
    "Music refused the requested playback action.",
    "Music does not support the requested playback operation.",
    "The Music playback action has no qualified definitive reply."};
const char *mp_error_code(MPError error) { return codes[error>MP_OK && error<=MP_UNCERTAIN ? error : MP_INVALID_MESSAGE]; }
const char *mp_error_detail(MPError error) { return details[error>MP_OK && error<=MP_UNCERTAIN ? error : MP_INVALID_MESSAGE]; }
bool mp_error_retryable(MPError error) { return error==MP_UNAVAILABLE || error==MP_CAPACITY; }
bool mp_time_valid(double value) { return isfinite(value) && value>=0 && value<=MP_MAX_TIME; }
bool mp_instance_valid(const char *instance) {
    if (!instance) return false;
    for (unsigned i=0;i<64;++i) if (!((instance[i]>='0' && instance[i]<='9') || (instance[i]>='a' && instance[i]<='f'))) return false;
    return instance[64]=='\0';
}
static double earlier(double left,double right) { return left<right ? left : right; }
static MPField absent(double now,MPError error) { return (MPField){.error=error,.interval={now,now}}; }
static bool valid_value(MPQuery query,const MPValue *value) {
    switch (query) {
        case MP_STATE: return value->kind==MP_ENUM && value->enumeration<=MP_REWINDING;
        case MP_OUTPUT_KIND: return value->kind==MP_ENUM && value->enumeration<=MP_UNKNOWN_OUTPUT;
        case MP_POSITION: case MP_DURATION:
            return value->kind==MP_NUMBER && isfinite(value->number) && value->number>=0 && value->number<=MP_MAX_SECONDS;
        case MP_AIRPLAY_ENABLED: case MP_OUTPUT_ACTIVE: case MP_OUTPUT_AVAILABLE: case MP_OUTPUT_SELECTED: return value->kind==MP_BOOL;
        case MP_OUTPUT_LIST: return value->kind==MP_COUNT;
        default: {
            if (value->kind!=MP_TEXT) return false;
            unsigned limit=query==MP_OUTPUT_NAME ? MP_OUTPUT_NAME_BYTES : query==MP_ITEM_BEFORE || query==MP_ITEM_AFTER ? MP_ID_BYTES : MP_TEXT_BYTES;
            unsigned length=0;
            while (length<=limit && value->text[length]!='\0') ++length;
            if (length>limit) return false;
            if (query==MP_ITEM_BEFORE || query==MP_ITEM_AFTER) {
                if (!length) return false;
                for (unsigned i=0;i<length;++i) if (!((value->text[i]>='0' && value->text[i]<='9') || (value->text[i]>='A' && value->text[i]<='F'))) return false;
            }
            return true;
        }
    }
}
static MPField query(const MPAPI *api,MPQuery field,unsigned ordinal,double deadline,MPError *fatal) {
    double start=api->now(api->context);
    if (!mp_time_valid(start)) { *fatal=MP_INVALID_MESSAGE; return absent(0,*fatal); }
    if (*fatal!=MP_OK) return absent(start,*fatal);
    if (start>=deadline) return absent(start,MP_EXPIRED);
    if (!api->same(api->context)) { *fatal=MP_UNAVAILABLE; return absent(start,*fatal); }
    MPField result=absent(start,MP_OK);
    result.error=api->read(api->context,field,ordinal,earlier(deadline,start+2000),&result.value);
    double end=api->now(api->context);
    if (!mp_time_valid(end) || end<start) { *fatal=MP_INVALID_MESSAGE; result.error=*fatal; return result; }
    result.interval.end=end;
    if (!api->same(api->context)) *fatal=MP_UNAVAILABLE;
    if (result.error==MP_FORBIDDEN) *fatal=MP_FORBIDDEN;
    if (end>deadline) result.error=MP_EXPIRED;
    if (result.error==MP_OK && !valid_value(field,&result.value)) result.error=MP_INVALID_MESSAGE;
    if (*fatal!=MP_OK) result.error=*fatal;
    return result;
}
MPObservation mp_observe(const MPAPI *api) {
    double start=api->now(api->context);
    MPObservation result={.error=MP_INVALID_MESSAGE};
    if (!mp_time_valid(start)) return result;
    result.interval=(MPInterval){start,start};
    result.state=result.position=result.item=result.title=result.artist=result.album=result.duration=absent(start,MP_UNAVAILABLE);
    result.output.error=MP_UNAVAILABLE;
    result.output.interval=(MPInterval){start,start};
    result.error=api->select(api->context,result.instance);
    if (result.error!=MP_OK) goto done;
    if (!mp_instance_valid(result.instance) || !api->same(api->context)) { result.error=MP_UNAVAILABLE; goto done; }
    if (api->now(api->context)>=start+5000) { result.error=MP_EXPIRED; goto done; }
    result.error=api->permission(api->context,MP_READ);
    if (result.error!=MP_OK) goto done;
    if (!api->same(api->context)) { result.error=MP_UNAVAILABLE; goto done; }
    double track_deadline=start+4000;
    MPError fatal=MP_OK;
    result.state=query(api,MP_STATE,0,track_deadline,&fatal);
    MPField before=query(api,MP_ITEM_BEFORE,0,track_deadline,&fatal);
    result.position=query(api,MP_POSITION,0,track_deadline,&fatal);
    /* Optional display fields never use the reserved closing-identity second. */
    result.title=query(api,MP_TITLE,0,track_deadline-1000,&fatal);
    result.artist=query(api,MP_ARTIST,0,track_deadline-1000,&fatal);
    result.album=query(api,MP_ALBUM,0,track_deadline-1000,&fatal);
    result.duration=query(api,MP_DURATION,0,track_deadline-1000,&fatal);
    MPField after=query(api,MP_ITEM_AFTER,0,track_deadline,&fatal);
    result.item=absent(after.interval.end,MP_UNAVAILABLE);
    if (before.error==MP_OK && after.error==MP_OK && strcmp(before.value.text,after.value.text)==0) {
        result.item=before;
        result.item.interval.end=after.interval.end;
        result.item_associated=true;
        result.association=result.item.interval;
    }
    result.output.interval.start=api->now(api->context);
    double output_deadline=earlier(start+5000,result.output.interval.start+1000);
    MPField list=query(api,MP_OUTPUT_LIST,0,output_deadline,&fatal);
    result.output.selection_interval=list.interval;
    result.output.error=list.error;
    if (list.error==MP_OK && list.value.count>MP_MAX_OUTPUTS) result.output.error=MP_CAPACITY;
    if (result.output.error==MP_OK) {
        result.output.count=list.value.count;
        result.output.airplay_enabled=query(api,MP_AIRPLAY_ENABLED,0,output_deadline,&fatal);
        for (unsigned i=0;i<result.output.count;++i) {
            result.output.devices[i].name=query(api,MP_OUTPUT_NAME,i,output_deadline,&fatal);
            result.output.devices[i].kind=query(api,MP_OUTPUT_KIND,i,output_deadline,&fatal);
            result.output.devices[i].active=query(api,MP_OUTPUT_ACTIVE,i,output_deadline,&fatal);
            result.output.devices[i].available=query(api,MP_OUTPUT_AVAILABLE,i,output_deadline,&fatal);
            result.output.devices[i].selected=query(api,MP_OUTPUT_SELECTED,i,output_deadline,&fatal);
        }
    }
    result.output.interval.end=api->now(api->context);
    result.error=fatal;
done: {
        double end=api->now(api->context);
        if (!mp_time_valid(end) || end<start) result.error=MP_INVALID_MESSAGE;
        else result.interval.end=end;
    }
    return result;
}
MPCommand mp_command(const MPAPI *api,MPAction action,const char *expected_instance,double deadline) {
    double start=api->now(api->context);
    MPCommand result={.action=action,.status=MP_UNSENT,.error=MP_INVALID_REQUEST};
    if (!mp_time_valid(start)) { result.error=MP_INVALID_MESSAGE; return result; }
    result.interval=(MPInterval){start,start};
    if (!mp_instance_valid(expected_instance) || action<MP_PLAY || action>MP_PREVIOUS || !mp_time_valid(deadline)) return result;
    memcpy(result.expected_instance,expected_instance,65);
    deadline=earlier(deadline,start+3000);
    if (start>=deadline) { result.error=MP_EXPIRED; return result; }
    char observed[65]={0};
    result.error=api->select(api->context,observed);
    if (result.error!=MP_OK) goto done;
    if (strcmp(observed,expected_instance)!=0 || !api->same(api->context)) { result.error=MP_UNAVAILABLE; goto done; }
    if (api->now(api->context)>=deadline) { result.error=MP_EXPIRED; goto done; }
    result.error=api->permission(api->context,action);
    if (result.error!=MP_OK) goto done;
    if (!api->same(api->context)) { result.error=MP_UNAVAILABLE; goto done; }
    result.send.start=api->now(api->context);
    if (!mp_time_valid(result.send.start) || result.send.start<start) { result.error=MP_INVALID_MESSAGE; goto done; }
    if (result.send.start>=deadline) { result.error=MP_EXPIRED; goto done; }
    result.status=api->control(api->context,action,earlier(deadline,result.send.start+2000),&result.error,&result.send,&result.attempted);
    if ((!result.attempted && result.status!=MP_UNSENT) || (result.attempted &&
        (!mp_time_valid(result.send.start) || !mp_time_valid(result.send.end) || result.send.start<start ||
         result.send.start>=deadline || result.send.end<result.send.start || !api->same(api->context) ||
         (result.status!=MP_SENT && result.status!=MP_REFUSED && result.status!=MP_UNKNOWN)))) {
        result.status=MP_UNKNOWN; result.error=MP_UNCERTAIN;
    } else if (result.status==MP_SENT) result.error=MP_OK;
    else if (result.status==MP_UNKNOWN) result.error=MP_UNCERTAIN;
    /* A late explicit reply is evidence; expiry does not undo the completed send. */
done: {
        double end=api->now(api->context);
        if (mp_time_valid(end) && end>=start) result.interval.end=end;
    }
    return result;
}
