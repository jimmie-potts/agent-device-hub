const invalid=()=>{throw new Error('Collector control invalid');};
// Fixed program for the pinned image. No arbitrary shell command, path or signal
// comes from a caller. The private container PID namespace bounds PID reuse risk;
// executable and start-time checks further restrict effects to its Collector.
const program=String.raw`
export LC_ALL=C
find_collector() {
  found=0
  for directory in /proc/[0-9]*; do
    executable=$(readlink "$directory/exe" 2>/dev/null) || continue
    [ "$executable" = /otel-lgtm/otelcol-contrib/otelcol-contrib ] || continue
    [ "$found" = 0 ] || exit 20
    found=1; pid=${'$'}{directory#/proc/}
  done
}
read_identity() {
  [ "$(readlink "/proc/$pid/exe")" = /otel-lgtm/otelcol-contrib/otelcol-contrib ] || exit 21
  IFS= read -r status < "/proc/$pid/stat"
  fields=${'$'}{status##*) }; set -- $fields
  state=$1; shift 19; ticks=$1
  case "$state" in R|S|D|T|t|I) ;; *) exit 22;; esac
}
action=$1; expected_pid=$2; expected_ticks=$3
find_collector
if [ "$found" = 0 ]; then
  [ "$action" = inspect ] || exit 23
  printf 'absent\n'; exit 0
fi
read_identity
if [ "$action" != inspect ]; then
  [ "$pid" = "$expected_pid" ] && [ "$ticks" = "$expected_ticks" ] || exit 24
  case "$action" in
    pause) case "$state" in T|t) exit 25;; esac; kill -STOP "$pid";;
    resume) case "$state" in T|t) ;; *) exit 25;; esac; kill -CONT "$pid";;
    terminate) case "$state" in T|t) exit 25;; esac; kill -TERM "$pid";;
    *) exit 26;;
  esac
  printf 'signalled\n'
else
  printf '%s %s %s\n' "$pid" "$ticks" "$state"
fi
`;
export function collectorCommand(action,identity) {
  if(!['inspect','pause','resume','terminate'].includes(action))invalid();
  if(action==='inspect') {if(identity!==undefined)invalid();}
  else if(!identity || Object.keys(identity).sort().join(',')!=='pid,startTicks' ||
    !Number.isSafeInteger(identity.pid) || identity.pid<=1 || identity.pid>2147483647 ||
    typeof identity.startTicks!=='string' || !/^[1-9][0-9]{0,19}$/.test(identity.startTicks))invalid();
  return ['/usr/bin/timeout','--signal=KILL','2s','/bin/bash','-euc',program,
    'bunny-collector-control',action,String(identity?.pid??0),identity?.startTicks??'0'];
}
export function readCollectorState(stdout) {
  if(stdout==='absent\n')return {present:false};
  const match=typeof stdout==='string' && /^([1-9][0-9]{0,9}) ([1-9][0-9]{0,19}) ([RSDTtI])\n$/.exec(stdout);
  if(!match || Number(match[1])<=1 || Number(match[1])>2147483647)invalid();
  return {present:true,pid:Number(match[1]),startTicks:match[2],state:match[3]};
}
