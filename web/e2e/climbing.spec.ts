import { expect, test } from '@playwright/test';
test('空数据完整路线、未达峰可读、关闭保留位置和设置规则', async ({ page }) => {
  await page.goto('http://127.0.0.1:5174');
  await page.getByRole('button', { name: '攀登详情' }).click();
  await expect(page.locator('.route-capsule')).toHaveCount(30);
  await expect(page.locator('.route-capsule.is-center')).toContainText('米斯林');
  await page.locator('.route-capsule.is-center').click();
  await expect(page.getByRole('dialog')).toContainText('3337米');
  // Pointer automation may scroll the focused capsule a few pixels before opening.
  const position = await page.locator('.route-scroll').evaluate(el => el.scrollTop);
  await page.keyboard.press('Escape');
  await expect.poll(async()=>Math.abs(await page.locator('.route-scroll').evaluate(el=>el.scrollTop)-position)).toBeLessThan(2);
  await page.getByRole('button', { name: '返回首页', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '规则说明', exact: true }).click();
  await expect(page.locator('.rules-group')).toHaveCount(6);
  await page.locator('summary').filter({ hasText: '节点' }).click();
  await page.locator('summary').filter({ hasText: '攀登' }).click();
  await expect(page.locator('details[open]')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveAccessibleName('设置');
});
