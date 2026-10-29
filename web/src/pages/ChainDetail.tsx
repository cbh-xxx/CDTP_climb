import { useRef, useState } from 'react';
import type { ChainState } from '../domain/models';
import { activeTask, chainDetail, managementError, nameError } from '../domain/chains';
import { Button, Icon, TextInput } from '../shared/controls';
import { ChainActions } from '../shared/ChainRow';
import { dateText } from '../shared/HistoryDialogs';

export function ChainDetail({ id, state, busy, back, rename, newRound, more, record, summaries, notify }: {
  id: string; state: ChainState; busy: boolean; back(): void; rename(name: string): Promise<boolean>;
  newRound(): void; more(anchor: HTMLButtonElement): void; record(id: string): void; summaries(): void; notify(message: string): void;
}) {
  const { chain, round, precedents, records, summaries: oldRounds } = chainDetail(state, id);
  const [tab, setTab] = useState<'records' | 'precedents'>('records');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(chain.name);
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const editPosition = useRef(0);
  const renameInvalid = nameError(draft, state.chains, id);
  function cancelEdit() {
    setEditing(false); setDraft(chain.name);
    requestAnimationFrame(() => { if (scroller.current) scroller.current.scrollTop = editPosition.current; });
  }
  async function saveRename() {
    if (renameInvalid) { notify(renameInvalid); return; }
    if (await rename(draft)) setEditing(false);
  }
  function selectTab(next: 'records' | 'precedents') {
    setTab(next);
    if (scroller.current && content.current) {
      const tabs = content.current.previousElementSibling as HTMLElement | null;
      const top = (tabs?.offsetTop ?? content.current.offsetTop) - scroller.current.offsetTop;
      scroller.current.scrollTop = Math.min(scroller.current.scrollTop, Math.max(0, top));
    }
  }
  const task = activeTask(state);
  const archived = chain.status === 'archived';
  return <main className="chain-page"><div className="landscape landscape--before" aria-hidden="true" /><section className="side-panel">
    <header className="panel-header"><Button variant="icon" aria-label="返回" onClick={back}><Icon name="left" /></Button><h1>链条详情</h1></header>
    <div ref={scroller} className="panel-scroll detail-scroll">
      {editing ? <div className="rename"><TextInput label="链名称" value={draft} onChange={setDraft} limit={15} onFeedback={notify} selectOnMount onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === 'Escape') { event.preventDefault(); cancelEdit(); }
        if (event.key === 'Enter') { event.preventDefault(); if (!busy) void saveRename(); }
      }} /><div className="actions"><Button disabled={busy} unavailableReason={renameInvalid || undefined} onFeedback={notify} onClick={() => void saveRename()}>保存</Button><Button variant="secondary" onClick={cancelEdit}>取消</Button></div></div>
        : <div className="detail-name"><h2 title={chain.name}>{chain.name}</h2><Button variant="icon" aria-label="重命名" unavailableReason={managementError(state, chain, 'rename') || undefined} onFeedback={notify} onClick={() => { editPosition.current = scroller.current?.scrollTop ?? 0; setDraft(chain.name); setEditing(true); }}><Icon name="edit" /></Button><Button variant="icon" aria-label={`管理${chain.name}`} onClick={event => more(event.currentTarget)}><Icon name="more" /></Button></div>}
      {archived && <p className="muted">已归档</p>}
      {chain.status === 'needs-round' ? <><p className="round-ended">上一轮已结束</p><div className="actions"><Button onClick={newRound}>设置新一轮</Button></div></>
        : <><dl className="chain-stats"><div><dt>本轮节点</dt><dd>{round.nodes}</dd></div><div><dt>余量</dt><dd>{round.remainderMinutes}分钟</dd></div><div><dt>成功专注</dt><dd>{round.successfulMinutes}分钟</dd></div></dl>
          <section className="round-action"><h3>本轮准备动作</h3><p>{round.action}</p></section>
          <div className="actions task-actions">{archived ? <><Button unavailableReason="请先恢复链条" onFeedback={notify}>开始</Button><Button variant="secondary" unavailableReason="请先恢复链条" onFeedback={notify}>预约</Button></>
            : <ChainActions chain={chain} state={state} notify={notify} newRound={newRound} />}</div>
          {task && task.chainId !== chain.id && <span className="sr-only">其他链存在未完成任务</span>}</>}
      <Button variant="link" className="previous-rounds" unavailableReason={!oldRounds.length ? '暂无往轮摘要' : undefined} onFeedback={notify} onClick={summaries}>往轮摘要</Button>
      {chain.status !== 'needs-round' && <><div className="tabs" role="tablist" aria-label="链条内容"><button role="tab" aria-selected={tab === 'records'} onClick={() => selectTab('records')}>本轮记录</button><button role="tab" aria-selected={tab === 'precedents'} onClick={() => selectTab('precedents')}>允许判例</button></div>
        <div ref={content} role="tabpanel" aria-label={tab === 'records' ? '本轮记录' : '允许判例'}>
          {tab === 'records' ? records.map(task => {
            const settlement = state.settlements.find(item => item.taskId === task.id);
            return <button className="record-row" key={task.id} onClick={() => record(task.id)}><span><span className="truncate" title={task.content}>{task.content}</span><span>{task.status === 'succeeded' ? '成功' : '允许取消'}</span></span><span className="muted">{dateText('endedAt' in task ? task.endedAt : null)}　{task.status === 'cancelled' ? '未开始' : settlement ? `专注${settlement.creditedMinutes}分钟` : '专注时长未记录'}</span></button>;
          }) : precedents.map(item => <p className="precedent-row" key={item.id}>{item.situation}</p>)}
        </div></>}
    </div>
  </section></main>;
}
