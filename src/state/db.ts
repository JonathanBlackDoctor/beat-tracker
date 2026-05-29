// 비트키퍼 — IndexedDB 영속 계층 (브리프 §3, §7)
// 오프라인 우선. 내보내기/가져오기 없음. 원음 저장 없음(세션은 파생 BPM 시계열만).

import type { Song, Setlist, Settings, Session } from '../types.ts';

const DB_NAME = 'beatkeeper';
const DB_VERSION = 1;

export const STORE = {
  songs: 'songs',
  setlists: 'setlists',
  settings: 'settings',
  sessions: 'sessions',
} as const;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE.songs)) db.createObjectStore(STORE.songs, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE.setlists))
        db.createObjectStore(STORE.setlists, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE.settings))
        db.createObjectStore(STORE.settings, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(STORE.sessions)) {
        const s = db.createObjectStore(STORE.sessions, { keyPath: 'id' });
        s.createIndex('bySong', 'songId', { unique: false });
        s.createIndex('byStarted', 'startedAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        t.oncomplete = () => resolve(req.result as T);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

export function dbGetAll<T>(store: string): Promise<T[]> {
  return tx<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>);
}

export function dbPut<T>(store: string, value: T): Promise<IDBValidKey> {
  return tx(store, 'readwrite', (s) => s.put(value as unknown as object));
}

export function dbDelete(store: string, key: IDBValidKey): Promise<undefined> {
  return tx(store, 'readwrite', (s) => s.delete(key) as IDBRequest<undefined>);
}

export function dbGet<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  return tx<T | undefined>(store, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>);
}

// --- 편의 래퍼 ---

interface SettingsRecord extends Settings {
  key: 'app';
}

export async function loadSettings(): Promise<Settings | null> {
  const rec = await dbGet<SettingsRecord>(STORE.settings, 'app');
  if (!rec) return null;
  const { key: _key, ...rest } = rec;
  return rest as Settings;
}

export function saveSettingsDb(settings: Settings): Promise<IDBValidKey> {
  return dbPut<SettingsRecord>(STORE.settings, { key: 'app', ...settings });
}

export const loadSongs = () => dbGetAll<Song>(STORE.songs);
export const saveSong = (s: Song) => dbPut(STORE.songs, s);
export const deleteSongDb = (id: string) => dbDelete(STORE.songs, id);

export const loadSetlists = () => dbGetAll<Setlist>(STORE.setlists);
export const saveSetlist = (s: Setlist) => dbPut(STORE.setlists, s);
export const deleteSetlistDb = (id: string) => dbDelete(STORE.setlists, id);

export const loadSessions = () => dbGetAll<Session>(STORE.sessions);
export const saveSessionDb = (s: Session) => dbPut(STORE.sessions, s);
export const deleteSessionDb = (id: string) => dbDelete(STORE.sessions, id);
