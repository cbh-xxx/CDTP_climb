import { Button } from '../shared/controls';
export const pageTitles: Record<string, string> = {
  p02: '全部链条', p03: '单链详情', p04: '任务准备', p05: '任务执行', p06: '任务结果', p07: '攀登详情',
};
export function Placeholder({ page, goHome }: { page: string; goHome(): void }) {
  return <main className="placeholder"><header><Button variant="link" onClick={goHome}>返回首页</Button><h1>{pageTitles[page] ?? '页面未找到'}</h1></header>
    <section><h2>开发占位</h2><p>此功能将在后续阶段实现。</p><p>访问本页不会创建任务或结果记录。</p></section>
  </main>;
}
