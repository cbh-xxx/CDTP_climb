import { expect, it } from 'vitest';
import { peakImage, sceneForLevel } from './mountains';
it('30峰各有独立图片；全局首尾状态与具体山峰图片分离', () => {
  const images = Array.from({ length: 30 }, (_, index) => peakImage(index + 1));
  expect(new Set(images).size).toBe(30);
  expect(images[0]).toContain('mithrim-landscape-1440.png');
  expect(images[29]).toContain('30-rheasilvia-central-peak.png');
  expect(sceneForLevel(0).image).toContain('state-before-first.png');
  expect(sceneForLevel(30).image).toContain('state-all-summits.png');
  expect(sceneForLevel(2).image).toBe(peakImage(2));
  expect(() => peakImage(0)).toThrow();
});
