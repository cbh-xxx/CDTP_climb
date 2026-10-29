import { useRef, useState } from 'react';
import type { ChainState, Task } from '../domain/models';
import { decisionError, effectivePrecedents, type DecisionInput } from '../domain/task-rules';
import { Button, Dialog, TextInput } from './controls';

export function DecisionDialog({ task, state, busy, feedback, close, notify, confirm }: {
  task: Task; state: ChainState; busy: boolean; feedback: string; close(): void; notify(message: string): void; confirm(input: DecisionInput): void;
}) {
  const precedents = effectivePrecedents(state, task.roundId);
  const [outcome, setOutcome] = useState<'allowed' | 'violation' | null>(null);
  const [source, setSource] = useState<'existing' | 'new'>(precedents.length ? 'existing' : 'new');
  const [selected, setSelected] = useState('');
  const [situation, setSituation] = useState('');
  const [reason, setReason] = useState('');
  const newId = useRef(crypto.randomUUID());
  const input: DecisionInput = outcome === 'violation' ? { outcome, reason } : source === 'existing' ? { outcome: 'allowed', source, precedentId: selected } : { outcome: 'allowed', source, situation, precedentId: newId.current };
  const invalid = outcome === null ? '请选择判定结果' : decisionError(state, task, input);
  const cancel = task.status === 'cancel-pending';
  const consequence = outcome === null ? '请选择判定结果。' : outcome === 'violation' ? '确认违规后，本轮积累归零。' : cancel ? '确认允许后结束预约，本次不累计。' : '确认允许后保持暂停，请另点继续专注。';
  function chooseOutcome(next: 'allowed' | 'violation') {
    if (outcome === next) return;
    setOutcome(next); setSelected(''); setSituation(''); setReason(''); setSource(precedents.length ? 'existing' : 'new');
  }
  function chooseSource(next: 'existing' | 'new') {
    if (source === next) return;
    setSource(next); setSelected(''); setSituation('');
  }
  return <Dialog title={cancel ? '取消预约判定' : '中断判定'} width={640} className="dialog--decision" feedback={feedback} onClose={close}
    actions={<div className="decision-footer"><p>{consequence}</p><Button disabled={busy} unavailableReason={invalid || undefined} onFeedback={notify} onClick={() => confirm(input)}>确认判定</Button></div>}>
    <div className="decision-options" role="group" aria-label="判定结果"><Button variant={outcome === 'allowed' ? 'primary' : 'secondary'} aria-pressed={outcome === 'allowed'} onClick={() => chooseOutcome('allowed')}>允许</Button><Button variant={outcome === 'violation' ? 'primary' : 'secondary'} aria-pressed={outcome === 'violation'} onClick={() => chooseOutcome('violation')}>违规</Button></div>
    {outcome === 'allowed' && <>{precedents.length > 0 && <div className="decision-options" role="group" aria-label="判例来源"><Button variant={source === 'existing' ? 'primary' : 'secondary'} aria-pressed={source === 'existing'} onClick={() => chooseSource('existing')}>已有判例</Button><Button variant={source === 'new' ? 'primary' : 'secondary'} aria-pressed={source === 'new'} onClick={() => chooseSource('new')}>新情境</Button></div>}
      {source === 'existing' ? <div>{precedents.map(item => <label className="choice" key={item.id}><input type="radio" name="allowed-precedent" checked={selected === item.id} onChange={() => setSelected(item.id)} /><span>{item.situation}</span></label>)}</div>
        : <TextInput label="新的允许情境" value={situation} onChange={setSituation} limit={15} onFeedback={notify} />}</>}
    {outcome === 'violation' && <TextInput label="违规原因（选填）" value={reason} onChange={setReason} limit={15} onFeedback={notify} />}
  </Dialog>;
}
