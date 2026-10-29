import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { IndexedDbRepository, databaseName } from './data/indexed-db';
import { systemClock } from './domain/time';
import './shared/styles.css';
import './shared/chains.css';
import './shared/tasks.css';

async function start() {
  let clock = systemClock;
  if (__TEST_BUILD__) {
    const { installTestTools } = await import('./testing/tools');
    clock = installTestTools();
  }
  const repository = new IndexedDbRepository(databaseName(__TEST_BUILD__), clock);
  createRoot(document.getElementById('root')!).render(<App repository={repository} clock={clock} />);
}
void start();
