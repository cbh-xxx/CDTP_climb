import { useLayoutEffect, useRef, useState } from 'react';
import type { ChainState } from '../domain/models';
import { climbOverview, routePeaks } from '../domain/route';
import { Button, Dialog, Icon } from '../shared/controls';
import { mountainScene, peakImage } from '../shared/mountains';
import '../shared/climbing.css';

export function ClimbRoute({ state, back }: { state: ChainState; back(): void }) {
  const overview = climbOverview(state);
  const [focus, setFocus] = useState(Math.max(1, overview.level));
  const [selected, setSelected] = useState<number | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const savedScroll = useRef<number | null>(null);
  const peaks = [...routePeaks].reverse();
  useLayoutEffect(() => {
    const container = scroll.current!;
    const position = () => { container.scrollTop = (30 - Math.max(1, overview.level)) * 137; };
    position();
    return () => clearTimeout(pending.current);
  }, []);
  function closeDetails() {
    setSelected(null);
    requestAnimationFrame(() => {
      if (savedScroll.current !== null) scroll.current?.scrollTo({top:savedScroll.current,behavior:'instant'});
      requestAnimationFrame(() => {savedScroll.current=null;});
    });
  }
  const peak = routePeaks.find(item => item.level === selected);
  return <main className="chain-page"><div className="landscape mountain-landscape" style={{ backgroundImage: `url("${mountainScene(state).image}")` }} aria-hidden="true" />
    <section className="side-panel climb-panel"><header className="panel-header"><Button variant="icon" aria-label="返回首页" onClick={back}><Icon name="left" /></Button><h1>攀登详情</h1></header>
      <dl className="climb-records"><div><dt>历史最高山峰</dt><dd>{routePeaks[overview.highestLevel - 1]?.shortName ?? '尚未登顶'}</dd></div><div><dt>历史最高总节点</dt><dd>{overview.highestNodes}节点</dd></div></dl>
      <div className="route-scroll" ref={scroll} aria-label="完整攀登路线" onScroll={() => {
        if (savedScroll.current !== null) return;
        const container = scroll.current!;
        const index = Math.min(29, Math.max(0, Math.round(container.scrollTop / 137)));
        setFocus(30 - index); clearTimeout(pending.current);
        pending.current = setTimeout(() => { container.scrollTo({ top: index * 137, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); }, 160);
      }}><div className="route-padding" />{peaks.map(item => <div className="route-slot" key={item.level}><button className={`route-capsule ${Math.abs(item.level - focus) === 0 ? 'is-center' : Math.abs(item.level - focus) === 1 ? 'is-near' : ''} ${item.level > overview.level ? 'is-unreached' : ''}`} onFocus={() => { if (savedScroll.current===null&&document.activeElement?.matches(':focus-visible')) scroll.current?.scrollTo({ top: (30 - item.level) * 137 }); }} onClick={() => { clearTimeout(pending.current);savedScroll.current=scroll.current!.scrollTop;scroll.current!.scrollTo({top:savedScroll.current,behavior:'instant'});setSelected(item.level); }}>
        <span>{item.level}</span><span className="route-label">{item.shortName}<small>{item.threshold}节点</small></span><span className="peak-circle" style={{ backgroundImage: `url("${peakImage(item.level)}")` }} aria-hidden="true" /></button></div>)}<div className="route-padding" /></div>
    </section>
    {peak && <Dialog title="山峰详情" width={640} onClose={closeDetails}><div className="peak-image" style={{ backgroundImage: `url("${peakImage(peak.level)}")` }} role="img" aria-label={`${peak.shortName}山景`} /><h2>{peak.name}</h2><dl className="peak-copy"><dt>位置</dt><dd>{peak.location}</dd><dt>高度</dt><dd>{peak.height}</dd><dt>科普</dt><dd>{peak.facts.map((fact, i) => <p key={i}>{fact}</p>)}</dd></dl></Dialog>}
  </main>;
}

