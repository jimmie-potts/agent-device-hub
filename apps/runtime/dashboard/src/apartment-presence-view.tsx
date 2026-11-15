import React from 'react';
import type {ApartmentPresence} from './apartment-presence.ts';
import {presenceReceipt} from './apartment-presence.ts';

/** A text alternative to the schematic overlay; observations expose no control or identity action. */
export function ApartmentPresenceView({presence,roomName,room}:{presence:ApartmentPresence;roomName:(id:string)=>string;room:string|null}):React.JSX.Element {
  const rooms=[...presence.rooms].filter(([id])=>room===null||id===room);
  return <section className="apartment-presence" aria-label="Reported anonymous presence">
    <h4>Reported presence</h4>
    <p className="apartment-presence-note">Device-reported occupancy and approximate anonymous positions. Reports may be cached; receipt time is not measurement time. Markers show sensor·slot numbers and do not measure height.</p>
    {presence.sensors.length===0?<p>No presence sensors configured or reports available.</p>:<>
      {!presence.synced&&<p role="status">Presence reports are last-known. Current occupancy and positions are unknown until live reports return.</p>}
      <ul className="apartment-presence-rooms">{rooms.map(([id,status])=><li key={id} data-presence-room={id} data-occupancy={status.value}>
        <strong>{roomName(id)} · {status.value}</strong>{status.disagreement&&<span> · Sources disagree</span>}
        {status.contributors.length===0?<p>No reports mapped to this room.</p>:<ul>{status.contributors.map(item=><li key={JSON.stringify([item.sensorId,item.channel])}>
          {item.sensorId} · {item.channel}: {presence.synced?item.reported:`Last-known ${item.reported}; current unknown`} · last report received {presenceReceipt(item.receivedAtMs)}
        </li>)}</ul>}
      </li>)}</ul>
      <div className="apartment-presence-sensors">{presence.sensors.map(({record,current,slots},index)=><details key={record.sensorId} data-presence-sensor={record.sensorId}>
        <summary>Sensor {index+1} ({record.sensorId}) · {presence.synced?record.connection:`Last-known connection: ${record.connection}`} · {!presence.synced&&'Last-known '}{record.held.value.status==='known'?record.held.value.value?'held':'hold off':'hold unknown'}</summary>
        <p>{presence.synced?'Source status: ':'Last-known source status: '}{record.reason==='none'?'connected':record.reason}. Assignment: {roomName(record.roomId)}. {!presence.synced&&'Last-known hold. '}Hold last report received {presenceReceipt(record.held.receivedAtMs)}.</p>
        {slots.length===0?<p>No position slots configured.</p>:<ul>{slots.map(({target,point,reason})=><li key={target.slot} data-presence-slot={target.slot}>
          <strong>Slot {target.slot}{point===undefined?'':` · marker ${point.label}`}</strong>{' · '}
          {target.apartmentMeters.status==='known'?`${current?'Approximate device-reported position':'Last-known approximate position'} X ${target.apartmentMeters.value.x.toFixed(2)} m, Z ${target.apartmentMeters.value.z.toFixed(2)} m. `:''}
          {point===undefined?reason:'Height unknown.'}{' '}
          Active last report received {presenceReceipt(target.active.receivedAtMs)}; X {presenceReceipt(target.rawMm.xReceivedAtMs)}; Y {presenceReceipt(target.rawMm.yReceivedAtMs)}.
        </li>)}</ul>}
      </details>)}</div>
    </>}
  </section>;
}
