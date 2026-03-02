// js/repos/repos.js — All repository modules
import { dbGet, dbPut, dbDelete, dbGetAll, dbGetByIndex, generateId } from './idb-client.js';

// ── ARTICLE REPO ──
export const ArticleRepo = {
  async findAll() { return dbGetAll('articles'); },
  async findById(id) { return dbGet('articles', id); },
  async save(article) {
    // Preserve existing createdAt if record already exists
    const existing = article.id ? await dbGet('articles', article.id).catch(() => null) : null;
    const item = {
      ...article,
      id: article.id || generateId(),
      createdAt: existing?.createdAt ?? article.createdAt ?? Date.now(),
      updatedAt: Date.now()
    };
    await dbPut('articles', item);
    return item;
  },
  async updateStatus(id, status) {
    const article = await dbGet('articles', id);
    if (!article) throw new Error('Article not found');
    const updated = { ...article, status, updatedAt: Date.now() };
    await dbPut('articles', updated);
    return updated;
  },
  async countSubmittedReviews(articleId) {
    const reviews = await dbGetByIndex('reviews', 'articleId', articleId);
    return reviews.filter(r => r.status === 'submitted').length;
  }
};

// ── REVIEWER REPO ──
export const ReviewerRepo = {
  async findAll() { return dbGetAll('reviewers'); },
  async findById(id) { return dbGet('reviewers', id); },
  async save(reviewer) {
    const item = { ...reviewer, id: reviewer.id || generateId() };
    await dbPut('reviewers', item);
    return item;
  },
  async delete(id) { return dbDelete('reviewers', id); }
};

// ── ASSIGNMENT REPO ──
export const AssignmentRepo = {
  async findByArticle(articleId) { return dbGetByIndex('assignments', 'articleId', articleId); },
  // FIX: saveMany uses dbPut which overwrites by keyPath — IDs must be stable composites
  async saveMany(assignments) {
    for (const a of assignments) {
      // id must be pre-set by caller as a stable composite key to enable upsert behaviour
      const item = { ...a, id: a.id || generateId() };
      await dbPut('assignments', item);
    }
  }
};

// ── REVIEW REPO ──
export const ReviewRepo = {
  async findByArticle(articleId) { return dbGetByIndex('reviews', 'articleId', articleId); },
  async findByReviewer(reviewerId) { return dbGetByIndex('reviews', 'reviewerId', reviewerId); },
  async findById(id) { return dbGet('reviews', id); },

  // FIX: look up by both articleId AND reviewerId to find the unique draft
  async findByArticleAndReviewer(articleId, reviewerId) {
    const byArticle = await dbGetByIndex('reviews', 'articleId', articleId);
    return byArticle.find(r => r.reviewerId === reviewerId) || null;
  },

  // upsert: put overwrites if id already exists
  async upsert(review) {
    const item = { ...review, id: review.id || generateId(), updatedAt: Date.now() };
    await dbPut('reviews', item);
    return item;
  },
  async findSubmittedByArticle(articleId) {
    const all = await dbGetByIndex('reviews', 'articleId', articleId);
    return all.filter(r => r.status === 'submitted');
  }
};

// ── SYNC QUEUE REPO ──
export const SyncQueueRepo = {
  async getAll() { return dbGetAll('sync_queue'); },
  async getPending() {
    const all = await dbGetAll('sync_queue');
    return all.filter(i => i.status === 'pending');
  },
  async enqueue(operation) {
    const item = {
      id: generateId(),
      status: 'pending',
      createdAt: Date.now(),
      retries: 0,
      ...operation
    };
    await dbPut('sync_queue', item);
    return item;
  },
  async markSynced(id) {
    const item = await dbGet('sync_queue', id);
    if (item) await dbPut('sync_queue', { ...item, status: 'synced', syncedAt: Date.now() });
  },
  async markFailed(id, error) {
    const item = await dbGet('sync_queue', id);
    if (item) await dbPut('sync_queue', { ...item, status: 'failed', error: error.message, retries: (item.retries || 0) + 1 });
  },
  async clearSynced() {
    const all = await dbGetAll('sync_queue');
    for (const item of all.filter(i => i.status === 'synced')) {
      await dbDelete('sync_queue', item.id);
    }
  }
};
