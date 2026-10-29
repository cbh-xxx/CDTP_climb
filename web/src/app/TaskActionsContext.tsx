import { createContext, useContext } from 'react';
export interface TaskActions { prepare(chainId: string, reserved: boolean): void; returnTask(): void }
export const TaskActionsContext = createContext<TaskActions | null>(null);
export function useTaskActions() {
  const actions = useContext(TaskActionsContext);
  if (!actions) throw new Error('任务导航尚未就绪');
  return actions;
}
