import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Chain, ChainState } from '../domain/models';
import { managementError } from '../domain/chains';
import { Button } from './controls';

export function ChainMenu({ anchor, chain, state, onClose, onAction, notify }: {
  anchor: HTMLButtonElement; chain: Chain; state: ChainState; onClose(): void;
  onAction(action: 'archive' | 'restore' | 'delete'): void; notify(message: string): void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  useLayoutEffect(() => {
    const rect = anchor.getBoundingClientRect();
    const height = menu.current?.offsetHeight ?? 112;
    setPosition({ left: Math.max(16, Math.min(innerWidth - 248, rect.right - 232)), top: rect.bottom + height + 8 <= innerHeight ? rect.bottom + 4 : Math.max(16, rect.top - height - 4) });
    menu.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }, [anchor]);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node) && !anchor.contains(event.target as Node)) onClose(); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', key);
    window.addEventListener('resize', onClose); window.addEventListener('scroll', onClose, true);
    return () => {
      document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', key);
      window.removeEventListener('resize', onClose); window.removeEventListener('scroll', onClose, true);
      if (anchor.isConnected) anchor.focus({ preventScroll: true });
    };
  }, [anchor, onClose]);
  const first = chain.status === 'archived' ? 'restore' : 'archive';
  return <div ref={menu} role="menu" aria-label="链条操作" className="chain-menu" style={position} onKeyDown={event => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const buttons = [...event.currentTarget.querySelectorAll('button')];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }}>
    <Button role="menuitem" variant="link" unavailableReason={managementError(state, chain, first) || undefined} onFeedback={notify} onClick={() => onAction(first)}>{first === 'restore' ? '恢复' : '归档'}</Button>
    <Button role="menuitem" variant="link" className="danger-text" unavailableReason={managementError(state, chain, 'delete') || undefined} onFeedback={notify} onClick={() => onAction('delete')}>删除</Button>
  </div>;
}
