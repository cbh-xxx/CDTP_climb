import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Repository, HomeSnapshot } from '../data/repository';
import type { ChainState } from '../domain/models';
import type { ChainCommand } from '../domain/chain-commands';
import { chainDetail } from '../domain/chains';
import { Home } from '../pages/Home';
import { ClimbRoute } from '../pages/ClimbRoute';
import { Rules } from '../shared/Rules';
import { Placeholder } from '../pages/Placeholder';
import { ChainList, type ListVisit } from '../pages/ChainList';
import { ChainDetail } from '../pages/ChainDetail';
import { Button, Dialog, SoundSwitch } from '../shared/controls';
import { SiteFooter } from '../shared/SiteFooter';
import { ChainForm } from '../shared/ChainForm';
import { ChainMenu } from '../shared/ChainMenu';
import { RecordDialog, RoundSummaryDialog } from '../shared/HistoryDialogs';
import { ClockContext } from './ClockContext';
import { systemClock, type Clock } from '../domain/time';
import { activeTask, unfinished } from '../domain/chains';
import { TaskActionsContext } from './TaskActionsContext';
import { useTaskRuntime } from './useTaskRuntime';
import { playShortTone, unlockSound } from './sound';
import type { TaskCommand, TaskOutcome } from '../domain/task-commands';
import type { DecisionInput } from '../domain/task-rules';
import { TaskPrepare } from '../pages/TaskPrepare';
import { TaskExecution } from '../pages/TaskExecution';
import { TaskResult } from '../pages/TaskResult';
import { DecisionDialog } from '../shared/DecisionDialog';
import { AccountDialog } from '../shared/AccountDialog';

type SourceRoute = { page: 'home' } | { page: 'list' } | { page: 'detail'; id: string; from: 'home' | 'list' };
type Route = SourceRoute | { page: 'climb' } | { page: 'placeholder'; id: string } | { page: 'prepare'; id: string; reserved: boolean; source: SourceRoute } | { page: 'execute'; taskId: string } | { page: 'result'; settlementId: string };
type Modal = { kind: 'settings' } | { kind: 'create'; from: 'home' | 'list' } | { kind: 'new-round'; id: string; from: 'home' | 'list' | 'result' }
  | { kind: 'rules' } | { kind: 'account' } | { kind: 'decision'; taskId: string }
  | { kind: 'delete'; id: string } | { kind: 'record'; taskId: string } | { kind: 'summaries'; id: string };
const errorText = (cause: unknown) => cause instanceof Error && /[\u4e00-\u9fff]/.test(cause.message) ? cause.message : '本地数据操作失败，请重试；未确认保存成功';

export function App({ repository, clock = systemClock }: { repository: Repository; clock?: Clock }) {
  const [initial, setInitial] = useState<{ home: HomeSnapshot; chains: ChainState }>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const initialize = useCallback(async () => {
    setLoading(true); setError('');
    try {
      repository.close(); await repository.initialize();
      await repository.recoverTasks();
      const [home, chains] = await Promise.all([repository.readHome(), repository.readChainState()]);
      setInitial({ home, chains });
    } catch (cause) { setError(errorText(cause)); }
    finally { setLoading(false); }
  }, [repository]);
  useEffect(() => { void initialize(); return () => repository.close(); }, [initialize, repository]);
  if (loading) return <main className="startup" aria-busy="true">正在读取本地数据…</main>;
  if (error || !initial) return <main className="startup"><h1>本地存储暂不可用</h1><p role="alert">{error}</p><Button onClick={() => void initialize()}>重试</Button></main>;
  return <ClockContext.Provider value={clock}><ChainApplication repository={repository} initial={initial} /></ClockContext.Provider>;
}

function ChainApplication({ repository, initial }: { repository: Repository; initial: { home: HomeSnapshot; chains: ChainState } }) {
  const [state, setState] = useState(initial.chains);
  const [accountStatus, setAccountStatus] = useState(repository.account?.status());
  const accountVersions = useRef({ data: accountStatus?.dataVersion, identity: accountStatus?.identityVersion });
  const [home, setHome] = useState(initial.home);
  const [route, setRoute] = useState<Route>({ page: 'home' });
  useLayoutEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); }, [route]);
  const [modal, setModal] = useState<Modal | null>(null);
  const [menu, setMenu] = useState<{ id: string; anchor: HTMLButtonElement } | null>(null);
  const [visit, setVisit] = useState<ListVisit>({ scroll: 0, expanded: false });
  const [busy, setBusy] = useState(false);
  const committing = useRef(false);
  const [savingSound, setSavingSound] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [notice, setNotice] = useState('');
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const resultPermit = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const clearFeedback = useCallback(() => { clearTimeout(timer.current); setFeedback(''); }, []);
  const notify = useCallback((message: string) => {
    clearTimeout(timer.current); setFeedback(message);
    timer.current = setTimeout(() => setFeedback(''), 1500);
  }, []);
  function closeTaskDialog() {
    setModal(null); clearFeedback();
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.execution-actions button:not(:disabled)')?.focus({ preventScroll: true }));
  }
  function closeModal() {
    if (repository.account?.status().busy) return;
    if (modal?.kind === 'decision') {
      if (runtime.busy) return;
      const task = state.tasks.find(item => item.id === modal.taskId);
      if (task?.pendingDecisionId) {
        void runtime.execute({ type: 'close-decision', taskId: task.id, decisionId: task.pendingDecisionId }).then(outcome => {
          if (outcome) closeTaskDialog();
        });
        return;
      }
    }
    if (modal?.kind === 'new-round' && modal.from === 'result') { navigate({ page: 'home' }); return; }
    setModal(null); setSaveError(''); clearFeedback();
  }
  const closeMenu = useCallback(() => { setMenu(null); clearFeedback(); }, [clearFeedback]);
  function openModal(next: Modal) { setMenu(null); clearFeedback(); setSaveError(''); setModal(next); }
  function navigate(next: Route, message?: string) {
    clearFeedback(); setModal(null); setMenu(null); setSaveError('');
    if (next.page === 'home') setVisit({ scroll: 0, expanded: false });
    if (next.page !== 'result') resultPermit.current = null;
    if (next.page === 'result') { setNotice(''); clearTimeout(noticeTimer.current); }
    setRoute(next);
    const hash = next.page === 'home' ? 'p01' : next.page === 'list' ? 'p02' : next.page === 'detail' ? `p03/${next.id}` : next.page === 'prepare' ? `p04/${next.id}` : next.page === 'execute' ? 'p05' : next.page === 'result' ? 'p06' : next.page === 'climb' ? 'p07' : next.id;
    const replace = next.page === 'result' || (next.page === 'execute' && route.page === 'prepare');
    history[replace ? 'replaceState' : 'pushState'](next, '', `#/${hash}`);
    if (message) notify(message);
  }
  useEffect(() => {
    if (!repository.account) return;
    return repository.account.subscribe(() => {
      const current = repository.account!.status(); setAccountStatus(current);
      if (current.dataVersion === accountVersions.current.data) return;
      const identityChanged = current.identityVersion !== accountVersions.current.identity;
      accountVersions.current = { data: current.dataVersion, identity: current.identityVersion };
      void Promise.all([repository.readChainState(), repository.readHome()]).then(([snapshot, summary]) => {
        if (repository.account?.status().dataVersion !== current.dataVersion) return;
        setState(snapshot); setHome(summary);
        if (identityChanged) {
          setRoute({ page: 'home' }); setModal(null); setMenu(null); setVisit({ scroll: 0, expanded: false });
          setNotice(''); clearTimeout(noticeTimer.current); clearFeedback(); resultPermit.current = null;
          history.replaceState({ page: 'home' }, '', '#/p01');
        }
      }).catch(cause => notify(errorText(cause)));
    });
  }, [repository, clearFeedback, notify]);
  useEffect(() => {
    const previousScrollRestoration = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    history.replaceState({ page: 'home' }, '', `${location.pathname}${location.search}#/p01`);
    const pop = (event: PopStateEvent) => {
      let next: Route = event.state ?? { page: 'home' };
      if (next.page === 'result' && next.settlementId !== resultPermit.current) next = { page: 'home' };
      if (next.page !== 'result') resultPermit.current = null;
      setRoute(next); setModal(null); setMenu(null); clearFeedback();
      if (!event.state || event.state.page === 'home') setVisit({ scroll: 0, expanded: false });
    };
    const fixtures = () => { void repository.readChainState().then(setState).catch(cause => notify(errorText(cause))); };
    const restoredPage = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      const revalidate = repository.account?.status().account ? repository.account.reconnect().catch(() => undefined) : Promise.resolve();
      void revalidate.then(() => repository.recoverTasks()).then(() => repository.readChainState()).then(snapshot => {
        setState(snapshot); setModal(null); setMenu(null); setNotice(''); clearFeedback(); resultPermit.current = null;
        setRoute({ page: 'home' }); history.replaceState({ page: 'home' }, '', '#/p01');
      }).catch(cause => notify(errorText(cause)));
    };
    const testSettled = (event: Event) => {
      const outcome = (event as CustomEvent<TaskOutcome>).detail;
      void repository.readChainState().then(snapshot => {
        setState(snapshot);
        if (outcome.settlementId) {
          resultPermit.current = outcome.settlementId;
          const next: Route = { page: 'result', settlementId: outcome.settlementId };
          setModal(null); setNotice(''); clearTimeout(noticeTimer.current); setRoute(next); history.replaceState(next, '', '#/p06');
        }
      }).catch(cause => notify(errorText(cause)));
    };
    window.addEventListener('popstate', pop);
    window.addEventListener('pageshow', restoredPage);
    document.addEventListener('pointerdown', unlockSound); document.addEventListener('keydown', unlockSound);
    if (__TEST_BUILD__) { window.addEventListener('climb-fixtures-loaded', fixtures); window.addEventListener('climb-test-settled', testSettled); }
    return () => {
      history.scrollRestoration = previousScrollRestoration;
      window.removeEventListener('popstate', pop); window.removeEventListener('climb-fixtures-loaded', fixtures); window.removeEventListener('climb-test-settled', testSettled);
      window.removeEventListener('pageshow', restoredPage);
      document.removeEventListener('pointerdown', unlockSound); document.removeEventListener('keydown', unlockSound);
      clearTimeout(timer.current); clearTimeout(noticeTimer.current);
    };
  }, [clearFeedback, notify, repository]);
  const runtime = useTaskRuntime({ repository, state, update: setState, onAbort: () => navigate({ page: 'home' }), onError: cause => notify(errorText(cause)), onEvents: events => {
    setNotice(events.map(event => event.kind === 'reservation-due' ? '预约已到期，已开始专注。' : '专注已达标，完成前仍需继续履约。').join(' '));
    clearTimeout(noticeTimer.current); noticeTimer.current = setTimeout(() => setNotice(''), 6000);
    if (home.settings.soundEnabled) playShortTone();
  } });
  async function runTask(command: TaskCommand, showResult = false) {
    const outcome = await runtime.execute(command);
    if (!outcome) return null;
    if (outcome.aborted) return outcome;
    if (showResult && outcome.settlementId) { resultPermit.current = outcome.settlementId; navigate({ page: 'result', settlementId: outcome.settlementId }); }
    return outcome;
  }
  function prepare(chainId: string, reserved: boolean) {
    if (activeTask(state)) { notify('请先处理当前任务'); return; }
    const source: SourceRoute = route.page === 'home' || route.page === 'list' || route.page === 'detail' ? route : { page: 'home' };
    navigate({ page: 'prepare', id: chainId, reserved, source });
  }
  function returnTask() {
    const task = activeTask(state); if (!task) { notify('暂无未完成任务'); return; }
    navigate({ page: 'execute', taskId: task.id });
    if (task.status === 'cancel-pending') openModal({ kind: 'decision', taskId: task.id });
  }
  async function requestDecision(kind: 'cancel-request' | 'interrupt', taskId: string) {
    const decisionId = crypto.randomUUID();
    const outcome = await runTask(kind === 'cancel-request' ? { type: kind, taskId, decisionId } : { type: kind, taskId, decisionId, interruptionId: crypto.randomUUID() });
    if (!outcome || outcome.aborted) return;
    try {
      const task = await repository.get('tasks', taskId);
      if (task?.status === 'cancel-pending' || task?.status === 'interrupt-pending') openModal({ kind: 'decision', taskId });
    } catch (cause) { notify(errorText(cause)); }
  }
  async function confirmDecision(input: DecisionInput) {
    if (modal?.kind !== 'decision') return;
    const task = state.tasks.find(item => item.id === modal.taskId);
    if (!task?.pendingDecisionId) return;
    const outcome = await runTask({ type: 'decide', taskId: task.id, decisionId: task.pendingDecisionId, input }, true);
    if (outcome && !outcome.settlementId) closeTaskDialog();
  }
  async function runCommand(command: ChainCommand): Promise<boolean> {
    if (committing.current) return false;
    committing.current = true; setBusy(true);
    try {
      await repository.executeChainCommand(command);
      setState(await repository.readChainState());
      return true;
    } catch (cause) { notify(errorText(cause)); return false; }
    finally { committing.current = false; setBusy(false); }
  }
  function showMenu(id: string, anchor: HTMLButtonElement) {
    clearFeedback(); setMenu(old => old?.id === id ? null : { id, anchor });
  }
  async function management(action: 'archive' | 'restore' | 'delete') {
    if (!menu) return;
    const id = menu.id;
    if (action === 'delete') { openModal({ kind: 'delete', id }); return; }
    closeMenu();
    if (await runCommand({ type: action, chainId: id })) {
      if (action === 'restore' && route.page === 'detail') notify('已恢复');
      else navigate({ page: 'list' }, action === 'archive' ? '已归档' : '已恢复');
    }
  }
  async function toggleSound() {
    if (savingSound) return;
    setSavingSound(true); setSaveError('');
    try { const settings = await repository.setSound(!home.settings.soundEnabled); setHome(old => ({ ...old, settings })); }
    catch (cause) { setSaveError(repository.account?.status().pending ? '声音保存结果尚未确认，请到“账户”重试原操作。' : errorText(cause)); }
    finally { setSavingSound(false); }
  }
  const selected = route.page === 'detail' ? state.chains.find(chain => chain.id === route.id) : null;
  let detailError = '';
  if (selected) { try { chainDetail(state, selected.id); } catch (cause) { detailError = errorText(cause); } }
  const modalChain = modal && 'id' in modal ? state.chains.find(chain => chain.id === modal.id) : null;
  const menuChain = menu ? state.chains.find(chain => chain.id === menu.id) : null;
  const recordTask = modal?.kind === 'record' ? state.tasks.find(task => task.id === modal.taskId) : null;
  const executingTask = route.page === 'execute' ? state.tasks.find(task => task.id === route.taskId && unfinished(task) && !state.settlements.some(item => item.taskId === task.id)) : null;
  const decisionTask = modal?.kind === 'decision' ? state.tasks.find(task => task.id === modal.taskId) : null;
  const result = route.page === 'result' && resultPermit.current === route.settlementId ? state.settlements.find(item => item.id === route.settlementId) : null;
  const preparationChain = route.page === 'prepare' ? state.chains.find(chain => chain.id === route.id && chain.status === 'available' && state.rounds.some(round => round.id === chain.currentRoundId && round.status === 'active')) : null;
  const hasTask = activeTask(state);
  const displayTask = executingTask?.status === 'reserved' && runtime.now >= executingTask.dueAt ? { ...executingTask, status: 'focusing' as const, accumulatedMs: 0, runningSince: executingTask.dueAt, focusStartedAt: executingTask.dueAt } : executingTask;
  const accountBlocked = !!accountStatus && !accountStatus.writable;
  const accountNotice = accountStatus?.busy ? '正在等待服务器确认，请勿重复操作。'
    : accountStatus?.pending ? '有未确认操作，请回首页打开账户重试原操作。'
    : accountStatus?.error ? `${accountStatus.error} 请回首页打开账户处理。`
    : accountStatus?.account && !accountStatus.writable ? '当前只读，请回首页打开账户检查会话并校时。' : '';
  return <TaskActionsContext.Provider value={{ prepare, returnTask }}>
    <div className="application-stage">
    {accountNotice && <aside className="account-notice" role="status" aria-label="账户提示">{accountNotice}</aside>}
    {route.page === 'home' && <Home state={state} openChain={id => navigate({ page: 'detail', id, from: 'home' })} notify={notify}
      navigate={page => navigate(page === 'p02' ? { page: 'list' } : page === 'p07' ? { page: 'climb' } : { page: 'placeholder', id: page })}
      openSettings={() => openModal({ kind: 'settings' })} openAccount={repository.account ? () => openModal({ kind: 'account' }) : undefined} accountBusy={accountStatus?.busy} openCreate={() => openModal({ kind: 'create', from: 'home' })} />}
    {route.page === 'climb' && <ClimbRoute state={state} back={() => navigate({ page: 'home' })} />}
    {route.page === 'list' && <ChainList state={state} visit={visit} saveVisit={setVisit} back={() => navigate({ page: 'home' })}
      create={() => openModal({ kind: 'create', from: 'list' })} open={id => navigate({ page: 'detail', id, from: 'list' })}
      newRound={id => openModal({ kind: 'new-round', id, from: 'list' })} more={showMenu} notify={notify} />}
    {route.page === 'detail' && selected && !detailError && <ChainDetail key={`detail:${selected.id}`} id={selected.id} state={state} busy={busy || accountBlocked}
      back={() => navigate(route.from === 'home' ? { page: 'home' } : { page: 'list' })}
      rename={name => runCommand({ type: 'rename', chainId: selected.id, name })}
      newRound={() => openModal({ kind: 'new-round', id: selected.id, from: route.from })}
      more={anchor => showMenu(selected.id, anchor)} record={taskId => openModal({ kind: 'record', taskId })}
      summaries={() => openModal({ kind: 'summaries', id: selected.id })} notify={notify} />}
    {route.page === 'detail' && (!selected || detailError) && <main className="startup"><h1>链条暂不可用</h1><p role="alert">{detailError || '链条不存在或已被删除'}</p><Button onClick={() => navigate({ page: 'list' })}>全部链条</Button></main>}
    {route.page === 'placeholder' && <Placeholder page={route.id} goHome={() => navigate({ page: 'home' })} />}
    {route.page === 'prepare' && preparationChain && !hasTask && <TaskPrepare key={`${route.id}:${route.reserved}`} state={state} chainId={route.id} initiallyReserved={route.reserved} busy={runtime.busy || accountBlocked} back={() => navigate(route.source)} notify={notify} feedback={feedback} submit={command => { void runTask(command).then(outcome => { if (outcome && !outcome.aborted) navigate({ page: 'execute', taskId: command.taskId }); }); }} />}
    {route.page === 'prepare' && (!preparationChain || hasTask) && <main className="startup"><p>{hasTask ? '请先处理当前任务' : '链条状态已变化，请重新准备任务。'}</p><Button onClick={hasTask ? returnTask : () => navigate({ page: 'home' })}>{hasTask ? '返回任务' : '返回首页'}</Button></main>}
    {route.page === 'execute' && executingTask && displayTask && <TaskExecution task={displayTask} state={state} now={runtime.now} busy={runtime.busy || accountBlocked} home={() => navigate({ page: 'home' })}
      early={() => { void runTask({ type: 'early-start', taskId: executingTask.id }); }} cancel={() => { void requestDecision('cancel-request', executingTask.id); }} interrupt={() => { void requestDecision('interrupt', executingTask.id); }}
      resume={() => { void runTask({ type: 'resume', taskId: executingTask.id }); }} finish={() => { void runTask({ type: 'finish', taskId: executingTask.id }, true); }} process={() => openModal({ kind: 'decision', taskId: executingTask.id })} />}
    {route.page === 'execute' && !executingTask && <main className="startup"><p>当前任务已结束或无法恢复。</p><Button onClick={() => navigate({ page: 'home' })}>返回首页</Button></main>}
    {route.page === 'result' && result && <TaskResult result={result} state={state} home={() => navigate({ page: 'home' })} newRound={() => openModal({ kind: 'new-round', id: result.chainId, from: 'result' })} />}
    {route.page === 'result' && !result && <main className="startup"><Button onClick={() => navigate({ page: 'home' })}>返回首页</Button></main>}
    </div>
    <SiteFooter />
    {modal?.kind === 'decision' && decisionTask && <DecisionDialog key={decisionTask.pendingDecisionId} task={decisionTask} state={state} busy={runtime.busy} feedback={feedback} close={closeModal} notify={notify} confirm={input => { void confirmDecision(input); }} />}
    {modal?.kind === 'settings' && <Dialog title="设置" width={560} onClose={closeModal} feedback={feedback}>
      <div className="setting-row" onClick={event => { if (!accountBlocked && (!(event.target instanceof Element) || !event.target.closest('button'))) void toggleSound(); }}><span>提示声音</span><SoundSwitch checked={home.settings.soundEnabled} busy={savingSound || accountBlocked} onChange={() => void toggleSound()} /></div>
      <p className="muted">仅提供网页内提醒。关闭网页期间不承诺提醒，重开不补播声音。</p>
      {saveError && <p role="alert" className="error">{saveError}</p>}
      <div className="settings-links"><Button variant="link" onClick={() => openModal({ kind: 'rules' })}>规则说明</Button></div>
    </Dialog>}
    {modal?.kind === 'account' && repository.account && accountStatus && <AccountDialog access={repository.account} status={accountStatus} close={closeModal} done={() => { setModal(null); notify('服务器已确认账户操作'); }} />}
    {modal?.kind === 'rules' && <Dialog key="rules" title="规则说明" width={672} onClose={closeModal} onEscape={() => openModal({ kind: 'settings' })} feedback={feedback}><Rules back={() => openModal({ kind: 'settings' })} /></Dialog>}
    {(modal?.kind === 'create' || modal?.kind === 'new-round') && <ChainForm key={`form:${modal.kind === 'create' ? 'create' : modal.id}`} state={state} chainId={modal.kind === 'new-round' ? modal.id : undefined} busy={busy || accountBlocked} feedback={feedback} notify={notify} close={closeModal} save={command => {
      const from = modal.from;
      void runCommand(command).then(saved => { if (saved) navigate({ page: 'detail', id: command.chainId, from: from === 'result' ? 'home' : from }); });
    }} />}
    {modal?.kind === 'delete' && modalChain && <Dialog title={`永久删除“${modalChain.name}”？`} width={560} onClose={closeModal} feedback={feedback}
      actions={<><Button variant="secondary" onClick={closeModal}>取消</Button><Button className="button--danger" disabled={busy} onClick={() => { void runCommand({ type: 'delete', chainId: modalChain.id }).then(saved => { if (saved) navigate({ page: 'list' }, '已永久删除'); }); }}>永久删除</Button></>}>
      <p>将永久删除“{modalChain.name}”及其任务记录、判例等全部关联数据，删除后无法恢复。</p><p>该链节点将从攀登总节点中移除，可能导致攀登进度回退。</p>
    </Dialog>}
    {modal?.kind === 'record' && recordTask && <RecordDialog task={recordTask} state={state} close={closeModal} feedback={feedback} />}
    {modal?.kind === 'summaries' && modalChain && <RoundSummaryDialog rounds={chainDetail(state, modalChain.id).summaries} close={closeModal} feedback={feedback} />}
    {menu && menuChain && <ChainMenu anchor={menu.anchor} chain={menuChain} state={state} onClose={closeMenu} onAction={action => void management(action)} notify={notify} />}
    {!modal && feedback && <div role="status" className="feedback">{feedback}</div>}
    {notice && <div role="status" className={`deadline-notice ${route.page === 'execute' ? 'deadline-notice--execution' : ''}`}><span>{notice}</span><Button variant="link" aria-label="关闭到点提醒" onClick={() => { clearTimeout(noticeTimer.current); setNotice(''); }}>关闭</Button></div>}
  </TaskActionsContext.Provider>;
}
