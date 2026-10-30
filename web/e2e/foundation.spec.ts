import { expect, test } from '@playwright/test';

test('空首页、创建取消、设置重开与键盘关闭', async ({ page, context }) => {
  await page.goto('/?test=1&mode=testing');
  await expect(page.getByRole('heading', { name: '尚未登顶' })).toBeVisible();
  await expect(page.getByRole('button', { name: '开始', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('隔离测试工具')).toHaveCount(0);
  await page.getByRole('button', { name: '新建链条', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '创建链条' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '新建链条', exact: true })).toBeFocused();
  await page.getByRole('button', { name: '全部链条' }).click();
  await expect(page.getByRole('heading', { name: '全部链条' })).toBeVisible();
  await page.getByRole('button', { name: '返回首页' }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const sound = page.getByRole('switch', { name: '提示声音' });
  await expect(sound).toHaveAttribute('aria-checked', 'true'); await sound.click();
  await expect(sound).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '设置', exact: true })).toBeFocused();
  await page.reload(); await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(sound).toHaveAttribute('aria-checked', 'false');
  const reopened = await context.newPage(); await page.close();
  await reopened.goto('/'); await reopened.getByRole('button', { name: '设置', exact: true }).click();
  await expect(reopened.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
});

test('设置写入失败不伪装成功，弹窗焦点、内部点击与遮罩', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('heading', { name: '设置', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
      if (this.name === 'settings') throw new DOMException('test quota', 'QuotaExceededError');
      return original.apply(this, args);
    };
  });
  await page.getByRole('switch').click();
  await expect(page.getByRole('alert')).toContainText('未保存');
  await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.querySelector('dialog')?.contains(document.activeElement))).toBe(true);
  }
  await page.mouse.click(5, 5); await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('普通与测试构建隔离且不受URL参数切换', async ({ page, context }) => {
  await page.goto('/?mode=testing');
  await expect(page.getByRole('heading', { name: '尚未登顶' })).toBeVisible();
  const testing = await context.newPage(); await testing.goto('http://127.0.0.1:5174');
  await expect(testing.getByLabel('隔离测试工具')).toBeVisible();
  await testing.getByRole('button', { name: '设置', exact: true }).click();
  await testing.getByRole('switch').click(); await expect(testing.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
});

test('较新数据库显示错误、重试且保留数据', async ({ page }) => {
  await page.goto('/'); await expect(page.getByRole('heading', { name: '尚未登顶' })).toBeVisible();
  await page.goto('about:blank'); await page.goto('/');
  await page.evaluate(async () => {
    const request = indexedDB.open('climb-local', 99);
    await new Promise<void>((resolve, reject) => {
      request.onsuccess = () => { request.result.close(); resolve(); }; request.onerror = () => reject(request.error);
    });
  });
  await page.reload(); await expect(page.getByRole('alert')).toContainText('较新版本');
  await expect(page.getByRole('button', { name: '重试', exact: true })).toBeVisible();
  expect(await page.evaluate(async () => (await indexedDB.databases()).find(db => db.name === 'climb-local')?.version)).toBe(99);
});

for (const viewport of [{ width: 1440, height: 1024 }, { width: 1280, height: 720 }, { width: 1920, height: 1080 }]) {
  test(`桌面布局 ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport); await page.goto('/');
    await expect(page.getByRole('heading', { name: '尚未登顶' })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const layout = await page.evaluate(() => {
      const overview = document.querySelector('.overview')!.getBoundingClientRect();
      const recent = document.querySelector('.recent')!.getBoundingClientRect();
      return { scrollX: document.documentElement.scrollWidth > innerWidth, scrollY: document.documentElement.scrollHeight > innerHeight,
        overlap: overview.right > recent.left && overview.bottom > recent.top,
        recentBottom: recent.bottom, imageSizes: [...document.images].map(img => ({ ok: img.complete && img.naturalWidth > 0, width: img.clientWidth, height: img.clientHeight })) };
    });
    expect(layout.scrollX).toBe(false); expect(layout.scrollY).toBe(true); expect(layout.overlap).toBe(false);
    expect(layout.recentBottom).toBeLessThanOrEqual(viewport.height);
    expect(layout.imageSizes.every(img => img.ok && img.width === 24 && img.height === 24)).toBe(true);
    const account = page.getByRole('button', { name: '账户', exact: true });
    const settings = page.getByRole('button', { name: '设置', exact: true });
    const accountBox = await account.boundingBox(), settingsBox = await settings.boundingBox();
    expect(accountBox!.width).toBe(48); expect(accountBox!.height).toBe(48);
    expect(accountBox!.x).toBe(settingsBox!.x); expect(accountBox!.y - settingsBox!.y - settingsBox!.height).toBe(12);
    await account.click(); await expect(page.getByRole('dialog', { name: '账户与云端保存' })).toBeVisible();
    await page.keyboard.press('Escape'); await expect(account).toBeFocused();
    const footer = page.getByRole('contentinfo', { name: '备案信息' });
    expect((await footer.boundingBox())!.y).toBeGreaterThanOrEqual(viewport.height);
    await expect(footer).not.toBeInViewport();
    await page.mouse.move(8, viewport.height - 8); await page.mouse.wheel(0, viewport.height);
    await expect(footer).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.mouse.wheel(0, -viewport.height); await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    if (test.info().project.name === 'chrome' && viewport.width === 1440) {
      await page.screenshot({ path: test.info().outputPath('p01.png') });
    }
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('button', { name: /账户/ })).toHaveCount(0);
    const bounds = await page.getByRole('dialog').boundingBox();
    expect(bounds!.y).toBeGreaterThanOrEqual(0); expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
  });
}

test('各主页面共享屏外备案区、外链新标签与返回时外层滚动复位', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '尚未登顶' })).toBeVisible();
  const footer = page.getByRole('contentinfo', { name: '备案信息' });
  const links = [
    { name: '蜀ICP备2026066653号', url: 'https://beian.miit.gov.cn/#/Integrated/index' },
    { name: '蜀公安备案号：____', url: 'https://beian.mps.gov.cn/#/query/webSearch' },
  ];
  // 本用例只验证链接行为，不访问或依赖外部备案网站。
  await context.route('https://beian.miit.gov.cn/**', route => route.fulfill({ contentType: 'text/html', body: '<title>备案链接验收</title>' }));
  await context.route('https://beian.mps.gov.cn/**', route => route.fulfill({ contentType: 'text/html', body: '<title>备案链接验收</title>' }));
  for (const item of links) {
    const link = footer.getByRole('link', { name: item.name, exact: true });
    await expect(link).toHaveAttribute('href', item.url);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    const popupPromise = page.waitForEvent('popup'); await link.click();
    const popup = await popupPromise; await expect(popup).toHaveURL(item.url); await popup.close();
  }
  await page.getByRole('button', { name: '全部链条', exact: true }).click();
  await expect(page.getByRole('button', { name: '账户', exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(footer).not.toBeInViewport();
  await page.mouse.move(8, 500); await page.mouse.wheel(0, 1000); await expect(footer).toBeInViewport();
  await page.goBack(); await expect(page.getByRole('button', { name: '账户', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.getByRole('button', { name: '攀登详情', exact: true }).click();
  await expect(page.getByRole('button', { name: '账户', exact: true })).toHaveCount(0);
  await expect(footer).not.toBeInViewport();
  await page.mouse.move(8, 500); await page.mouse.wheel(0, 1000); await expect(footer).toBeInViewport();
});
