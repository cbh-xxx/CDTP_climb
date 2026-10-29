import type { ChainState } from '../domain/models';
import { totalNodes } from '../domain/chains';
import { reachedLevel } from '../domain/climb';
const peaks = [
  ['米斯林山脉最高峰','mithrim-landscape-1440'], ['希拉里山地H1峰','02-hillary-montes-h1'], ['富士山','03-mount-fuji'], ['阿胡纳山','04-ahuna-mons'], ['冒纳罗亚山','05-mauna-loa'], ['冒纳凯阿山','06-mauna-kea'], ['马特洪峰','07-matterhorn'], ['哈德利山','08-mons-hadley'], ['莱特山','09-wright-mons'], ['勃朗峰','10-mont-blanc'], ['皮卡德山','11-piccard-mons'], ['夏普山','12-mount-sharp'], ['乌呼鲁峰','13-uhuru-peak'], ['穆顿山','14-mons-mouton'], ['德纳里山','15-denali'], ['丹增T2峰','16-tenzing-montes-t2'], ['阿尔巴山','17-alba-mons'], ['阿空加瓜山','18-aconcagua'], ['玛特山','19-maat-mons'], ['乔戈里峰','20-k2'], ['珠穆朗玛峰','21-everest'], ['尤比亚山主峰','22-euboea-montes'], ['麦克斯韦山最高峰','23-maxwell-montes'], ['埃律西昂山','24-elysium-mons'], ['帕沃尼斯山','25-pavonis-mons'], ['博奥索利山南峰','26-boosaule-montes-south'], ['阿尔西亚山','27-arsia-mons'], ['阿斯克雷乌斯山','28-ascraeus-mons'], ['奥林匹斯山','29-olympus-mons'], ['雷亚西尔维亚峰','30-rheasilvia-central-peak'],
] as const;
const imagePath = (file: string) => `/images/mountains/1440x1024/${file}.png`;
export function peakImage(level: number): string {
  const peak = peaks[level - 1];
  if (!Number.isInteger(level) || !peak) throw new Error('山峰等级须为1—30');
  return imagePath(peak[1]);
}
export function sceneForLevel(level: number) {
  if (!Number.isInteger(level) || level < 0 || level > peaks.length) throw new Error('展示等级须为0—30');
  const peak = peaks[Math.max(0, level - 1)]!;
  const image = level === 0 ? imagePath('state-before-first') : level === peaks.length ? imagePath('state-all-summits') : peakImage(level);
  return { level, name: level === 0 ? '尚未登顶' : peak[0], image };
}
export function mountainScene(state: ChainState) {
  return sceneForLevel(reachedLevel(totalNodes(state)));
}
