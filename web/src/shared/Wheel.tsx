import { useEffect, useRef } from 'react';

export function Wheel({ label, values, value, onChange, large = false }: {
  label: string; values: readonly number[]; value: number | null; onChange(value: number): void; large?: boolean;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const latest = useRef({ values, value, onChange });
  latest.current = { values, value, onChange };
  const interacting = useRef(false);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const index = value === null ? 0 : Math.max(0, values.indexOf(value));
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = index * 40;
  }, [index]);
  useEffect(() => {
    const element = scroll.current!;
    let lastWheel = -Infinity;
    const wheel = (event: WheelEvent) => {
      event.preventDefault(); event.stopPropagation();
      if (!event.deltaY || event.timeStamp - lastWheel < 80) return;
      lastWheel = event.timeStamp;
      const current = latest.current;
      const oldIndex = current.value === null ? 0 : current.values.indexOf(current.value);
      const next = Math.max(0, Math.min(current.values.length - 1, oldIndex + Math.sign(event.deltaY)));
      interacting.current = false;
      current.onChange(current.values[next]!);
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => { element.removeEventListener('wheel', wheel); clearTimeout(settle.current); };
  }, []);
  return <div className={`wheel-shell ${large ? 'wheel-shell--large' : ''}`}>
    <div ref={scroll} className="wheel-scroll" role="spinbutton" tabIndex={0} aria-label={label}
      aria-valuemin={values[0]} aria-valuemax={values.at(-1)} aria-valuenow={value ?? undefined} aria-valuetext={value === null ? '未选择' : `${value}`}
      onPointerDown={() => { interacting.current = true; }}
      onScroll={() => {
        if (!interacting.current) return;
        clearTimeout(settle.current);
        settle.current = setTimeout(() => {
          if (!scroll.current) return;
          const position = Math.max(0, Math.min(values.length - 1, Math.round(scroll.current.scrollTop / 40)));
          interacting.current = false; onChange(values[position]!);
          scroll.current.scrollTop = position * 40;
        }, 120);
      }}
      onKeyDown={event => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation(); interacting.current = false;
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? values.length - 1 : Math.max(0, Math.min(values.length - 1, index + (event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0)));
        onChange(values[next]!);
      }}>
      {values.map((option, optionIndex) => <button tabIndex={-1} key={option} className={optionIndex === index ? 'wheel-option wheel-option--current' : 'wheel-option'} onClick={() => { interacting.current = false; onChange(option); }}>{String(option).padStart(2, '0')}</button>)}
    </div>
  </div>;
}
