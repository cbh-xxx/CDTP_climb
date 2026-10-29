import { useRef, useState } from 'react';
import type { ChainState } from '../domain/models';
import type { TaskCommand } from '../domain/task-commands';
import { chainDetail } from '../domain/chains';
import { preparationError, RESERVATION_MINUTES, taskContentCandidates } from '../domain/task-rules';
import { Button, Dialog, Icon, TextInput } from '../shared/controls';
import { Wheel } from '../shared/Wheel';
import { mountainScene } from '../shared/mountains';

const hours = Array.from({ length: 24 }, (_, index) => index);
const minutes = Array.from({ length: 12 }, (_, index) => index * 5);
export function TaskPrepare({ state, chainId, initiallyReserved, busy, back, notify, submit, feedback }: {
  state: ChainState; chainId: string; initiallyReserved: boolean; busy: boolean; back(): void; notify(message: string): void;
  submit(command: Extract<TaskCommand, { type: 'start' }>): void; feedback: string;
}) {
  const { chain, round } = chainDetail(state, chainId);
  const [content, setContent] = useState('');
  const [hour, setHour] = useState<number | null>(null);
  const [minute, setMinute] = useState<number | null>(null);
  const [reserved, setReserved] = useState(initiallyReserved);
  const [reservation, setReservation] = useState<number | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const taskId = useRef(crypto.randomUUID());
  const planned = hour === null && minute === null ? null : (hour ?? 0) * 60 + (minute ?? 0);
  const invalid = preparationError(content, planned, reservation, reserved);
  const candidates = taskContentCandidates(state, chainId);
  return <main className="chain-page task-prepare"><div className="landscape mountain-landscape" style={{ backgroundImage: `url("${mountainScene(state).image}")` }} aria-hidden="true" /><div className="landscape panel-mist" aria-hidden="true" />
    <section className="side-panel"><header className="panel-header"><Button variant="icon" aria-label="返回" onClick={back}><Icon name="left" /></Button><h1>任务准备</h1></header>
      <div className="panel-scroll prepare-scroll"><h2 className="prepare-chain-name">{chain.name}</h2><p className="muted">本轮准备动作：{round.action}</p>
        <div className="prepare-content"><Button variant="link" className="reuse-button" unavailableReason={!candidates.length ? '暂无可复用的任务内容' : undefined} onFeedback={notify} onClick={() => setHistoryOpen(true)}>复用</Button><TextInput label="任务内容" value={content} onChange={setContent} limit={15} onFeedback={notify} /></div>
        <fieldset className="duration-field"><legend>专注时长（小时／分钟）</legend><div className="wheel-group"><Wheel label="专注小时" values={hours} value={hour} onChange={setHour} /><Wheel label="专注分钟" values={minutes} value={minute} onChange={setMinute} /></div></fieldset>
        <label className="choice"><input type="checkbox" checked={reserved} onChange={event => { setReserved(event.target.checked); setReservation(null); }} /><span>预约开始</span></label>
        {reserved && <fieldset className="duration-field"><legend>预约时长（分钟）</legend><div className="wheel-group"><Wheel label="预约分钟" values={[0, ...RESERVATION_MINUTES]} value={reservation} onChange={setReservation} large /></div></fieldset>}
      </div>
      <footer className="prepare-footer"><p>{reserved ? '请在预约到期时完成准备动作。' : '完成准备动作后，点击开始专注。'}</p><Button disabled={busy} unavailableReason={invalid || undefined} onFeedback={notify} onClick={() => {
        if (invalid || planned === null) { notify(invalid); return; }
        submit({ type: 'start', taskId: taskId.current, chainId, expectedRoundId: round.id, content, plannedMinutes: planned, reservationMinutes: reserved ? reservation : null });
      }}>{busy ? '保存中…' : reserved ? '确认预约' : '开始专注'}</Button></footer>
    </section>
    {historyOpen && <Dialog title="复用任务内容" width={640} feedback={feedback} onClose={() => setHistoryOpen(false)}><div className="content-candidates">{candidates.map(item => <button key={item.id} onClick={() => { setContent(item.content); setHistoryOpen(false); }}>{item.content}</button>)}</div></Dialog>}
  </main>;
}
