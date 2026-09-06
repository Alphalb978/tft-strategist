type Writer = (key: string, value: unknown) => Promise<void>;
type Reader = (key: string) => Promise<unknown>;
const object = (v: unknown): v is Record<string, unknown> =>
  Boolean(v && typeof v === 'object' && !Array.isArray(v));
/** Meta bundles retain only a content-addressed reference to their large intelligence model. */
export async function referenceDerived(value: unknown, write: Writer): Promise<unknown> {
  if (!object(value)) return value;
  if (object(value.meta)) return { ...value, meta: await referenceDerived(value.meta, write) };
  if (object(value.intelligence) && typeof value.intelligence.fingerprint === 'string') {
    const intelligenceRef = `intelligence-model:${value.intelligence.fingerprint}`;
    await write(intelligenceRef, value.intelligence);
    const { intelligence, ...rest } = value;
    void intelligence;
    return { ...rest, intelligenceRef };
  }
  return value;
}
export async function hydrateDerived(value: unknown, read: Reader): Promise<unknown> {
  if (!object(value)) return value;
  if (object(value.meta)) return { ...value, meta: await hydrateDerived(value.meta, read) };
  if (
    typeof value.intelligenceRef === 'string' &&
    value.intelligenceRef.startsWith('intelligence-model:')
  ) {
    const { intelligenceRef, ...rest } = value;
    const intelligence = await read(intelligenceRef);
    return intelligence ? { ...rest, intelligence } : rest;
  }
  return value;
}
export const largeDerivedKey = (key: string) =>
  key.startsWith('knowledge:') || key.startsWith('intelligence-model:');
let db: Promise<IDBDatabase> | undefined;
function database() {
  return (db ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('strategist-derived-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('values');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      db = undefined;
      reject(request.error);
    };
  }));
}
export async function readLargeDerived(key: string): Promise<unknown> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction('values').objectStore('values').get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}
export async function writeLargeDerived(key: string, value: unknown) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('values', 'readwrite');
    tx.objectStore('values').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
