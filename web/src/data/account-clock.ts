import type { Clock } from '../domain/time';
export class AccountClock implements Clock {
  private account = false;
  private anchor = 0;
  private monotonic = 0;
  constructor(private guest: Clock, private elapsed = () => performance.now()) {}
  now() { return this.account ? Math.floor(this.anchor + Math.max(0, this.elapsed() - this.monotonic)) : this.guest.now(); }
  useGuest() { this.account = false; }
  localSource() { return this.account ? undefined : this.guest; }
  useAccount(server: number) { this.account = true; this.anchor = server; this.monotonic = this.elapsed(); }
}
export function estimateServerTime(sample: { sentWall: number; receivedWall: number; sentMono: number; receivedMono: number; received: number; sent: number }) {
  const rtt = sample.receivedMono - sample.sentMono, processing = sample.sent - sample.received;
  if (!Object.values(sample).every(Number.isFinite) || rtt < 0 || processing < 0 || processing > rtt + 1 || rtt > 10000 || Math.abs(sample.receivedWall - sample.sentWall - rtt) > 1000) throw new Error('校时失败，请重试；账户保持只读');
  return sample.sent + Math.max(0, rtt - processing) / 2;
}
