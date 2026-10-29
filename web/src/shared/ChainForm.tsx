import { useId, useRef, useState } from 'react';
import type { ChainState } from '../domain/models';
import type { ChainCommand } from '../domain/chain-commands';
import { ACTION_PRESETS, actionError, chainDetail, nameError, normalizeText } from '../domain/chains';
import { Button, Dialog, TextInput } from './controls';

export function ChainForm({ state, chainId, busy, feedback, notify, close, save }: {
  state: ChainState; chainId?: string; busy: boolean; feedback: string;
  notify(message: string): void; close(): void; save(command: ChainCommand): void;
}) {
  const detail = chainId ? chainDetail(state, chainId) : null;
  const previousAction = detail?.round.action ?? '';
  const [name, setName] = useState('');
  const [choice, setChoice] = useState(() => previousAction ? (ACTION_PRESETS.some(action => action === previousAction) ? previousAction : 'custom') : '');
  const [custom, setCustom] = useState(choice === 'custom' ? previousAction : '');
  const [inherited, setInherited] = useState<string[]>([]);
  const ids = useRef({ chain: crypto.randomUUID(), round: crypto.randomUUID() });
  const formId = useId();
  const action = choice === 'custom' ? normalizeText(custom) : choice;
  const invalid = (!detail ? nameError(name, state.chains) : '') || (!choice ? '请选择现实动作' : choice === 'custom' && !action ? '请输入自定义动作' : actionError(action));
  function submit() {
    if (busy) return;
    if (invalid) { notify(invalid); return; }
    save(detail ? { type: 'new-round', chainId: detail.chain.id, expectedRoundId: detail.round.id, roundId: ids.current.round, action, inheritedIds: inherited }
      : { type: 'create', chainId: ids.current.chain, roundId: ids.current.round, name, action });
  }
  return <Dialog title={detail ? '设置新一轮' : '创建链条'} width={detail ? 640 : 512} onClose={close} feedback={feedback}
    actions={<><Button variant="secondary" onClick={close}>取消</Button><Button type="submit" form={formId} disabled={busy} unavailableReason={invalid || undefined} onFeedback={notify}>{busy ? '保存中…' : detail ? '保存' : '创建'}</Button></>}>
    <form id={formId} className="chain-form" onSubmit={event => { event.preventDefault(); submit(); }}>
      {detail ? <h3>{detail.chain.name}</h3> : <TextInput label="链名称" value={name} onChange={setName} limit={15} onFeedback={notify} />}
      <fieldset><legend>现实动作</legend>
        {[...ACTION_PRESETS, 'custom'].map(item => <label className="choice" key={item}><input type="radio" name={`${formId}-action`} checked={choice === item} onChange={() => setChoice(item)} /><span>{item === 'custom' ? '自定义' : item}</span></label>)}
        {choice === 'custom' && <TextInput label="自定义动作" value={custom} onChange={setCustom} limit={10} onFeedback={notify} />}
      </fieldset>
      {detail && <fieldset className="inheritance"><legend>继承允许判例</legend>
        {detail.candidates.map(item => <label className="choice" key={item.id}><input type="checkbox" checked={inherited.includes(item.id)} onChange={event => setInherited(old => event.target.checked ? [...old, item.id] : old.filter(id => id !== item.id))} /><span>{normalizeText(item.situation)}</span></label>)}
      </fieldset>}
    </form>
  </Dialog>;
}
