import { useState } from 'react';
import { Button, Icon } from '../shared/controls';
import type { ChainState } from '../domain/models';
import { activeTask, recentChains, totalNodes } from '../domain/chains';
import { ChainRow } from '../shared/ChainRow';
import { taskDisplayStatus } from '../domain/time';
import { useClock } from '../app/ClockContext';
import { useTaskActions } from '../app/TaskActionsContext';
import { mountainScene, sceneForLevel } from '../shared/mountains';
import { taskProgress } from '../domain/task-rules';
import { routePeaks } from '../domain/route';
import { useSummitTransition } from '../shared/useSummitTransition';

export function Home({ navigate, openSettings, openCreate, state, openChain, notify }: {
  navigate(page: string): void; openSettings(): void; openCreate(): void;
  state: ChainState; openChain(id: string): void; notify(message: string): void;
}) {
  const clock = useClock();
  const actions = useTaskActions();
  const scene = mountainScene(state);
  const transition = useSummitTransition(scene.level);
  const peak = routePeaks[transition.display - 1];
  const [fact] = useState(() => Math.random());
  const facts = peak?.facts.filter(text => Array.from(text).length <= 40) ?? [];
  const text = transition.display === 0 ? '先完成一次专注，开始你的攀登。' : transition.display === 30 ? '已抵达路线终点，继续积累每一次专注。' : facts[Math.floor(fact * facts.length)] ?? '继续积累每一次专注。';
  const recent = recentChains(state);
  const task = activeTask(state);
  return <main className="home">
    <div className="landscape mountain-landscape" style={{ backgroundImage: `url("${sceneForLevel(transition.display).image}")` }} aria-hidden="true" /><div className="landscape panel-mist" aria-hidden="true" />
    <header className="home__header"><span className="brand">Climb</span>
      <Button variant="icon" aria-label="设置" onClick={openSettings}><Icon name="settings" /></Button></header>
    <section className="overview" aria-labelledby="summit-title">
      <h1 id="summit-title">{peak?.shortName ?? '尚未登顶'}</h1>
      {!transition.playing && peak && transition.display < 30 && <p className="muted">{peak.level === 1 ? '土卫六，赤道附近' : peak.location}</p>}
      <p>{text}</p>
      {transition.playing && <Button variant="link" onClick={transition.skip}>跳过动画</Button>}
      <p>当前总节点：{totalNodes(state)}</p>
      <Button variant="link" onClick={() => navigate('p07')}>攀登详情<Icon name="right" /></Button>
    </section>
    <section className="recent" aria-labelledby="recent-title">
      <header><h2 id="recent-title">最近链条</h2><Button variant="link" onClick={() => navigate('p02')}>全部链条</Button></header>
      {recent.map(chain => <ChainRow key={chain.id} chain={chain} state={state} compact open={() => openChain(chain.id)} notify={notify} newRound={() => undefined} />)}
      {recent.length < 3 && <Button variant="secondary" className="create-chain" aria-label="新建链条" onClick={openCreate}><Icon name="plus" /></Button>}
      {task && <Button className="current-task" aria-label="返回当前任务" onClick={actions.returnTask}>{taskDisplayStatus(task, clock)}<span>{taskProgress(task, clock).percent}%</span></Button>}
    </section>
  </main>;
}
