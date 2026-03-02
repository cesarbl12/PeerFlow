// js/services/services.js — Business logic services
import { ArticleRepo, ReviewerRepo, AssignmentRepo, ReviewRepo, SyncQueueRepo } from '../repos/repos.js';

// ── VALIDATION UTILS ──
export const ValidationUtils = {
  validateArticle({ title, author }) {
    const errors = [];
    if (!title?.trim()) errors.push('El título es requerido');
    if (!author?.trim()) errors.push('El autor es requerido');
    return errors;
  },
  validateAssignment({ articleId, reviewerIds, dueAt }) {
    const errors = [];
    if (!articleId) errors.push('Artículo requerido');
    if (!reviewerIds || reviewerIds.length < 2) errors.push('Se requieren al menos 2 revisores');
    if (reviewerIds && reviewerIds.length > 3) errors.push('Máximo 3 revisores');
    if (!dueAt) errors.push('Fecha límite requerida');
    else if (new Date(dueAt) <= new Date()) errors.push('La fecha límite debe ser futura');
    return errors;
  },
  validateReview({ strengths, weaknesses, recommendation }) {
    const errors = [];
    if (!strengths?.trim()) errors.push('Las fortalezas son requeridas');
    if (!weaknesses?.trim()) errors.push('Las debilidades son requeridas');
    if (!recommendation) errors.push('La recomendación es requerida');
    return errors;
  }
};

// ── STATUS POLICY ──
export const StatusPolicy = {
  STATUSES: { RECEIVED: 'received', IN_REVIEW: 'in-review', COMMENTS_READY: 'comments-ready' },
  applyAfterAssignment() { return this.STATUSES.IN_REVIEW; },
  async applyAfterSubmit(articleId) {
    const count = await ArticleRepo.countSubmittedReviews(articleId);
    return count >= 2 ? this.STATUSES.COMMENTS_READY : null;
  },
  statusLabel(status) {
    return { received: 'Recibido', 'in-review': 'En revisión', 'comments-ready': 'Comentarios listos' }[status] || status;
  },
  statusClass(status) {
    return { received: 'received', 'in-review': 'in-review', 'comments-ready': 'comments-ready' }[status] || '';
  }
};

// ── ARTICLE SERVICE ──
export const ArticleService = {
  async getAll(filterStatus = '') {
    let articles = await ArticleRepo.findAll();
    if (filterStatus) articles = articles.filter(a => a.status === filterStatus);
    return articles.sort((a, b) => b.createdAt - a.createdAt);
  },
  async getById(id) { return ArticleRepo.findById(id); },

  // FIX: Handles both create (no id) and update (id present) — never duplicates
  async save(data) {
    const errors = ValidationUtils.validateArticle(data);
    if (errors.length) throw new Error(errors.join(', '));

    if (data.id) {
      // UPDATE: preserve original createdAt and status
      const existing = await ArticleRepo.findById(data.id);
      if (existing) {
        const updated = {
          ...existing,
          title: data.title,
          author: data.author,
          email: data.email ?? existing.email,
          abstract: data.abstract ?? existing.abstract,
          keywords: data.keywords ?? existing.keywords,
          updatedAt: Date.now()
        };
        const saved = await ArticleRepo.save(updated);
        await SyncQueueRepo.enqueue({ entity: 'article', operation: 'update', entityId: saved.id, data: saved });
        return saved;
      }
    }

    // CREATE: generate new record
    const article = {
      ...data,
      id: data.id || undefined, // ArticleRepo.save generates id if missing
      status: StatusPolicy.STATUSES.RECEIVED,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    const saved = await ArticleRepo.save(article);
    await SyncQueueRepo.enqueue({ entity: 'article', operation: 'create', entityId: saved.id, data: saved });
    return saved;
  },

  // Keep create as an alias so existing callers still work
  async create(data) { return this.save(data); },

  async setStatus(id, status) {
    const updated = await ArticleRepo.updateStatus(id, status);
    await SyncQueueRepo.enqueue({ entity: 'article', operation: 'update', entityId: id, data: { status } });
    return updated;
  }
};

// ── ASSIGNMENT SERVICE ──
export const AssignmentService = {
  async assign(articleId, reviewerIds, dueAt) {
    const errors = ValidationUtils.validateAssignment({ articleId, reviewerIds, dueAt });
    if (errors.length) throw new Error(errors.join(', '));

    // FIX: Use deterministic IDs (articleId + reviewerId) so re-assigning updates, never duplicates
    const assignments = reviewerIds.map(reviewerId => ({
      id: `${articleId}__${reviewerId}`,   // stable composite key
      articleId,
      reviewerId,
      dueAt: new Date(dueAt).getTime(),
      assignedAt: Date.now()
    }));
    await AssignmentRepo.saveMany(assignments);

    const newStatus = StatusPolicy.applyAfterAssignment();
    await ArticleService.setStatus(articleId, newStatus);

    await SyncQueueRepo.enqueue({ entity: 'assignment', operation: 'create', entityId: articleId, data: { articleId, reviewerIds, dueAt } });
    return assignments;
  },
  async getByArticle(articleId) { return AssignmentRepo.findByArticle(articleId); }
};

// ── REVIEW SERVICE ──
export const ReviewService = {
  async loadOrCreate(articleId, reviewerId) {
    // FIX: look up by composite key so we always get the same draft
    const existing = await ReviewRepo.findByArticleAndReviewer(articleId, reviewerId);
    if (existing) return existing;
    return { articleId, reviewerId, status: 'draft', strengths: '', weaknesses: '', comments: '', recommendation: '' };
  },
  async saveDraft(reviewData) {
    // FIX: use stable composite id so repeated saves update the same record
    const id = reviewData.id || `${reviewData.articleId}__${reviewData.reviewerId}`;
    const draft = { ...reviewData, id, status: 'draft', updatedAt: Date.now() };
    const saved = await ReviewRepo.upsert(draft);
    await SyncQueueRepo.enqueue({ entity: 'review', operation: 'draft', entityId: saved.id, data: saved });
    return saved;
  },
  async submit(reviewData) {
    const errors = ValidationUtils.validateReview(reviewData);
    if (errors.length) throw new Error(errors.join(', '));

    const id = reviewData.id || `${reviewData.articleId}__${reviewData.reviewerId}`;
    const review = { ...reviewData, id, status: 'submitted', submittedAt: Date.now() };
    const saved = await ReviewRepo.upsert(review);

    const newStatus = await StatusPolicy.applyAfterSubmit(reviewData.articleId);
    if (newStatus) await ArticleService.setStatus(reviewData.articleId, newStatus);

    await SyncQueueRepo.enqueue({ entity: 'review', operation: 'submit', entityId: saved.id, data: saved });
    return saved;
  },
  async getSubmittedByArticle(articleId) { return ReviewRepo.findSubmittedByArticle(articleId); }
};

// ── REVIEWER SERVICE ──
export const ReviewerService = {
  async getAll() { return ReviewerRepo.findAll(); },
  async create(data) {
    if (!data.name?.trim() || !data.email?.trim()) throw new Error('Nombre y email son requeridos');

    // FIX: prevent duplicate emails
    const all = await ReviewerRepo.findAll();
    const duplicate = all.find(r => r.email.toLowerCase() === data.email.trim().toLowerCase());
    if (duplicate) throw new Error(`Ya existe un revisor con el email ${data.email}`);

    const reviewer = { ...data, createdAt: Date.now() };
    const saved = await ReviewerRepo.save(reviewer);
    await SyncQueueRepo.enqueue({ entity: 'reviewer', operation: 'create', entityId: saved.id, data: saved });
    return saved;
  },
  async delete(id) {
    await ReviewerRepo.delete(id);
    await SyncQueueRepo.enqueue({ entity: 'reviewer', operation: 'delete', entityId: id, data: {} });
  }
};
