import { ApiError } from './errors.ts';
/** Pure protocol helper for the later Repository adapter; no timers or network side effects. */
export interface TimeSample { sentWall:number;receivedWall:number;sentMonotonic:number;receivedMonotonic:number;serverReceivedAt:number;serverSentAt:number }
export function estimateTime(sample:TimeSample){
 const {sentWall,receivedWall,sentMonotonic,receivedMonotonic,serverReceivedAt,serverSentAt}=sample;
 if(!Object.values(sample).every(Number.isFinite))throw new ApiError(400,'INVALID_TIME_SAMPLE','无效校时样本');
 const elapsed=receivedMonotonic-sentMonotonic,processing=serverSentAt-serverReceivedAt;
 if(elapsed<0||processing<0||elapsed<processing||elapsed>10000||Math.abs((receivedWall-sentWall)-elapsed)>1000)throw new ApiError(400,'INVALID_TIME_SAMPLE','校时延迟过大或本机时间跳变，请重试');
 const network=elapsed-processing,uncertaintyMs=network/2;
 const serverAtReceipt=serverSentAt+uncertaintyMs;
 return {serverAtReceipt,anchorMonotonic:receivedMonotonic,offsetMs:serverAtReceipt-receivedWall,uncertaintyMs,roundTripMs:elapsed};
}
export function calibratedNow(anchor:ReturnType<typeof estimateTime>,monotonic:number){
 if(!Number.isFinite(monotonic)||monotonic<anchor.anchorMonotonic)throw new ApiError(400,'CLOCK_RECALIBRATION_REQUIRED','单调时钟已重置，请重新校时');
 return anchor.serverAtReceipt+monotonic-anchor.anchorMonotonic;
}
