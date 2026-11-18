const sources = [
  'app/backup_validation.py', 'app/build_plans.py', 'app/browser_rules.py',
  'logic/advisor.py', 'logic/engine.py', 'logic/watchlist.py',
  'research/catalog.json', 'research/character-guides.json', 'research/effects.json', 'research/interactions.json',
];

let ready;
async function loadRules() {
  const indexURL = new URL('./vendor/pyodide/', import.meta.url);
  const {loadPyodide} = await import(new URL('pyodide.mjs', indexURL));
  const python = await loadPyodide({indexURL: indexURL.href});
  await Promise.all([
    python.loadPackage('pydecimal'),
    ...sources.map(async path => {
      const response = await fetch(new URL(path, import.meta.url));
      if (!response.ok) throw new Error(`Could not load rules file ${path}.`);
      const target = `/paddock/${path}`;
      python.FS.mkdirTree(target.slice(0, target.lastIndexOf('/')));
      python.FS.writeFile(target, await response.text());
    }),
  ]);
  return python.runPython(`
import sys
sys.path.insert(0, '/paddock')
from app.browser_rules import dispatch
dispatch
`);
}

self.onmessage = async ({data: {id, operation, input}}) => {
  try {
    ready ||= loadRules().catch(error => {
      ready = undefined;
      throw new Error('Paddock could not load the rules engine. Try again.', {cause: error});
    });
    const dispatch = await ready;
    const {value, error} = JSON.parse(dispatch(operation, JSON.stringify(input)));
    self.postMessage({id, value, error});
  } catch (error) {
    self.postMessage({id, error: error.message});
  }
};
