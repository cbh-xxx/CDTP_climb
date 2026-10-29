import { createContext, useContext } from 'react';
import { systemClock } from '../domain/time';
export const ClockContext = createContext(systemClock);
export const useClock = () => useContext(ClockContext);
