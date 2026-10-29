import { expect, test } from '@playwright/test';

async function createChain(page: import('@playwright/test').Page, name: string) {
  await page.getByRole('button', { name: '新建链条', exact: true }).click();
  await page.getByLabel('链名称', { exact: true }).fill(name);
  await page.getByRole('radio', { name: '坐到书桌前' }).check();
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}
test('普通创建闭环、取消重命名、刷新保留及未提交准备不建任务', async ({ page }) => {
  await page.goto('/'); await createChain(page, '阅读');
  await expect(page.getByText('坐到书桌前', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '重命名', exact: true }).click();
  await page.getByLabel('链名称', { exact: true }).fill('未保存名称');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: '阅读', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '开始', exact: true }).click();
  await expect(page.getByRole('heading', { name: '任务准备', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(page.getByRole('status')).toHaveCount(0);
  await page.reload(); await expect(page.getByRole('button', { name: '阅读', exact: true })).toBeVisible();
  expect(await page.evaluate(async () => {
    const request = indexedDB.open('climb-local');
    return new Promise<number>((resolve, reject) => {
      request.onsuccess = () => {
        const db = request.result;
        const count = db.transaction('tasks').objectStore('tasks').count();
        count.onsuccess = () => { db.close(); resolve(count.result); }; count.onerror = () => reject(count.error);
      };
    });
  })).toBe(0);
});
test('归档恢复、同名校验、删除取消和永久删除', async ({ page }) => {
  await page.goto('/'); await createChain(page, '阅读');
  await page.getByRole('button', { name: '管理阅读', exact: true }).click();
  await page.getByRole('menuitem', { name: '归档', exact: true }).click();
  await expect(page.getByRole('heading', { name: '全部链条', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '新建链条', exact: true }).click();
  await page.getByLabel('链名称', { exact: true }).fill(' 阅读 ');
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('链名称已存在');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '已归档', exact: true }).click();
  await page.getByRole('button', { name: '管理阅读', exact: true }).click();
  await page.keyboard.press('Escape'); await expect(page.getByRole('menu')).toHaveCount(0);
  await page.getByRole('button', { name: '管理阅读', exact: true }).click();
  await page.getByRole('menuitem', { name: '恢复', exact: true }).click();
  await expect(page.getByRole('button', { name: '已归档', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: '阅读', exact: true }).click();
  await page.getByRole('button', { name: '管理阅读', exact: true }).click();
  await page.getByRole('menuitem', { name: '删除', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('可能导致攀登进度回退');
  await page.mouse.click(5, 5); await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '阅读', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '管理阅读', exact: true }).click(); await page.getByRole('menuitem', { name: '删除', exact: true }).click();
  await page.getByRole('button', { name: '永久删除', exact: true }).click();
  await expect(page.getByRole('heading', { name: '全部链条', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '阅读', exact: true })).toHaveCount(0);
  await page.reload(); await expect(page.getByRole('button', { name: '阅读', exact: true })).toHaveCount(0);
});
test('隔离夹具：历史、继承、返回列表位置和长内容', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('http://127.0.0.1:5174');
  await expect(page.getByRole('heading', { name: '尚未登顶' })).toBeVisible();
  await page.getByRole('button', { name: '加载链条与历史测试数据', exact: true }).click();
  await expect(page.getByRole('button', { name: '历史阅读', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '历史阅读', exact: true }).click();
  await page.getByRole('button', { name: /阅读论文摘要.*成功/ }).click();
  await expect(page.getByRole('dialog')).toContainText('暂停0分钟');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '往轮摘要', exact: true }).click(); await expect(page.getByRole('dialog')).toContainText('失效前9节点');
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByRole('button', { name: '全部链条', exact: true }).click();
  await page.getByRole('button', { name: '已归档', exact: true }).scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: '已归档', exact: true }).click();
  const before = await page.locator('.panel-scroll').evaluate(element => element.scrollTop);
  await page.getByRole('button', { name: '已归档阅读', exact: true }).click();
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(page.getByRole('button', { name: '已归档', exact: true })).toHaveAttribute('aria-expanded', 'true');
  expect(await page.locator('.panel-scroll').evaluate(element => element.scrollTop)).toBeGreaterThanOrEqual(before);
  await page.getByRole('button', { name: '失败待新轮', exact: true }).click();
  await page.getByRole('button', { name: '设置新一轮', exact: true }).click();
  const options = page.getByRole('checkbox'); await expect(options).toHaveCount(2);
  for (const option of await options.all()) await expect(option).not.toBeChecked();
  await page.getByRole('checkbox', { name: '紧急事务需要立即处理', exact: true }).check();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('tab', { name: '允许判例', exact: true }).click();
  await expect(page.getByRole('tabpanel')).toContainText('紧急事务需要立即处理');
  await expect(page.getByRole('tabpanel')).not.toContainText('接听必须及时回应的电话');
});
