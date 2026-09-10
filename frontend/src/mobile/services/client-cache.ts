export type CachedJson<T> = {
  value: T;
  fingerprint: string;
};

export type CachedArtwork = {
  blob: Blob;
  fingerprint: string;
  etag?: string;
};

export type ClientCacheStatus = {
  usedBytes: number;
  itemCount: number;
  artworkCount: number;
  responseCount: number;
};

type JsonRecord = CachedJson<unknown> & {
  id: string;
  scope: string;
  updatedAt: number;
  sizeBytes: number;
};

type ArtworkRecord = CachedArtwork & {
  id: string;
  scope: string;
  updatedAt: number;
  accessedAt: number;
  sizeBytes: number;
};

const databaseName = 'rime-client-cache-v1';
const jsonStoreName = 'responses';
const artworkStoreName = 'artworks';
const maxResponsesPerScope = 200;
const maxArtworkBytesPerScope = 256 * 1024 * 1024;
const memoryJson = new Map<string, CachedJson<unknown>>();
const memoryArtwork = new Map<string, CachedArtwork>();
let databasePromise: Promise<IDBDatabase | undefined> | undefined;

export function jsonFingerprint(value: unknown): string {
  return JSON.stringify(value);
}

export function readCachedJsonSync<T>(scope: string, resourceKey: string): CachedJson<T> | undefined {
  return memoryJson.get(scopedKey(scope, resourceKey)) as CachedJson<T> | undefined;
}

export async function readCachedJson<T>(scope: string, resourceKey: string): Promise<CachedJson<T> | undefined> {
  const id = scopedKey(scope, resourceKey);
  const inMemory = memoryJson.get(id);
  if (inMemory) return inMemory as CachedJson<T>;

  const record = await readRecord<JsonRecord>(jsonStoreName, id);
  if (!record) return undefined;
  const cached = { value: record.value as T, fingerprint: record.fingerprint };
  memoryJson.set(id, cached as CachedJson<unknown>);
  return cached;
}

export async function writeCachedJson<T>(scope: string, resourceKey: string, value: T): Promise<void> {
  const id = scopedKey(scope, resourceKey);
  const fingerprint = jsonFingerprint(value);
  memoryJson.set(id, { value, fingerprint });
  await writeRecord<JsonRecord>(jsonStoreName, {
    id,
    scope,
    value,
    fingerprint,
    updatedAt: Date.now(),
    sizeBytes: new TextEncoder().encode(fingerprint).byteLength,
  });
  void pruneResponses(scope);
}

export function readCachedArtworkSync(scope: string, resourceKey: string): CachedArtwork | undefined {
  return memoryArtwork.get(scopedKey(scope, resourceKey));
}

export async function readCachedArtwork(scope: string, resourceKey: string): Promise<CachedArtwork | undefined> {
  const id = scopedKey(scope, resourceKey);
  const inMemory = memoryArtwork.get(id);
  if (inMemory) return inMemory;

  const record = await readRecord<ArtworkRecord>(artworkStoreName, id);
  if (!record) return undefined;
  const cached = { blob: record.blob, fingerprint: record.fingerprint, etag: record.etag };
  memoryArtwork.set(id, cached);
  void touchArtwork(record);
  return cached;
}

export async function writeCachedArtwork(scope: string, resourceKey: string, value: CachedArtwork): Promise<void> {
  const id = scopedKey(scope, resourceKey);
  memoryArtwork.set(id, value);
  const now = Date.now();
  await writeRecord<ArtworkRecord>(artworkStoreName, {
    id,
    scope,
    ...value,
    updatedAt: now,
    accessedAt: now,
    sizeBytes: value.blob.size,
  });
  void pruneArtwork(scope);
}

export async function getClientCacheStatus(scope: string): Promise<ClientCacheStatus> {
  const [responses, artworks] = await Promise.all([
    recordsForScope<JsonRecord>(jsonStoreName, scope),
    recordsForScope<ArtworkRecord>(artworkStoreName, scope),
  ]);
  return {
    usedBytes: sumBytes(responses) + sumBytes(artworks),
    itemCount: responses.length + artworks.length,
    artworkCount: artworks.length,
    responseCount: responses.length,
  };
}

export async function clearClientCache(scope: string): Promise<ClientCacheStatus> {
  for (const key of memoryJson.keys()) if (key.startsWith(scopePrefix(scope))) memoryJson.delete(key);
  for (const key of memoryArtwork.keys()) if (key.startsWith(scopePrefix(scope))) memoryArtwork.delete(key);

  const database = await openDatabase();
  if (database) {
    await Promise.all([
      deleteScopeRecords(database, jsonStoreName, scope),
      deleteScopeRecords(database, artworkStoreName, scope),
    ]);
  }
  return { usedBytes: 0, itemCount: 0, artworkCount: 0, responseCount: 0 };
}

function scopedKey(scope: string, resourceKey: string): string {
  return `${scopePrefix(scope)}${resourceKey}`;
}

function scopePrefix(scope: string): string {
  return `${scope}\u0000`;
}

function openDatabase(): Promise<IDBDatabase | undefined> {
  if (databasePromise) return databasePromise;
  if (typeof indexedDB === 'undefined') return Promise.resolve(undefined);

  databasePromise = new Promise((resolve) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(jsonStoreName)) {
        const store = database.createObjectStore(jsonStoreName, { keyPath: 'id' });
        store.createIndex('scope', 'scope');
      }
      if (!database.objectStoreNames.contains(artworkStoreName)) {
        const store = database.createObjectStore(artworkStoreName, { keyPath: 'id' });
        store.createIndex('scope', 'scope');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(undefined);
    request.onblocked = () => resolve(undefined);
  });
  return databasePromise;
}

async function readRecord<T>(storeName: string, id: string): Promise<T | undefined> {
  const database = await openDatabase();
  if (!database) return undefined;
  try {
    const transaction = database.transaction(storeName, 'readonly');
    return await requestResult<T | undefined>(transaction.objectStore(storeName).get(id));
  } catch {
    return undefined;
  }
}

async function writeRecord<T>(storeName: string, record: T): Promise<void> {
  const database = await openDatabase();
  if (!database) return;
  try {
    const transaction = database.transaction(storeName, 'readwrite');
    const complete = transactionComplete(transaction);
    transaction.objectStore(storeName).put(record);
    await complete;
  } catch {
    // In-memory caching remains available when persistent storage is unavailable.
  }
}

async function recordsForScope<T>(storeName: string, scope: string): Promise<T[]> {
  const database = await openDatabase();
  if (!database) return [];
  try {
    const transaction = database.transaction(storeName, 'readonly');
    return await requestResult<T[]>(transaction.objectStore(storeName).index('scope').getAll(scope));
  } catch {
    return [];
  }
}

async function deleteScopeRecords(database: IDBDatabase, storeName: string, scope: string): Promise<void> {
  const transaction = database.transaction(storeName, 'readwrite');
  const complete = transactionComplete(transaction);
  const store = transaction.objectStore(storeName);
  const keys = await requestResult<IDBValidKey[]>(store.index('scope').getAllKeys(scope));
  keys.forEach((key) => store.delete(key));
  await complete;
}

async function pruneResponses(scope: string): Promise<void> {
  const records = await recordsForScope<JsonRecord>(jsonStoreName, scope);
  if (records.length <= maxResponsesPerScope) return;
  records.sort((left, right) => left.updatedAt - right.updatedAt);
  const ids = records.slice(0, records.length - maxResponsesPerScope).map((record) => record.id);
  ids.forEach((id) => memoryJson.delete(id));
  await deleteRecords(jsonStoreName, ids);
}

async function pruneArtwork(scope: string): Promise<void> {
  const records = await recordsForScope<ArtworkRecord>(artworkStoreName, scope);
  let usedBytes = sumBytes(records);
  if (usedBytes <= maxArtworkBytesPerScope) return;
  records.sort((left, right) => left.accessedAt - right.accessedAt);
  const ids: string[] = [];
  for (const record of records) {
    if (usedBytes <= maxArtworkBytesPerScope) break;
    ids.push(record.id);
    usedBytes -= record.sizeBytes;
  }
  ids.forEach((id) => memoryArtwork.delete(id));
  await deleteRecords(artworkStoreName, ids);
}

async function deleteRecords(storeName: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const database = await openDatabase();
  if (!database) return;
  try {
    const transaction = database.transaction(storeName, 'readwrite');
    const complete = transactionComplete(transaction);
    const store = transaction.objectStore(storeName);
    ids.forEach((id) => store.delete(id));
    await complete;
  } catch {
    // Cache pruning is best effort.
  }
}

async function touchArtwork(record: ArtworkRecord): Promise<void> {
  await writeRecord<ArtworkRecord>(artworkStoreName, { ...record, accessedAt: Date.now() });
}

function sumBytes(records: Array<{ sizeBytes: number }>): number {
  return records.reduce((total, record) => total + record.sizeBytes, 0);
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
