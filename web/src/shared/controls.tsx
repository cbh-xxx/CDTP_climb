import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type KeyboardEventHandler, type ReactNode } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'link' | 'icon';
  unavailableReason?: string;
  onFeedback?: (message: string) => void;
}
export function Button({ variant = 'primary', unavailableReason, onFeedback, onClick, children, ...props }: ButtonProps) {
  return <button {...props} type={props.type ?? 'button'} className={`button button--${variant} ${props.className ?? ''}`}
    aria-disabled={unavailableReason ? true : props['aria-disabled']}
    onClick={event => {
      if (unavailableReason) { event.preventDefault(); onFeedback?.(unavailableReason); return; }
      onClick?.(event);
    }}>{children}</button>;
}
export function Icon({ name }: { name: 'plus' | 'right' | 'settings' | 'left' | 'more' | 'down' | 'edit' | 'home' }) {
  const size = name === 'edit' ? 26.6 : 24;
  return <img className={`icon ${name === 'edit' ? 'icon--edit' : ''}`} src={`/icons/${name}.svg`} alt="" width={size} height={size} />;
}
export function Dialog({ title, children, onClose, onEscape, actions, feedback, width = 512, className = '' }: {
  title: string; children: ReactNode; onClose(): void; onEscape?(): void; actions?: ReactNode; feedback?: string; width?: 512 | 560 | 640 | 672; className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = ref.current!;
    dialog.showModal();
    const testPanel = __TEST_BUILD__ ? document.querySelector<HTMLElement>('.test-tools') : null;
    const testParent = testPanel?.parentElement;
    if (testPanel) dialog.append(testPanel);
    return () => {
      if (testPanel?.parentElement === dialog) (testParent?.isConnected ? testParent : document.body).append(testPanel);
      dialog.close(); if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={ref} className={`dialog ${className}`} style={{ width }} aria-labelledby={titleId}
    onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), summary, a[href], [tabindex="0"]')];
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}
    onCancel={event => { event.preventDefault(); (onEscape ?? onClose)(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    }}>
    <header className="dialog__header"><h2 id={titleId}>{title}</h2>
      <Button variant="icon" aria-label="关闭" onClick={onClose}><svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg></Button>
    </header>
    <div className="dialog__body">{children}</div>
    {actions && <footer className="actions">{actions}</footer>}
    {feedback && <div role="status" className="feedback">{feedback}</div>}
  </dialog>;
}
const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' });
export function limitText(value: string, limit: number): string {
  return [...segmenter.segment(value.replace(/[\r\n]+/g, ' '))].slice(0, limit).map(part => part.segment).join('');
}
export function TextInput({ label, value, onChange, limit, onFeedback, selectOnMount, onKeyDown }: {
  label: string; value: string; onChange(value: string): void; limit: number; onFeedback(message: string): void;
  selectOnMount?: boolean; onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
}) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const composing = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (selectOnMount) { input.current?.focus({ preventScroll: true }); input.current?.select(); } }, [selectOnMount]);
  useEffect(() => { if (!composing.current) setDraft(value); }, [value]);
  function commit(raw: string) {
    const next = limitText(raw, limit);
    if (next !== raw.replace(/[\r\n]+/g, ' ')) onFeedback(`最多输入${limit}个字符`);
    setDraft(next); onChange(next);
  }
  return <div className="field"><label htmlFor={id}>{label}</label>
    <input ref={input} id={id} value={draft} onKeyDown={onKeyDown} onPaste={event => {
      event.preventDefault();
      const element = event.currentTarget;
      const start = element.selectionStart ?? draft.length;
      const end = element.selectionEnd ?? start;
      const pasted = event.clipboardData.getData('text').replace(/[\r\n]+/g, ' ');
      commit(draft.slice(0, start) + pasted + draft.slice(end));
    }} onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={event => { composing.current = false; commit(event.currentTarget.value); }}
      onChange={event => { setDraft(event.target.value); if (!composing.current) commit(event.target.value); }} />
  </div>;
}
export function SoundSwitch({ checked, busy, onChange }: { checked: boolean; busy: boolean; onChange(): void }) {
  return <button type="button" role="switch" aria-label="提示声音" aria-checked={checked}
    aria-busy={busy} disabled={busy} className={`switch ${checked ? 'switch--on' : ''}`} onClick={onChange}><span /></button>;
}
