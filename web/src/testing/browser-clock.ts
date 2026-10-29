import type { Clock } from '../domain/time';
interface Anchor { real: number; virtual: number; rate: number }
const key = 'climb-test-clock-v1';
export class BrowserTestClock implements Clock {
  private anchor: Anchor;
  constructor() {
    const now = Date.now();
    this.anchor = { real: now, virtual: now, rate: 1 };
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? 'null') as Anchor | null;
      if (saved && Number.isFinite(saved.real) && Number.isFinite(saved.virtual) && [1, 60].includes(saved.rate)) this.anchor = saved;
    } catch { /* An invalid isolated clock setting resets only the test clock. */ }
  }
  now() { return Math.floor(this.anchor.virtual + Math.max(0, Date.now() - this.anchor.real) * this.anchor.rate); }
  private save(virtual: number, rate: number) {
    this.anchor = { virtual, rate, real: Date.now() };
    localStorage.setItem(key, JSON.stringify(this.anchor));
    window.dispatchEvent(new Event('climb-clock-changed'));
  }
  advance(ms: number) {
    if (!Number.isSafeInteger(ms) || ms < 0) throw new Error('测试时钟只能向前推进');
    this.save(this.now() + ms, this.anchor.rate);
  }
  setRate(rate: 1 | 60) { this.save(this.now(), rate); }
}
