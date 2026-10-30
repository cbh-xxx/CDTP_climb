import { BrowserTestClock } from './browser-clock';
import { IndexedDbRepository, databaseName } from '../data/indexed-db';
import { fixtureWrites } from './fixtures';
import { activeTask } from '../domain/chains';
import { effectiveMs } from '../domain/time';
import type { Repository } from '../data/repository';
let current: Repository | undefined;
export function bindTestRepository(repository: Repository) { current = repository; }
export function installTestTools() {
  document.body.classList.add('test-mode');
  const clock = new BrowserTestClock();
  const panel = document.createElement('aside');
  panel.className = 'test-tools';
  panel.setAttribute('aria-label', '隔离测试工具');
  const label = document.createElement('span');
  label.textContent = '隔离测试模式';
  const button = document.createElement('button');
  button.textContent = '测试时钟推进5分钟';
  const accountLocked = () => !!current?.account?.status().account || !!current?.account?.status().pending;
  button.onclick = () => { if (accountLocked()) { label.textContent = '账户模式使用服务器时间，不使用游客加速'; return; } clock.advance(300_000); label.textContent = `隔离测试模式 · ${clock.now()}`; };
  panel.append(label, button);
  for (const [text, amount] of [['推进1秒', 1000], ['推进29分59秒', 1_799_000]] as const) {
    const advance = document.createElement('button'); advance.textContent = text;
    advance.onclick = () => { if (accountLocked()) return; clock.advance(amount); label.textContent = '隔离测试模式 · 时钟已推进'; };
    panel.append(advance);
  }
  for (const [text, rate] of [['正常速度', 1], ['60倍时钟', 60]] as const) {
    const speed = document.createElement('button'); speed.textContent = text;
    speed.onclick = () => { if (accountLocked()) return; clock.setRate(rate); label.textContent = `隔离测试模式 · ${rate}倍`; };
    panel.append(speed);
  }
  const success = document.createElement('button'); success.textContent = '测试快速成功';
  success.onclick = async () => {
    if (accountLocked()) { label.textContent = '账户模式不绕过服务器校时及保存'; return; }
    success.disabled = true;
    const repository = new IndexedDbRepository(databaseName(true), clock);
    try {
      await repository.initialize(); await repository.recoverTasks();
      const task = activeTask(await repository.readChainState());
      if (!task || task.status !== 'focusing') { label.textContent = '须先进入正式专注，暂停或待判定不能快速完成'; return; }
      clock.advance(Math.max(0, task.plannedMinutes * 60_000 - effectiveMs(task, clock)));
      const outcome = await repository.executeTaskCommand({ type: 'finish', taskId: task.id });
      window.dispatchEvent(new CustomEvent('climb-test-settled', { detail: outcome }));
      label.textContent = '已通过正式结算流程完成';
    } catch { label.textContent = '测试快速成功未完成，请重试'; }
    finally { repository.close(); success.disabled = false; }
  };
  panel.append(success);
  for (const [text, occupancy] of [['加载链条与历史测试数据', false], ['加入未完成任务场景', true]] as const) {
    const load = document.createElement('button');
    load.textContent = text;
    load.onclick = async () => {
      if (accountLocked()) { label.textContent = '账户或未确认操作存在时不能加载游客夹具'; return; }
      load.disabled = true;
      const repository = new IndexedDbRepository(databaseName(true), clock);
      try {
        await repository.initialize();
        const owner = await repository.get('metadata', 'local-owner');
        if (!owner) throw new Error('测试归属缺失');
        await repository.writeAtomically(fixtureWrites(owner.ownerId, clock.now(), occupancy));
        window.dispatchEvent(new Event('climb-fixtures-loaded'));
        label.textContent = '隔离测试模式 · 夹具已加载';
      } catch { label.textContent = '测试数据加载失败，请重试'; }
      finally { repository.close(); load.disabled = false; }
    };
    panel.append(load);
  }
  document.body.append(panel);
  return clock;
}
