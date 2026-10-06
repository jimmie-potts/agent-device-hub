// Temporary negative control for #765; removed in the next commit.
import {useEffect, useState} from 'react';
export function Probe({on, value}: {on: boolean; value: string}) {
  if (on) { const [x] = useState(0); void x; }
  useEffect(() => { console.log(value); }, []);
  return null;
}
