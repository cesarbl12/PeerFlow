// js/repos/idb-client.js — IndexedDB wrapper
const DB_NAME = 'peerflow_db';
const DB_VERSION = 2;

const STORES = {
  articles: { keyPath: 'id', indexes: [{ name: 'status', keyPath: 'status' }] },
  reviewers: { keyPath: 'id' },
  assignments: { keyPath: 'id', indexes: [{ name: 'articleId', keyPath: 'articleId' }] },
  reviews: { keyPath: 'id', indexes: [{ name: 'articleId', keyPath: 'articleId' }, { name: 'reviewerId', keyPath: 'reviewerId' }] },
  sync_queue: { keyPath: 'id', indexes: [{ name: 'status', keyPath: 'status' }] }
};

let dbInstance = null;

export async function openDB() {
  if (dbInstance) return dbInstance;
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      Object.entries(STORES).forEach(([storeName, config]) => {
        if (!db.objectStoreNames.contains(storeName)) {
          const store = db.createObjectStore(storeName, { keyPath: config.keyPath });
          config.indexes?.forEach(idx => store.createIndex(idx.name, idx.keyPath));
        }
      });
    };
    request.onsuccess = (e) => { dbInstance = e.target.result; resolve(dbInstance); };
    request.onerror = (e) => reject(e.target.error);
  });
}

export async function dbGet(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function dbPut(storeName, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).put(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function dbDelete(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function dbGetAll(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function dbGetByIndex(storeName, indexName, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const idx = tx.objectStore(storeName).index(indexName);
    const req = idx.getAll(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function generateId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
