import type { Clock } from '../domain/time';
export class TestClock implements Clock {
  constructor(private instant: number) {}
  now() { return this.instant; }
  advance(ms: number) {
    if (!Number.isSafeInteger(ms) || ms < 0) throw new Error('测试时钟只能向前推进');
    this.instant += ms;
  }
}
