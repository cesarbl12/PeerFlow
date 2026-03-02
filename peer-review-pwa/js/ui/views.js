// js/ui/views.js — All view renderers
import { ArticleService, AssignmentService, ReviewService, ReviewerService, StatusPolicy } from '../services/services.js';
import { SyncQueueRepo } from '../repos/repos.js';
import { showToast, navigateTo, formatDate, daysUntil } from '../app.js';

// ── DASHBOARD VIEW ──
export async function renderDashboard(container) {
  const tpl = document.getElementById('tpl-dashboard');
  container.innerHTML = '';
  container.appendChild(tpl.content.cloneNode(true));

  // Render token: cancels stale async callbacks if the view has changed
  const renderToken = Date.now() + Math.random();
  container._renderToken = renderToken;

  const filterSelect = container.querySelector('#filterStatus');
  const loadDemoBtn = container.querySelector('#loadDemoBtn');

  async function loadArticles() {
    const status = filterSelect?.value || '';
    const articles = await ArticleService.getAll(status);

    // Bail if this container has been replaced by a newer render
    if (container._renderToken !== renderToken) return;

    const grid = container.querySelector('#articleGrid');
    const emptyState = container.querySelector('#emptyState');
    if (!grid) return;

    // Always clear before populating to prevent duplicates
    grid.innerHTML = '';

    if (articles.length === 0) {
      emptyState?.classList.remove('hidden');
      return;
    }
    emptyState?.classList.add('hidden');

    const pending = await SyncQueueRepo.getPending();
    if (container._renderToken !== renderToken) return;
    const pendingIds = new Set(pending.map(p => p.entityId));

    for (const article of articles) {
      if (container._renderToken !== renderToken) return;
      const card = await buildArticleCard(article, pendingIds);
      grid.appendChild(card);
    }
  }

  filterSelect?.addEventListener('change', loadArticles);

  loadDemoBtn?.addEventListener('click', async () => {
    await loadDemoData();
    await loadArticles();
    showToast('Datos demo cargados', 'success');
  });

  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    if (action === 'assign') navigateTo('assign', { articleId: id });
    if (action === 'review') navigateTo('review', { articleId: id, reviewerId: 'self' });
    if (action === 'view') navigateTo('author-status', { articleId: id });
    if (action === 'edit') navigateTo('article-form', { articleId: id });
  });

  container.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-nav]');
    if (btn) navigateTo(btn.dataset.nav);
  });

  await loadArticles();
}

async function buildArticleCard(article, pendingIds) {
  const card = document.createElement('div');
  card.className = 'article-card';
  card.dataset.status = article.status;

  const assignments = await AssignmentService.getByArticle(article.id).catch(() => []);
  const reviews = await ReviewService.getSubmittedByArticle(article.id).catch(() => []);
  const progress = assignments.length > 0 ? Math.round((reviews.length / assignments.length) * 100) : 0;

  const dueDate = assignments[0]?.dueAt;
  const overdue = dueDate && dueDate < Date.now() && article.status === 'in-review';
  const daysLeft = dueDate ? daysUntil(dueDate) : null;

  const hasPendingSync = pendingIds.has(article.id);

  card.innerHTML = `
    ${hasPendingSync ? '<div class="pending-sync-indicator" title="Pendiente de sincronización"></div>' : ''}
    <div class="card-header">
      <div class="card-title">${escHtml(article.title)}</div>
      <span class="status-badge ${StatusPolicy.statusClass(article.status)}">${StatusPolicy.statusLabel(article.status)}</span>
    </div>
    <div class="card-author">👤 ${escHtml(article.author)}</div>
    <div class="card-meta">
      <span>📅 ${formatDate(article.createdAt)}</span>
      ${dueDate ? `<span class="due-date ${overdue ? 'overdue' : ''}">⏱ ${overdue ? 'Atrasado' : `${daysLeft}d restantes`}</span>` : ''}
      <span>📝 ${reviews.length}/${assignments.length} revisiones</span>
    </div>
    ${assignments.length > 0 ? `
      <div class="card-progress">
        <div class="progress-bar"><div class="progress-fill" style="width:${progress}%"></div></div>
        <span class="progress-label">${progress}%</span>
      </div>
    ` : ''}
    <div class="card-actions">
      ${article.status === 'received' ? `<button class="btn-card primary" data-action="assign" data-id="${article.id}">Asignar revisores</button>` : ''}
      ${article.status === 'in-review' ? `<button class="btn-card primary" data-action="review" data-id="${article.id}">Revisar</button>` : ''}
      <button class="btn-card" data-action="view" data-id="${article.id}">Ver detalle</button>
      <button class="btn-card" data-action="edit" data-id="${article.id}">Editar</button>
    </div>
  `;
  return card;
}

// ── ARTICLE FORM VIEW ──
export async function renderArticleForm(container, params = {}) {
  const tpl = document.getElementById('tpl-article-form');
  container.innerHTML = '';
  container.appendChild(tpl.content.cloneNode(true));

  const form = container.querySelector('#articleForm');
  const titleInput = container.querySelector('#artTitle');
  const authorInput = container.querySelector('#artAuthor');
  const emailInput = container.querySelector('#artEmail');
  const abstractInput = container.querySelector('#artAbstract');
  const keywordsInput = container.querySelector('#artKeywords');
  const dateInput = container.querySelector('#artDate');
  const articleIdInput = container.querySelector('#articleId');

  // Set default date
  dateInput.value = new Date().toISOString().split('T')[0];

  // Load existing article if editing
  if (params.articleId) {
    const article = await ArticleService.getById(params.articleId);
    if (article) {
      container.querySelector('#formTitle').textContent = 'Editar Artículo';
      articleIdInput.value = article.id;
      titleInput.value = article.title;
      authorInput.value = article.author;
      if (emailInput) emailInput.value = article.email || '';
      if (abstractInput) abstractInput.value = article.abstract || '';
      if (keywordsInput) keywordsInput.value = article.keywords || '';
      if (dateInput) dateInput.value = new Date(article.createdAt).toISOString().split('T')[0];
    }
  }

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const data = {
        id: articleIdInput.value || undefined,
        title: titleInput.value.trim(),
        author: authorInput.value.trim(),
        email: emailInput?.value.trim() || '',
        abstract: abstractInput?.value.trim() || '',
        keywords: keywordsInput?.value.trim() || ''
      };
      await ArticleService.save(data);
      showToast('Artículo guardado correctamente', 'success');
      navigateTo('dashboard');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  container.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-nav]');
    if (btn) navigateTo(btn.dataset.nav);
  });
}

// ── ASSIGN VIEW ──
export async function renderAssignView(container, params = {}) {
  const tpl = document.getElementById('tpl-assign-view');
  container.innerHTML = '';
  container.appendChild(tpl.content.cloneNode(true));

  const article = await ArticleService.getById(params.articleId);
  if (!article) { showToast('Artículo no encontrado', 'error'); navigateTo('dashboard'); return; }

  const summary = container.querySelector('#assignArticleSummary');
  summary.innerHTML = `<h3>${escHtml(article.title)}</h3><div class="meta">Por ${escHtml(article.author)} · ${formatDate(article.createdAt)}</div>`;

  container.querySelector('#assignArticleId').value = article.id;

  // Set default due date (21 days)
  const dueInput = container.querySelector('#assignDueDate');
  const defaultDue = new Date();
  defaultDue.setDate(defaultDue.getDate() + 21);
  dueInput.value = defaultDue.toISOString().split('T')[0];
  dueInput.min = new Date().toISOString().split('T')[0];

  // Load reviewers
  const reviewers = await ReviewerService.getAll();
  const checkboxContainer = container.querySelector('#reviewerCheckboxes');
  if (reviewers.length === 0) {
    checkboxContainer.innerHTML = `<p style="color:var(--text-muted);font-size:12px;">No hay revisores. <a href="#" data-nav="reviewers" style="color:var(--accent)">Agregar revisores primero</a></p>`;
  } else {
    reviewers.forEach(r => {
      const card = document.createElement('label');
      card.className = 'reviewer-check-card';
      card.innerHTML = `
        <input type="checkbox" name="reviewer" value="${r.id}" />
        <div class="reviewer-info">
          <div class="reviewer-name">${escHtml(r.name)}</div>
          <div class="reviewer-specialty">${escHtml(r.email)}${r.specialty ? ' · ' + escHtml(r.specialty) : ''}</div>
        </div>
      `;
      checkboxContainer.appendChild(card);
    });
  }

  const form = container.querySelector('#assignForm');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const checked = [...form.querySelectorAll('input[name="reviewer"]:checked')].map(i => i.value);
    const dueAt = dueInput.value;
    try {
      await AssignmentService.assign(article.id, checked, dueAt);
      showToast('Revisores asignados. Artículo en revisión.', 'success');
      navigateTo('dashboard');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  container.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-nav]');
    if (btn) navigateTo(btn.dataset.nav);
  });
}

// ── REVIEW FORM VIEW ──
export async function renderReviewForm(container, params = {}) {
  const tpl = document.getElementById('tpl-review-form');
  container.innerHTML = '';
  container.appendChild(tpl.content.cloneNode(true));

  const article = await ArticleService.getById(params.articleId);
  if (!article) { showToast('Artículo no encontrado', 'error'); navigateTo('dashboard'); return; }

  const summary = container.querySelector('#reviewArticleSummary');
  summary.innerHTML = `<h3>${escHtml(article.title)}</h3><div class="meta">Por ${escHtml(article.author)}</div>`;

  const reviewerId = params.reviewerId || 'self';
  const draft = await ReviewService.loadOrCreate(params.articleId, reviewerId);

  // Fill form
  container.querySelector('#reviewId').value = draft.id || '';
  container.querySelector('#reviewArticleId').value = params.articleId;
  container.querySelector('#reviewerId').value = reviewerId;
  container.querySelector('#reviewStrengths').value = draft.strengths || '';
  container.querySelector('#reviewWeaknesses').value = draft.weaknesses || '';
  container.querySelector('#reviewComments').value = draft.comments || '';
  if (draft.recommendation) {
    const radio = container.querySelector(`input[name="recommendation"][value="${draft.recommendation}"]`);
    if (radio) radio.checked = true;
  }

  const statusBadge = container.querySelector('#reviewStatusBadge');
  if (draft.status === 'submitted') {
    statusBadge.textContent = 'Enviada';
    statusBadge.className = 'badge badge-submitted';
  }

  function gatherData() {
    return {
      id: container.querySelector('#reviewId').value || undefined,
      articleId: container.querySelector('#reviewArticleId').value,
      reviewerId: container.querySelector('#reviewerId').value,
      strengths: container.querySelector('#reviewStrengths').value,
      weaknesses: container.querySelector('#reviewWeaknesses').value,
      comments: container.querySelector('#reviewComments').value,
      recommendation: container.querySelector('input[name="recommendation"]:checked')?.value || ''
    };
  }

  // Auto-save on input
  let autoSaveTimer;
  const autoSave = () => {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(async () => {
      try {
        const data = gatherData();
        const saved = await ReviewService.saveDraft(data);
        container.querySelector('#reviewId').value = saved.id;
      } catch { /* silent */ }
    }, 1500);
  };
  container.querySelectorAll('textarea, input').forEach(el => el.addEventListener('input', autoSave));

  container.querySelector('#saveDraftBtn')?.addEventListener('click', async () => {
    try {
      const data = gatherData();
      const saved = await ReviewService.saveDraft(data);
      container.querySelector('#reviewId').value = saved.id;
      showToast('Borrador guardado', 'success');
    } catch (err) { showToast(err.message, 'error'); }
  });

  const form = container.querySelector('#reviewForm');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const data = gatherData();
      await ReviewService.submit(data);
      showToast('Revisión enviada correctamente', 'success');
      navigateTo('dashboard');
    } catch (err) { showToast(err.message, 'error'); }
  });

  container.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-nav]');
    if (btn) navigateTo(btn.dataset.nav);
  });
}

// ── AUTHOR STATUS VIEW ──
export async function renderAuthorStatus(container, params = {}) {
  const tpl = document.getElementById('tpl-author-status');
  container.innerHTML = '';
  container.appendChild(tpl.content.cloneNode(true));

  const article = await ArticleService.getById(params.articleId);
  if (!article) { showToast('Artículo no encontrado', 'error'); navigateTo('dashboard'); return; }

  const detail = container.querySelector('#authorArticleDetail');
  const assignments = await AssignmentService.getByArticle(article.id);
  const reviews = await ReviewService.getSubmittedByArticle(article.id);

  detail.innerHTML = `
    <h2>${escHtml(article.title)}</h2>
    <div style="margin:8px 0;display:flex;gap:12px;flex-wrap:wrap;">
      <span class="status-badge ${StatusPolicy.statusClass(article.status)}">${StatusPolicy.statusLabel(article.status)}</span>
      <span style="font-size:12px;color:var(--text-muted)">📅 Recibido: ${formatDate(article.createdAt)}</span>
      <span style="font-size:12px;color:var(--text-muted)">👤 ${escHtml(article.author)}</span>
    </div>
    ${article.abstract ? `<p style="margin-top:10px;font-size:13px;color:var(--text-secondary)">${escHtml(article.abstract)}</p>` : ''}
    <div style="margin-top:12px;font-size:12px;color:var(--text-muted)">
      Revisores asignados: ${assignments.length} · Revisiones recibidas: ${reviews.length}
    </div>
  `;

  const reviewsList = container.querySelector('#authorReviewsList');
  if (reviews.length === 0) {
    reviewsList.innerHTML = `<div class="empty-state"><div class="empty-icon">⏳</div><p>Las revisiones estarán disponibles cuando sean enviadas por los revisores.</p></div>`;
  } else {
    reviews.forEach((r, i) => {
      const card = document.createElement('div');
      card.className = 'review-card';
      const rec = { accept: '✓ Aceptar', 'minor-revisions': '⟳ Revisiones menores', 'major-revisions': '⚠ Revisiones mayores', reject: '✗ Rechazar' };
      card.innerHTML = `
        <h4>Revisión #${i + 1} · <span class="badge badge-submitted">Enviada</span></h4>
        <div class="review-section"><h5>Fortalezas</h5><p>${escHtml(r.strengths)}</p></div>
        <div class="review-section"><h5>Debilidades</h5><p>${escHtml(r.weaknesses)}</p></div>
        ${r.comments ? `<div class="review-section"><h5>Comentarios adicionales</h5><p>${escHtml(r.comments)}</p></div>` : ''}
        <div class="review-section"><h5>Recomendación</h5><p><strong>${rec[r.recommendation] || r.recommendation}</strong></p></div>
      `;
      reviewsList.appendChild(card);
    });
  }

  container.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-nav]');
    if (btn) navigateTo(btn.dataset.nav);
  });
}

// ── REVIEWERS MANAGEMENT VIEW ──
export async function renderReviewersView(container) {
  const tpl = document.getElementById('tpl-reviewers');
  container.innerHTML = '';
  container.appendChild(tpl.content.cloneNode(true));

  async function loadList() {
    const reviewers = await ReviewerService.getAll();
    const listEl = container.querySelector('#reviewersList');
    listEl.innerHTML = '';  // FIX: always clear before repopulating
    if (reviewers.length === 0) {
      listEl.innerHTML = `<div class="empty-state"><div class="empty-icon">👥</div><p>No hay revisores registrados.</p></div>`;
      return;
    }
    listEl.innerHTML = reviewers.map(r => `
      <div class="reviewer-list-item">
        <div>
          <div class="reviewer-list-name">${escHtml(r.name)}</div>
          <div class="reviewer-list-meta">${escHtml(r.email)}${r.specialty ? ' · ' + escHtml(r.specialty) : ''}</div>
        </div>
        <button class="btn-danger-sm" data-delete="${r.id}">Eliminar</button>
      </div>
    `).join('');
  }

  const form = container.querySelector('#reviewerForm');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await ReviewerService.create({
        name: container.querySelector('#revName').value.trim(),
        email: container.querySelector('#revEmail').value.trim(),
        specialty: container.querySelector('#revSpecialty').value.trim()
      });
      form.reset();
      await loadList();
      showToast('Revisor agregado', 'success');
    } catch (err) { showToast(err.message, 'error'); }
  });

  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-delete]');
    if (btn) {
      await ReviewerService.delete(btn.dataset.delete);
      await loadList();
      showToast('Revisor eliminado', 'info');
    }
  });

  await loadList();
}

// ── DEMO DATA ──
async function loadDemoData() {
  const { ArticleService: AS, ReviewerService: RS } = await import('../services/services.js');

  // Check existing to avoid duplicates
  const existingArticles = await AS.getAll();
  const existingReviewers = await RS.getAll();
  const existingTitles = new Set(existingArticles.map(a => a.title));
  const existingEmails = new Set(existingReviewers.map(r => r.email));

  const reviewers = [
    { name: 'Dra. Ana Martínez', email: 'a.martinez@uabc.edu.mx', specialty: 'Inteligencia Artificial' },
    { name: 'Dr. Carlos Pérez', email: 'c.perez@uabc.edu.mx', specialty: 'Redes de Computadoras' },
    { name: 'Mtra. Sofia Ruiz', email: 's.ruiz@uabc.edu.mx', specialty: 'Seguridad Informática' }
  ];
  for (const r of reviewers) {
    if (!existingEmails.has(r.email)) {
      try { await RS.create(r); } catch { /* skip */ }
    }
  }

  const articles = [
    { title: 'Detección de anomalías en redes IoT mediante aprendizaje federado', author: 'M. González', abstract: 'Se propone un modelo de detección de anomalías...', keywords: 'IoT, federated learning, anomaly detection' },
    { title: 'Algoritmos de planificación energética para centros de datos en la nube', author: 'L. Hernández', abstract: 'Estudio comparativo de algoritmos...', keywords: 'cloud computing, energy efficiency, scheduling' },
    { title: 'Análisis de vulnerabilidades en sistemas SCADA industriales', author: 'P. Salinas', abstract: 'Revisión sistemática de vulnerabilidades...', keywords: 'SCADA, industrial security, ICS' }
  ];
  for (const a of articles) {
    if (!existingTitles.has(a.title)) {
      try { await AS.create(a); } catch { /* skip */ }
    }
  }
}

// ── HELPERS ──
function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
