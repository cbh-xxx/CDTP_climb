import { useEffect, useRef, useState } from 'react';
import { levelSteps } from '../domain/route';
// Display-only session state; never participates in settlement or ownership.
let lastShown: number | undefined;
export function useSummitTransition(level: number) {
  const [display, setDisplay] = useState(lastShown ?? level);
  const [playing, setPlaying] = useState(false);
  const stop = useRef(() => {});
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const steps = levelSteps(lastShown ?? level, level);
    const finish = () => { clearTimeout(timer); setDisplay(level); setPlaying(false); lastShown = level; };
    stop.current = finish;
    let index = 0;
    const next = () => { setDisplay(steps[index++]!); if (index < steps.length) timer = setTimeout(next, 450); else timer = setTimeout(finish, 450); };
    const hidden = () => { if (document.hidden) finish(); };
    if (steps.length && !matchMedia('(prefers-reduced-motion: reduce)').matches && !document.hidden) { setPlaying(true); timer = setTimeout(next, 450); } else finish();
    document.addEventListener('visibilitychange', hidden);
    return () => { clearTimeout(timer); lastShown = level; document.removeEventListener('visibilitychange', hidden); };
  }, [level]);
  return { display, playing, skip: () => stop.current() };
}
