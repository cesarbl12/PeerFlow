// js/app.js — Main application entry point
import { renderDashboard, renderArticleForm, renderAssignView, renderReviewForm, renderAuthorStatus, renderReviewersView } from './ui/views.js';
import { syncNow, scheduleSync, onSyncEvent, isOnline, checkServerConnection, getPendingCount } from './sync/sync-service.js';
import { SyncQueueRepo } from './repos/repos.js';

// ── NAVIGATION ──
let currentView = 'dashboard';
let currentParams = {};
let renderLock = false;   // FIX: prevents concurrent renders that cause duplicates
let pendingNav = null;    // FIX: queues any navigation that arrives while rendering

export function navigateTo(view, params = {}) {
  currentView = view;
  currentParams = params;

  // Update nav button state immediately (visual feedback)
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });

  if (renderLock) {
    // Don't stack renders — just remember the latest requested destination
    pendingNav = { view, params };
    return;
  }
  _doRender();
}

async function _doRender() {
  if (renderLock) return;
  renderLock = true;
  pendingNav = null;

  try {
    const container = document.getElementById('viewContainer');
    if (!container) return;

    // Stamp the container so in-flight async view code knows it's been replaced
    const stamp = Date.now() + Math.random();
    container._navStamp = stamp;

    switch (currentView) {
      case 'dashboard':     await renderDashboard(container);                   break;
      case 'article-form':  await renderArticleForm(container, currentParams);  break;
      case 'assign':        await renderAssignView(container, currentParams);   break;
      case 'review':        await renderReviewForm(container, currentParams);   break;
      case 'author-status': await renderAuthorStatus(container, currentParams); break;
      case 'reviewers':     await renderReviewersView(container);               break;
      default:              await renderDashboard(container);
    }
  } finally {
    renderLock = false;
    // If a navigation was requested while we were rendering, process it now
    if (pendingNav) {
      const { view, params } = pendingNav;
      pendingNav = null;
      navigateTo(view, params);
    }
  }
}

// ── TOAST ──
export function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = { success: '✓', error: '✗', info: 'ℹ', warning: '⚠' };
  toast.innerHTML = `<span>${icons[type] || 'ℹ'}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'fadeOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ── DATE HELPERS ──
export function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}
export function daysUntil(ts) {
  const diff = ts - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

// ── SYNC UI ──
async function updateSyncBadge() {
  const badge = document.getElementById('syncBadge');
  const dot = badge?.querySelector('.sync-dot');
  const label = document.getElementById('syncLabel');
  if (!dot || !label) return;

  const pending = await getPendingCount();
  const online = isOnline();

  if (!online) {
    dot.className = 'sync-dot offline';
    label.textContent = 'Offline';
    document.getElementById('offlineBar')?.classList.remove('hidden');
  } else if (pending > 0) {
    dot.className = 'sync-dot pending';
    label.textContent = `${pending} pendientes`;
    document.getElementById('offlineBar')?.classList.add('hidden');
  } else {
    dot.className = 'sync-dot online';
    label.textContent = 'Sincronizado';
    document.getElementById('offlineBar')?.classList.add('hidden');
  }
}

async function updateSyncPanel() {
  const list = document.getElementById('syncQueueList');
  if (!list) return;
  const pending = await SyncQueueRepo.getPending();
  if (pending.length === 0) {
    list.innerHTML = '<div class="empty-sync">✓ No hay operaciones pendientes</div>';
    return;
  }
  list.innerHTML = pending.map(item => `
    <div class="sync-queue-item">
      <span class="op-type">${item.entity}</span>
      <span>${item.operation} · ${new Date(item.createdAt).toLocaleTimeString('es-MX')}</span>
    </div>
  `).join('');
}

// ── INIT ──
async function init() {
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('./sw.js'); }
    catch (e) { console.warn('SW registration failed', e); }
  }

  // Initial render
  await _doRender();

  // Nav buttons — use navigateTo so the render lock is respected
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.view));
  });

  const syncBtn = document.getElementById('syncBtn');
  syncBtn?.addEventListener('click', async () => {
    const serverOk = await checkServerConnection();
    if (!serverOk) {
      showToast('Servidor no disponible. Los datos se guardan localmente.', 'warning');
      return;
    }
    syncBtn.classList.add('spinning');
    const result = await syncNow();
    syncBtn.classList.remove('spinning');
    if (result.synced > 0) showToast(`✓ ${result.synced} operación(es) sincronizadas`, 'success');
    if (result.failed > 0) showToast(`⚠ ${result.failed} operación(es) fallidas`, 'error');
    if (result.synced === 0 && result.failed === 0) showToast('Todo está sincronizado', 'info');
    await updateSyncBadge();
    await updateSyncPanel();
  });

  document.getElementById('syncBadge')?.addEventListener('click', async () => {
    const panel = document.getElementById('syncPanel');
    panel?.classList.toggle('hidden');
    await updateSyncPanel();
  });
  document.getElementById('closeSyncPanel')?.addEventListener('click', () => {
    document.getElementById('syncPanel')?.classList.add('hidden');
  });
  document.getElementById('forceSyncBtn')?.addEventListener('click', async () => {
    document.getElementById('syncPanel')?.classList.add('hidden');
    syncBtn?.click();
  });

  onSyncEvent('status-change', async ({ online }) => {
    await updateSyncBadge();
    if (online) scheduleSync(1000);
  });
  onSyncEvent('sync-complete', async ({ synced }) => {
    await updateSyncBadge();
    if (synced > 0) showToast(`✓ ${synced} cambio(s) sincronizados con el servidor`, 'success');
  });
  onSyncEvent('sync-error', ({ error }) => {
    showToast(`Error de sincronización: ${error}`, 'error');
  });

  await updateSyncBadge();
  scheduleSync(3000);

  setInterval(async () => {
    await updateSyncBadge();
    scheduleSync();
  }, 30000);
}

init().catch(console.error);
