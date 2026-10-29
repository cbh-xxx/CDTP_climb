import { expect, test, type Page } from '@playwright/test';

async function prepare(page: Page, reserved = false) {
  await page.goto('http://127.0.0.1:5174');
  await page.getByRole('button', { name: '新建链条', exact: true }).click();
  await page.getByLabel('链名称', { exact: true }).fill('阅读');
  await page.getByRole('radio', { name: '戴上耳机', exact: true }).check();
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await page.getByRole('button', { name: reserved ? '预约' : '开始', exact: true }).click();
  await expect(page.getByRole('heading', { name: '任务准备', exact: true })).toBeVisible();
  await page.getByLabel('任务内容', { exact: true }).fill('阅读论文');
  await page.getByRole('spinbutton', { name: '专注分钟', exact: true }).focus(); await page.keyboard.press('ArrowDown');
  if (reserved) { await page.getByRole('spinbutton', { name: '预约分钟', exact: true }).focus(); await page.keyboard.press('ArrowDown'); }
}
async function start(page: Page, reserved = false) {
  await prepare(page, reserved);
  await page.getByRole('button', { name: reserved ? '确认预约' : '开始专注', exact: true }).click();
  await expect(page.getByLabel(reserved ? '预约剩余时间' : '有效专注时间', { exact: true })).toBeVisible();
}
async function returnTask(page: Page) { await page.getByRole('button', { name: '返回当前任务', exact: true }).click(); }
async function allowNew(page: Page, text = '接听紧急电话') {
  await page.getByRole('button', { name: '允许', exact: true }).click();
  await page.getByLabel('新的允许情境', { exact: true }).fill(text);
  await page.getByRole('button', { name: '确认判定', exact: true }).click();
}
test('准备未选、预约切换清空、D09回填及取消结果保留复用', async ({ page }) => {
  await prepare(page, true);
  await page.getByRole('checkbox', { name: '预约开始', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: '预约开始', exact: true }).check();
  await expect(page.getByRole('spinbutton', { name: '预约分钟', exact: true })).toHaveAttribute('aria-valuetext', '未选择');
  await page.getByRole('spinbutton', { name: '预约分钟', exact: true }).focus(); await page.keyboard.press('ArrowDown');
  await page.getByRole('button', { name: '确认预约', exact: true }).click();
  await page.getByRole('button', { name: '取消预约', exact: true }).click(); await allowNew(page);
  await expect(page.getByRole('heading', { name: '预约允许取消', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回首页', exact: true }).click();
  await page.getByRole('button', { name: '开始', exact: true }).click();
  await expect(page.getByLabel('任务内容', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: '复用', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '阅读论文', exact: true }).click();
  await expect(page.getByLabel('任务内容', { exact: true })).toHaveValue('阅读论文');
  await expect(page.getByRole('spinbutton', { name: '专注分钟', exact: true })).toHaveAttribute('aria-valuetext', '未选择');
});
test('取消冻结与主动关闭顺延，刷新恢复丢弃草稿并重开D04', async ({ page }) => {
  await start(page, true);
  await page.getByRole('button', { name: '取消预约', exact: true }).click();
  const frozen = await page.getByLabel('预约剩余时间', { exact: true }).textContent();
  await page.getByRole('button', { name: '测试时钟推进5分钟', exact: true }).click();
  await expect(page.getByLabel('预约剩余时间', { exact: true })).toHaveText(frozen!);
  await page.getByRole('button', { name: '允许', exact: true }).click();
  await page.getByLabel('新的允许情境', { exact: true }).fill('未提交草稿');
  await page.reload(); await expect(page.getByRole('heading', { name: '尚未登顶', exact: true })).toBeVisible();
  await returnTask(page);
  await expect(page.getByRole('dialog', { name: '取消预约判定', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '允许', exact: true }).click();
  await expect(page.getByLabel('新的允许情境', { exact: true })).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('预约剩余时间', { exact: true })).toHaveText(frozen!);
});
test('正式中断关闭保持待判定，允许后暂停，达标也不能直接完成', async ({ page }) => {
  await start(page); await page.getByRole('button', { name: '测试时钟推进5分钟', exact: true }).click();
  await expect(page.getByRole('button', { name: '完成', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '中断', exact: true }).click();
  await page.keyboard.press('Escape'); await expect(page.getByRole('button', { name: '处理本次中断', exact: true })).toBeVisible();
  await page.reload(); await returnTask(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '完成', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '处理本次中断', exact: true }).click(); await allowNew(page);
  await expect(page.getByRole('button', { name: '继续专注', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '完成', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '继续专注', exact: true }).click();
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expect(page.getByRole('heading', { name: '专注成功', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回首页', exact: true }).click();
  await page.getByRole('button', { name: '阅读', exact: true }).click();
  await page.getByRole('button', { name: /阅读论文.*成功/ }).click();
  await expect(page.getByRole('dialog', { name: '成功详情', exact: true })).toContainText('接听紧急电话');
});
test('关闭期间预约到期补算、不补旧提醒，测试快速成功走正式结算', async ({ page }) => {
  await start(page, true);
  await page.goto('about:blank');
  await page.goto('http://127.0.0.1:5174');
  await expect(page.getByRole('heading', { name: '尚未登顶', exact: true })).toBeVisible();
  // Advance the isolated clock while no task page is open, then reload to exercise recovery.
  await page.evaluate(() => {
    const key = 'climb-test-clock-v1';
    const anchor = JSON.parse(localStorage.getItem(key) ?? 'null') ?? { real: Date.now(), virtual: Date.now(), rate: 1 };
    anchor.virtual += 600_000; localStorage.setItem(key, JSON.stringify(anchor));
  });
  await page.reload();
  await expect(page.getByRole('button', { name: '关闭到点提醒', exact: true })).toHaveCount(0);
  await returnTask(page); await expect(page.getByRole('button', { name: '完成', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '测试快速成功', exact: true }).click();
  await expect(page.getByRole('heading', { name: '专注成功', exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByRole('heading', { name: '尚未登顶', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '返回当前任务', exact: true })).toHaveCount(0);
});
test('成功结果三列顺序、新增零节点与首页总数', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: '测试快速成功', exact: true }).click();
  await expect(page.getByRole('heading', { name: '专注成功', exact: true })).toBeVisible();
  await expect(page.locator('.result-stats dt')).toHaveText(['本次计入时长', '本次新增节点', '该链本轮节点']);
  await expect(page.locator('.result-stats dd')).toHaveText(['5', '0', '0']);
  await page.getByRole('button', { name: '返回首页', exact: true }).click();
  await expect(page.locator('.overview')).toContainText('当前总节点：0');
});

test('失败结果打开新轮未保存关闭回首页，历史摘要保留', async ({ page }) => {
  await start(page); await page.getByRole('button', { name: '中断', exact: true }).click();
  await page.getByRole('button', { name: '违规', exact: true }).click();
  await page.getByLabel('违规原因（选填）', { exact: true }).fill('走神');
  await page.getByRole('button', { name: '确认判定', exact: true }).click();
  await expect(page.getByRole('heading', { name: '违约失败', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '设置新一轮', exact: true }).click(); await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: '尚未登顶', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '全部链条', exact: true }).click(); await page.getByRole('button', { name: '阅读', exact: true }).click();
  await page.getByRole('button', { name: '往轮摘要', exact: true }).click(); await expect(page.getByRole('dialog')).toContainText('走神');
});
