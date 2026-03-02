// js/sync/sync-service.js — Offline-first synchronization service
import { SyncQueueRepo } from '../repos/repos.js';

const API_BASE = 'http://localhost:3001/api';
let syncInProgress = false;
let onlineStatus = navigator.onLine;

// ── EVENT EMITTER ──
const listeners = {};
export function onSyncEvent(event, cb) {
  if (!listeners[event]) listeners[event] = [];
  listeners[event].push(cb);
}
function emit(event, data) {
  (listeners[event] || []).forEach(cb => cb(data));
}

// ── ONLINE / OFFLINE DETECTION ──
window.addEventListener('online', () => {
  onlineStatus = true;
  emit('status-change', { online: true });
  scheduleSync();
});
window.addEventListener('offline', () => {
  onlineStatus = false;
  emit('status-change', { online: false });
});

export function isOnline() { return onlineStatus; }

// ── API ENDPOINTS MAP ──
const ENDPOINT_MAP = {
  article: { create: 'POST /articles', update: 'PATCH /articles/:id' },
  reviewer: { create: 'POST /reviewers', delete: 'DELETE /reviewers/:id' },
  assignment: { create: 'POST /assignments' },
  review: { draft: 'PUT /reviews/:id', submit: 'POST /reviews/:id/submit' }
};

async function apiFetch(method, path, body) {
  const url = `${API_BASE}${path}`;
  const resp = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ message: resp.statusText }));
    throw new Error(err.message || `HTTP ${resp.status}`);
  }
  return resp.json();
}

// ── PROCESS SINGLE QUEUE ITEM ──
async function processSyncItem(item) {
  const { entity, operation, entityId, data } = item;
  try {
    switch (`${entity}:${operation}`) {
      case 'article:create': await apiFetch('POST', '/articles', data); break;
      case 'article:update': await apiFetch('PATCH', `/articles/${entityId}`, data); break;
      case 'reviewer:create': await apiFetch('POST', '/reviewers', data); break;
      case 'reviewer:delete': await apiFetch('DELETE', `/reviewers/${entityId}`); break;
      case 'assignment:create': await apiFetch('POST', '/assignments', data); break;
      case 'review:draft': await apiFetch('PUT', `/reviews/${entityId}`, data); break;
      case 'review:submit': await apiFetch('POST', `/reviews/${entityId}/submit`, data); break;
      default: console.warn(`Unknown sync operation: ${entity}:${operation}`);
    }
    await SyncQueueRepo.markSynced(item.id);
    return true;
  } catch (err) {
    await SyncQueueRepo.markFailed(item.id, err);
    throw err;
  }
}

// ── MAIN SYNC FUNCTION ──
export async function syncNow() {
  if (!onlineStatus || syncInProgress) return { synced: 0, failed: 0 };
  syncInProgress = true;
  emit('sync-start', {});

  let synced = 0, failed = 0;
  try {
    const pending = await SyncQueueRepo.getPending();
    if (pending.length === 0) {
      emit('sync-complete', { synced: 0, failed: 0, message: 'Nada que sincronizar' });
      return { synced: 0, failed: 0 };
    }

    for (const item of pending) {
      try {
        await processSyncItem(item);
        synced++;
        emit('item-synced', { item, synced, total: pending.length });
      } catch {
        failed++;
      }
    }
    await SyncQueueRepo.clearSynced();
    emit('sync-complete', { synced, failed });
  } catch (err) {
    emit('sync-error', { error: err.message });
  } finally {
    syncInProgress = false;
  }
  return { synced, failed };
}

// ── AUTO SYNC SCHEDULER ──
let syncTimer = null;
export function scheduleSync(delayMs = 2000) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { if (onlineStatus) syncNow(); }, delayMs);
}

// Check server connectivity
export async function checkServerConnection() {
  try {
    const resp = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(3000) });
    return resp.ok;
  } catch {
    return false;
  }
}

// Get pending count
export async function getPendingCount() {
  const pending = await SyncQueueRepo.getPending();
  return pending.length;
}
