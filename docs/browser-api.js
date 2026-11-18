import {store} from './browser-store.js';

let worker;
let nextRequest = 0;
const pending = new Map();

function resetWorker(message) {
  worker?.terminate();
  worker = undefined;
  for (const {reject, timer} of pending.values()) {
    clearTimeout(timer);
    reject(new Error(message));
  }
  pending.clear();
}

function runRules(operation, input) {
  if (!worker) {
    worker = new Worker(new URL('./rules-worker.js', import.meta.url), {type: 'module'});
    worker.onmessage = ({data}) => {
      const request = pending.get(data.id);
      if (!request) return;
      pending.delete(data.id);
      clearTimeout(request.timer);
      if (data.error) request.reject(new Error(data.error));
      else request.resolve(data.value);
    };
    worker.onerror = () => resetWorker('Paddock could not start the rules engine. Try again.');
  }
  return new Promise((resolve, reject) => {
    const id = ++nextRequest;
    const timer = setTimeout(() => resetWorker('The rules engine took too long to respond. Try again.'), 45000);
    pending.set(id, {resolve, reject, timer});
    worker.postMessage({id, operation, input});
  });
}

async function getCatalog() {
  const response = await fetch(new URL('./research/reference.json', import.meta.url));
  if (!response.ok) throw new Error('The parts and abilities catalog could not load.');
  return response.json();
}

export async function api(path, method = 'GET', body) {
  if (path === '/api/catalog') return getCatalog();

  if (method === 'POST' && path === '/api/analyze') return runRules('analyze', body);
  if (method === 'POST' && path === '/api/watchlist') {
    const {tour_id, revision} = body;
    const current = await store.get('tours', tour_id);
    if (current.revision !== revision) throw new Error('Tour changed. Reopen it to refresh the watchlist.');
    if (current.status === 'completed') throw new Error('Start a fresh tour to prepare a new watchlist.');
    return runRules('watchlist', {tour_id, revision, state: current.build});
  }

  const isBuild = path === '/api/builds' || path.startsWith('/api/builds/');
  const type = isBuild ? 'builds' : 'tours';
  const root = `/api/${type}`;
  if (method === 'GET') {
    if (path === root) return {[type]: await store.list(type)};
    if (path === '/api/export' || path === '/api/builds/export') return store.export(type);
    if (path.startsWith(root + '/')) return store.get(type, path.slice(root.length + 1));
  }

  if (method === 'POST' && (path === '/api/import' || path === '/api/builds/import')) {
    const histories = await runRules(isBuild ? 'import_builds' : 'import_tours', body);
    return {imported: await store.import(type, histories)};
  }

  if (method === 'POST' && path === root) {
    const record = isBuild ? await runRules('validate_plan', body) : body;
    return store.create(type, record);
  }
  if (method === 'PUT' && path.startsWith(root + '/')) {
    const record = isBuild ? await runRules('validate_plan', body) : body;
    return store.update(type, path.slice(root.length + 1), record);
  }

  throw new Error('This action is unavailable in the browser edition.');
}
