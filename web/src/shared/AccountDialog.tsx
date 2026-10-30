import { useState } from 'react';
import type { AccountAccess, AccountStatus } from '../data/account-types';
import { Button, Dialog } from './controls';

export function AccountDialog({ access, status, close, done }: { access: AccountAccess; status: AccountStatus; close(): void; done(): void }) {
  const [mode, setMode] = useState<'login' | 'register'>(status.pending === 'register' ? 'register' : 'login');
  const [username, setUsername] = useState(status.pendingUsername ?? status.account?.username ?? '');
  const [password, setPassword] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState('');
  async function run(action: () => Promise<void>) {
    setError('');
    try { await action(); setPassword(''); done(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '操作未确认，请重试'); }
  }
  const locked = status.busy || !!status.pending;
  return <Dialog title="账户与云端保存" width={560} onClose={() => { if (!status.busy) close(); }}>
    <div className="account-content">
      <p aria-label="账户状态">{status.account ? `当前账户：${status.account.username}` : '当前为游客，数据保存在本机，无需登录也可使用。'} {status.busy ? '等待服务器确认' : status.pending ? '有未确认操作' : status.account ? status.writable ? '云端保存已就绪' : '只读，需联网校时' : '本地保存'}</p>
      <p className="muted">登录已有账户会用云端完整数据替换本机，不合并游客数据。不同设备上传的整份数据会互相覆盖，可能丢失记录、恢复已删除内容或降低历史纪录。</p>
      <div className="actions"><Button variant={mode === 'login' ? 'primary' : 'secondary'} disabled={locked} onClick={() => { setMode('login'); setError(''); }}>登录已有账户</Button><Button variant={mode === 'register' ? 'primary' : 'secondary'} disabled={locked || !!status.account} onClick={() => { setMode('register'); setError(''); }}>注册并带入游客数据</Button></div>
      <form className="account-form" onSubmit={event => { event.preventDefault(); void run(() => access.authenticate(mode, username, password, acknowledged)); }}>
        <div className="field"><label htmlFor="account-username">用户名</label><input id="account-username" name="username" autoComplete="username" value={username} maxLength={32} disabled={status.busy || !!status.pendingUsername} onChange={event => setUsername(event.target.value)} aria-describedby="username-rule" /></div>
        <p id="username-rule" className="muted">3—32位字母、数字或下划线，大小写视为同名。</p>
        <div className="field"><label htmlFor="account-password">密码</label><input id="account-password" name="password" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={password} maxLength={128} disabled={status.busy} onChange={event => setPassword(event.target.value)} aria-describedby="password-rule" /></div>
        <p id="password-rule" className="muted">12—128位，部分表情按2位计算；不含控制字符，空格会保留。密码不会保存在待确认请求中。</p>
        {mode === 'register' && <label className="account-ack"><input type="checkbox" checked={acknowledged} disabled={status.busy} onChange={event => setAcknowledged(event.target.checked)} /><span>我已知晓：不收集邮箱，初版不提供密码找回或人工重置。注册将带入当前游客数据及未完成任务。</span></label>}
        {(error || status.error) && <p role="alert" className="error">{error || status.error}</p>}
        {status.pending && <p>未确认操作：{status.pending === 'write' ? '云端保存' : status.pending === 'register' ? '注册迁移' : status.pending === 'login' ? '登录切换' : '退出'}。请重试原操作，不能继续积累新修改。账户操作重开后需重新输入原密码。</p>}
        <div className="actions">
          {(!status.pending || status.pending === 'write') && <Button type="submit" disabled={status.busy || !username || !password || (mode === 'register' && !acknowledged)}>{status.pending === 'write' ? '重新登录原账户' : mode === 'register' ? '注册并迁移' : '登录并下载'}</Button>}
          {status.pending && <Button disabled={status.busy || ((status.pending === 'login' || status.pending === 'register') && !password)} onClick={() => void run(() => access.retry(password))}>重试原操作</Button>}
          {status.account && !status.pending && <><Button variant="secondary" disabled={status.busy} onClick={() => void run(() => access.reconnect())}>检查会话并校时</Button><Button variant="secondary" disabled={status.busy} onClick={() => void run(() => access.logout())}>退出回到空游客</Button></>}
        </div>
      </form>
    </div>
  </Dialog>;
}
