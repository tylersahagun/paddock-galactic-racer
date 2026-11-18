const databaseName = 'paddock-galactic-racer';
const kind = 'paddock_build_plans';
const metadata = new Set(['id', 'revision', 'revision_history', 'created_at', 'updated_at']);
let database;

function result(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openDatabase() {
  const request = indexedDB.open(databaseName, 1);
  request.onupgradeneeded = () => {
    for (const name of ['builds', 'tours']) request.result.createObjectStore(name, {keyPath: 'id'});
  };
  return result(request).then(db => {
    db.onversionchange = () => { db.close(); database = undefined; };
    return db;
  }, error => {
    database = undefined;
    throw new Error('Browser storage is unavailable.', {cause: error});
  });
}

async function withStore(name, mode, callback) {
  const db = await (database ||= openDatabase());
  const tx = db.transaction(name, mode);
  const complete = new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error ?? new Error('Browser storage did not save the changes.'));
  });
  // Attach the rejection handler immediately, including when a write request also fails.
  const work = (async () => {
    try {
      return await callback(tx.objectStore(name));
    } catch (error) {
      try { tx.abort(); } catch { /* A failed request may already have aborted it. */ }
      throw error;
    }
  })();
  const [value] = await Promise.all([work, complete]);
  return value;
}

const latest = record => record.history.at(-1);
const now = () => new Date().toISOString();
const label = name => name === 'builds' ? 'Build' : 'Tour';

function newRevision(id, body, previous) {
  const date = now();
  const content = Object.fromEntries(Object.entries(body).filter(([key]) => !metadata.has(key)));
  const created_at = previous?.created_at ?? date;
  const updated_at = previous && Date.parse(previous.updated_at) > Date.parse(date) ? previous.updated_at : date;
  return {...content, id, revision: (previous?.revision ?? 0) + 1, created_at, updated_at};
}

async function requireRecord(bucket, name, id) {
  const value = await result(bucket.get(id));
  if (!value) throw new Error(`${label(name)} could not be found in this browser.`);
  return value;
}

async function sortedRecords(bucket) {
  const records = await result(bucket.getAll());
  return records.sort((a, b) => Date.parse(latest(b).updated_at) - Date.parse(latest(a).updated_at));
}

export const store = {
  list(name) {
    return withStore(name, 'readonly', async bucket => (await sortedRecords(bucket)).map(latest));
  },
  get(name, id) {
    return withStore(name, 'readonly', async bucket => {
      const record = await requireRecord(bucket, name, id);
      const revision_history = record.history.map(({revision, updated_at}) => ({revision, updated_at}));
      return {...latest(record), revision_history};
    });
  },
  create(name, body) {
    return withStore(name, 'readwrite', async bucket => {
      const value = newRevision(crypto.randomUUID(), body);
      await result(bucket.add({id: value.id, history: [value]}));
      return value;
    });
  },
  update(name, id, body) {
    return withStore(name, 'readwrite', async bucket => {
      const record = await requireRecord(bucket, name, id);
      const previous = latest(record);
      if (body.revision !== previous.revision) {
        throw new Error(`${label(name)} changed in another window. Reopen its latest revision before saving.`);
      }
      const value = newRevision(id, body, previous);
      record.history.push(value);
      await result(bucket.put(record));
      return value;
    });
  },
  export(name) {
    return withStore(name, 'readonly', async bucket => {
      const records = await sortedRecords(bucket);
      const histories = Object.fromEntries(records.map(record => [record.id, record.history]));
      const envelope = {schema_version: 1, exported_at: now(), tours: records.map(latest), histories};
      if (name === 'builds') envelope.kind = kind;
      return envelope;
    });
  },
  import(name, histories) {
    return withStore(name, 'readwrite', async bucket => {
      for (const history of histories) {
        const id = history[0].id;
        if (await result(bucket.getKey(id)) !== undefined) {
          throw new Error(`This backup contains a ${label(name).toLowerCase()} already saved here. No records were imported.`);
        }
        await result(bucket.add({id, history}));
      }
      return histories.length;
    });
  },
};
