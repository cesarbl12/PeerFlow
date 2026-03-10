// js/services/services.js — Business logic v2 (+ CommentService)
import { ArticleRepo, ReviewerRepo, AssignmentRepo, ReviewRepo, CommentRepo, SyncQueueRepo } from '../repos/repos.js';

// ── VALIDATION ────────────────────────────────────────────────────────
export const ValidationUtils = {
  validateArticle({ title, author }) {
    const e = [];
    if (!title?.trim())  e.push('El título es requerido');
    if (!author?.trim()) e.push('El autor es requerido');
    return e;
  },
  validateAssignment({ articleId, reviewerIds, dueAt }) {
    const e = [];
    if (!articleId)                        e.push('Artículo requerido');
    if (!reviewerIds || reviewerIds.length < 2) e.push('Se requieren al menos 2 revisores');
    if (reviewerIds  && reviewerIds.length > 3) e.push('Máximo 3 revisores');
    if (!dueAt)                            e.push('Fecha límite requerida');
    else if (new Date(dueAt) <= new Date()) e.push('La fecha límite debe ser futura');
    return e;
  },
  validateReview({ strengths, weaknesses, recommendation }) {
    const e = [];
    if (!strengths?.trim())    e.push('Las fortalezas son requeridas');
    if (!weaknesses?.trim())   e.push('Las debilidades son requeridas');
    if (!recommendation)       e.push('La recomendación es requerida');
    return e;
  }
};

// ── STATUS POLICY ─────────────────────────────────────────────────────
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

// ── ARTICLE SERVICE ───────────────────────────────────────────────────
export const ArticleService = {
  async getAll(filterStatus = '') {
    let articles = await ArticleRepo.findAll();
    if (filterStatus) articles = articles.filter(a => a.status === filterStatus);
    return articles.sort((a, b) => b.createdAt - a.createdAt);
  },
  async getById(id) { return ArticleRepo.findById(id); },

  async save(data) {
    const errors = ValidationUtils.validateArticle(data);
    if (errors.length) throw new Error(errors.join(', '));

    if (data.id) {
      const existing = await ArticleRepo.findById(data.id);
      if (existing) {
        const updated = {
          ...existing,
          title:    data.title,
          author:   data.author,
          email:    data.email    ?? existing.email,
          abstract: data.abstract ?? existing.abstract,
          keywords: data.keywords ?? existing.keywords,
          // preserve PDF fields if not overriding
          pdfPath:  data.pdfPath  ?? existing.pdfPath,
          pdfName:  data.pdfName  ?? existing.pdfName,
          pdfSize:  data.pdfSize  ?? existing.pdfSize,
          updatedAt: Date.now()
        };
        const saved = await ArticleRepo.save(updated);
        await SyncQueueRepo.enqueue({ entity: 'article', operation: 'update', entityId: saved.id, data: saved });
        return saved;
      }
    }

    const article = {
      ...data,
      status:    StatusPolicy.STATUSES.RECEIVED,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    const saved = await ArticleRepo.save(article);
    await SyncQueueRepo.enqueue({ entity: 'article', operation: 'create', entityId: saved.id, data: saved });
    return saved;
  },

  async create(data) { return this.save(data); },

  async setStatus(id, status) {
    const updated = await ArticleRepo.updateStatus(id, status);
    await SyncQueueRepo.enqueue({ entity: 'article', operation: 'update', entityId: id, data: { id, status } });
    return updated;
  },

  // Guarda solo los campos PDF en IDB y encola sync
  async savePdfMeta(id, { pdfPath, pdfName, pdfSize }) {
    const article = await ArticleRepo.findById(id);
    if (!article) throw new Error('Artículo no encontrado');
    const updated = { ...article, pdfPath, pdfName, pdfSize, updatedAt: Date.now() };
    await ArticleRepo.save(updated);
    await SyncQueueRepo.enqueue({ entity: 'article', operation: 'update', entityId: id, data: { id, pdfPath, pdfName, pdfSize } });
    return updated;
  }
};

// ── ASSIGNMENT SERVICE ────────────────────────────────────────────────
export const AssignmentService = {
  async assign(articleId, reviewerIds, dueAt) {
    const errors = ValidationUtils.validateAssignment({ articleId, reviewerIds, dueAt });
    if (errors.length) throw new Error(errors.join(', '));

    const assignments = reviewerIds.map(reviewerId => ({
      id:         `${articleId}__${reviewerId}`,
      articleId,
      reviewerId,
      dueAt:      new Date(dueAt).getTime(),
      assignedAt: Date.now()
    }));
    await AssignmentRepo.saveMany(assignments);
    await ArticleService.setStatus(articleId, StatusPolicy.applyAfterAssignment());
    await SyncQueueRepo.enqueue({ entity: 'assignment', operation: 'create', entityId: articleId, data: { articleId, reviewerIds, dueAt } });
    return assignments;
  },
  async getByArticle(articleId)   { return AssignmentRepo.findByArticle(articleId); },
  async getByReviewer(reviewerId) { return AssignmentRepo.findByReviewer(reviewerId); }
};

// ── REVIEW SERVICE ────────────────────────────────────────────────────
export const ReviewService = {
  async loadOrCreate(articleId, reviewerId) {
    const existing = await ReviewRepo.findByArticleAndReviewer(articleId, reviewerId);
    if (existing) return existing;
    return { articleId, reviewerId, status: 'draft', strengths: '', weaknesses: '', recommendation: '' };
  },
  async saveDraft(reviewData) {
    const id    = reviewData.id || `${reviewData.articleId}__${reviewData.reviewerId}`;
    const draft = { ...reviewData, id, status: 'draft', updatedAt: Date.now() };
    const saved = await ReviewRepo.upsert(draft);
    await SyncQueueRepo.enqueue({ entity: 'review', operation: 'draft', entityId: saved.id, data: saved });
    return saved;
  },
  async submit(reviewData) {
    const errors = ValidationUtils.validateReview(reviewData);
    if (errors.length) throw new Error(errors.join(', '));

    const id     = reviewData.id || `${reviewData.articleId}__${reviewData.reviewerId}`;
    const review = { ...reviewData, id, status: 'submitted', submittedAt: Date.now() };
    const saved  = await ReviewRepo.upsert(review);

    const newStatus = await StatusPolicy.applyAfterSubmit(reviewData.articleId);
    if (newStatus) await ArticleService.setStatus(reviewData.articleId, newStatus);

    await SyncQueueRepo.enqueue({ entity: 'review', operation: 'submit', entityId: saved.id, data: saved });
    return saved;
  },
  async getSubmittedByArticle(articleId) { return ReviewRepo.findSubmittedByArticle(articleId); },
  async getByReviewer(reviewerId)        { return ReviewRepo.findByReviewer(reviewerId); }
};

// ── COMMENT SERVICE ───────────────────────────────────────────────────
export const CommentService = {
  async getByArticle(articleId) {
    const comments = await CommentRepo.findByArticle(articleId);
    return comments.sort((a, b) => a.createdAt - b.createdAt);
  },
  async getByReview(reviewId) {
    const comments = await CommentRepo.findByReview(reviewId);
    return comments.sort((a, b) => a.createdAt - b.createdAt);
  },
  async add({ reviewId, articleId, authorRole, authorName, authorId, content }) {
    if (!content?.trim()) throw new Error('El comentario no puede estar vacío');
    const comment = {
      reviewId, articleId, authorRole, authorName, authorId,
      content: content.trim(),
      createdAt: Date.now()
    };
    const saved = await CommentRepo.save(comment);
    await SyncQueueRepo.enqueue({ entity: 'comment', operation: 'create', entityId: saved.id, data: saved });
    return saved;
  }
};

// ── REVIEWER SERVICE ──────────────────────────────────────────────────
export const ReviewerService = {
  async getAll() { return ReviewerRepo.findAll(); },
  async create(data) {
    if (!data.name?.trim() || !data.email?.trim()) throw new Error('Nombre y email son requeridos');
    const all = await ReviewerRepo.findAll();
    if (all.find(r => r.email.toLowerCase() === data.email.trim().toLowerCase())) {
      throw new Error(`Ya existe un revisor con el email ${data.email}`);
    }
    const reviewer = { ...data, createdAt: Date.now() };
    const saved    = await ReviewerRepo.save(reviewer);
    await SyncQueueRepo.enqueue({ entity: 'reviewer', operation: 'create', entityId: saved.id, data: saved });
    return saved;
  },
  async delete(id) {
    await ReviewerRepo.delete(id);
    await SyncQueueRepo.enqueue({ entity: 'reviewer', operation: 'delete', entityId: id, data: {} });
  }
};
