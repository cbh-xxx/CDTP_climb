import type { ChainState, Settlement } from '../domain/models';
import { Button } from '../shared/controls';
import { mountainScene } from '../shared/mountains';
export function TaskResult({ result, state, home, newRound }: { result: Settlement; state: ChainState; home(): void; newRound(): void }) {
  const success = result.outcome === 'succeeded';
  const failed = result.outcome === 'failed';
  return <main className="result-page"><div className="landscape mountain-landscape" style={{ backgroundImage: `url("${mountainScene(state).image}")` }} aria-hidden="true" />
    <section className="result-panel"><h1>{success ? '专注成功' : failed ? '违约失败' : '预约允许取消'}</h1>
      {success ? <dl className="result-stats"><div><dt>本次计入时长</dt><dd>{result.creditedMinutes}</dd><span>分钟</span></div><div><dt>本次新增节点</dt><dd>{result.addedNodes ?? '未记录'}</dd><span>节点</span></div><div><dt>该链本轮节点</dt><dd>{result.resultNodes ?? state.rounds.find(round => round.id === result.roundId)?.nodes ?? '未记录'}</dd><span>节点</span></div></dl>
        : <p>{failed ? '本轮积累已归零。' : <>预约已取消<br />本次不累计，已有节点和余量保留。</>}</p>}
      <div className="actions">{failed && <Button onClick={newRound}>设置新一轮</Button>}<Button variant={failed ? 'secondary' : 'primary'} onClick={home}>返回首页</Button></div>
    </section>
  </main>;
}
