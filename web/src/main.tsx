import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { IndexedDbRepository, databaseName } from './data/indexed-db';
import { systemClock } from './domain/time';
import { AccountClock } from './data/account-clock';
import { CloudRepository } from './data/cloud-repository';
import './shared/styles.css';
import './shared/chains.css';
import './shared/tasks.css';

async function start() {
  let clock = systemClock;
  if (__TEST_BUILD__) {
    const { installTestTools } = await import('./testing/tools');
    clock = installTestTools();
  }
  const calibratedClock = new AccountClock(clock);
  const repository = new CloudRepository(new IndexedDbRepository(databaseName(__TEST_BUILD__), calibratedClock), calibratedClock);
  if (__TEST_BUILD__) { const { bindTestRepository } = await import('./testing/tools'); bindTestRepository(repository); }
  const network = () => repository.networkChanged(navigator.onLine);
  window.addEventListener('online', network); window.addEventListener('offline', network);
  createRoot(document.getElementById('root')!).render(<App repository={repository} clock={calibratedClock} />);
}
void start();
