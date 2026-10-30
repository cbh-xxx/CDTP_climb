import { useLayoutEffect, useRef } from 'react';
import type { ChainState } from '../domain/models';
import { archivedChains, sortChains } from '../domain/chains';
import { Button, Icon } from '../shared/controls';
import { ChainRow } from '../shared/ChainRow';

export interface ListVisit { scroll: number; expanded: boolean }
export function ChainList({ state, visit, back, create, open, newRound, more, notify, saveVisit }: {
  state: ChainState; visit: ListVisit; back(): void; create(): void; open(id: string): void;
  newRound(id: string): void; more(id: string, anchor: HTMLButtonElement): void; notify(message: string): void; saveVisit(visit: ListVisit): void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (scroll.current) scroll.current.scrollTop = visit.scroll; }, [visit.scroll]);
  return <main className="chain-page"><div className="landscape landscape--before" aria-hidden="true" /><section className="side-panel">
    <header className="panel-header"><Button variant="icon" aria-label="返回首页" onClick={back}><Icon name="left" /></Button><h1>全部链条</h1></header>
    <div ref={scroll} className="panel-scroll" onScroll={event => saveVisit({ ...visit, scroll: event.currentTarget.scrollTop })}>
      {sortChains(state.chains.filter(chain => chain.status !== 'archived')).map(chain => <ChainRow key={`active-${chain.id}`} chain={chain} state={state} open={() => open(chain.id)} notify={notify} newRound={() => newRound(chain.id)} more={anchor => more(chain.id, anchor)} />)}
      <Button variant="secondary" className="list-create" aria-label="新建链条" onClick={create}><Icon name="plus" /></Button>
      <Button variant="link" className={`archive-toggle ${visit.expanded ? 'archive-toggle--open' : ''}`} aria-expanded={visit.expanded} onClick={() => saveVisit({ ...visit, expanded: !visit.expanded })}>已归档<Icon name="down" /></Button>
      {visit.expanded && (archivedChains(state).length ? archivedChains(state).map(chain => <ChainRow key={`archived-${chain.id}`} chain={chain} state={state} open={() => open(chain.id)} notify={notify} newRound={() => newRound(chain.id)} more={anchor => more(chain.id, anchor)} />) : <p className="archive-empty">暂无归档链条</p>)}
    </div>
  </section></main>;
}
