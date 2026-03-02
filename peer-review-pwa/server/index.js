// server/index.js — Node.js + Express backend (Increment 5: Sync Architecture)
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: '*' }));
app.use(express.json());

// ── DATABASE CONFIG (MariaDB) ──
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'peerflow_user',
  password: process.env.DB_PASS || 'peerflow_pass',
  database: process.env.DB_NAME || 'peerflow_db',
  waitForConnections: true,
  connectionLimit: 10
};

let pool;
async function getPool() {
  if (!pool) pool = mysql.createPool(dbConfig);
  return pool;
}

// ── DB INIT (create tables if not exist) ──
async function initDB() {
  const db = await getPool();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS articles (
      id VARCHAR(64) PRIMARY KEY,
      title TEXT NOT NULL,
      author VARCHAR(255) NOT NULL,
      email VARCHAR(255),
      abstract TEXT,
      keywords TEXT,
      status VARCHAR(32) DEFAULT 'received',
      created_at BIGINT,
      updated_at BIGINT
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS reviewers (
      id VARCHAR(64) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL,
      specialty VARCHAR(255),
      created_at BIGINT
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS assignments (
      id VARCHAR(64) PRIMARY KEY,
      article_id VARCHAR(64) NOT NULL,
      reviewer_id VARCHAR(64) NOT NULL,
      due_at BIGINT,
      assigned_at BIGINT,
      FOREIGN KEY (article_id) REFERENCES articles(id),
      FOREIGN KEY (reviewer_id) REFERENCES reviewers(id)
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS reviews (
      id VARCHAR(64) PRIMARY KEY,
      article_id VARCHAR(64) NOT NULL,
      reviewer_id VARCHAR(64) NOT NULL,
      strengths TEXT,
      weaknesses TEXT,
      comments TEXT,
      recommendation VARCHAR(64),
      status VARCHAR(32) DEFAULT 'draft',
      updated_at BIGINT,
      submitted_at BIGINT,
      FOREIGN KEY (article_id) REFERENCES articles(id)
    )
  `);
  console.log('✓ Database tables initialized');
}

// ── HEALTH ──
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now(), service: 'PeerFlow API' });
});

// ── ARTICLES ──
app.get('/api/articles', async (req, res) => {
  try {
    const db = await getPool();
    const [rows] = await db.execute('SELECT * FROM articles ORDER BY created_at DESC');
    res.json(rows.map(rowToArticle));
  } catch (err) { res.status(500).json({ message: err.message }); }
});

app.post('/api/articles', async (req, res) => {
  try {
    const db = await getPool();
    const a = req.body;
    await db.execute(
      'INSERT INTO articles (id, title, author, email, abstract, keywords, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE title=VALUES(title), author=VALUES(author), status=VALUES(status), updated_at=VALUES(updated_at)',
      [a.id, a.title, a.author, a.email||null, a.abstract||null, a.keywords||null, a.status||'received', a.createdAt||Date.now(), a.updatedAt||Date.now()]
    );
    res.status(201).json({ success: true, id: a.id });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

app.patch('/api/articles/:id', async (req, res) => {
  try {
    const db = await getPool();
    const { status } = req.body;
    await db.execute('UPDATE articles SET status=?, updated_at=? WHERE id=?', [status, Date.now(), req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── REVIEWERS ──
app.get('/api/reviewers', async (req, res) => {
  try {
    const db = await getPool();
    const [rows] = await db.execute('SELECT * FROM reviewers');
    res.json(rows.map(r => ({ id: r.id, name: r.name, email: r.email, specialty: r.specialty, createdAt: r.created_at })));
  } catch (err) { res.status(500).json({ message: err.message }); }
});

app.post('/api/reviewers', async (req, res) => {
  try {
    const db = await getPool();
    const r = req.body;
    await db.execute(
      'INSERT INTO reviewers (id, name, email, specialty, created_at) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name), email=VALUES(email)',
      [r.id, r.name, r.email, r.specialty||null, r.createdAt||Date.now()]
    );
    res.status(201).json({ success: true });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

app.delete('/api/reviewers/:id', async (req, res) => {
  try {
    const db = await getPool();
    await db.execute('DELETE FROM reviewers WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── ASSIGNMENTS ──
app.post('/api/assignments', async (req, res) => {
  try {
    const db = await getPool();
    const { articleId, reviewerIds, dueAt } = req.body;
    for (const reviewerId of reviewerIds) {
      const id = `${articleId}_${reviewerId}`;
      await db.execute(
        'INSERT INTO assignments (id, article_id, reviewer_id, due_at, assigned_at) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE due_at=VALUES(due_at)',
        [id, articleId, reviewerId, new Date(dueAt).getTime(), Date.now()]
      );
    }
    res.status(201).json({ success: true });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── REVIEWS ──
app.put('/api/reviews/:id', async (req, res) => {
  try {
    const db = await getPool();
    const r = req.body;
    await db.execute(
      `INSERT INTO reviews (id, article_id, reviewer_id, strengths, weaknesses, comments, recommendation, status, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE strengths=VALUES(strengths), weaknesses=VALUES(weaknesses), comments=VALUES(comments), recommendation=VALUES(recommendation), updated_at=VALUES(updated_at)`,
      [r.id||req.params.id, r.articleId, r.reviewerId, r.strengths||null, r.weaknesses||null, r.comments||null, r.recommendation||null, r.status||'draft', Date.now()]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

app.post('/api/reviews/:id/submit', async (req, res) => {
  try {
    const db = await getPool();
    const r = req.body;
    await db.execute(
      `INSERT INTO reviews (id, article_id, reviewer_id, strengths, weaknesses, comments, recommendation, status, updated_at, submitted_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE strengths=VALUES(strengths), weaknesses=VALUES(weaknesses), comments=VALUES(comments), recommendation=VALUES(recommendation), status='submitted', submitted_at=VALUES(submitted_at), updated_at=VALUES(updated_at)`,
      [r.id||req.params.id, r.articleId, r.reviewerId, r.strengths||null, r.weaknesses||null, r.comments||null, r.recommendation||null, 'submitted', Date.now(), r.submittedAt||Date.now()]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

app.get('/api/articles/:id/reviews', async (req, res) => {
  try {
    const db = await getPool();
    const [rows] = await db.execute("SELECT * FROM reviews WHERE article_id=? AND status='submitted'", [req.params.id]);
    res.json(rows);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── BULK SYNC ENDPOINT (Increment 5) ──
// Clients can send a batch of operations from their sync queue
app.post('/api/sync/bulk', async (req, res) => {
  const { operations } = req.body;
  if (!Array.isArray(operations)) return res.status(400).json({ message: 'operations array required' });

  const results = [];
  for (const op of operations) {
    try {
      // Re-use individual handlers via internal calls
      const db = await getPool();
      switch (`${op.entity}:${op.operation}`) {
        case 'article:create': {
          const a = op.data;
          await db.execute(
            'INSERT INTO articles (id, title, author, email, abstract, keywords, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE title=VALUES(title), status=VALUES(status), updated_at=VALUES(updated_at)',
            [a.id, a.title, a.author, a.email||null, a.abstract||null, a.keywords||null, a.status||'received', a.createdAt||Date.now(), a.updatedAt||Date.now()]
          );
          break;
        }
        case 'article:update': {
          await db.execute('UPDATE articles SET status=?, updated_at=? WHERE id=?', [op.data.status, Date.now(), op.entityId]);
          break;
        }
        case 'reviewer:create': {
          const r = op.data;
          await db.execute(
            'INSERT INTO reviewers (id, name, email, specialty, created_at) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name)',
            [r.id, r.name, r.email, r.specialty||null, r.createdAt||Date.now()]
          );
          break;
        }
        case 'reviewer:delete': {
          await db.execute('DELETE FROM reviewers WHERE id=?', [op.entityId]);
          break;
        }
        case 'assignment:create': {
          const { articleId, reviewerIds, dueAt } = op.data;
          for (const reviewerId of (reviewerIds || [])) {
            const id = `${articleId}_${reviewerId}`;
            await db.execute(
              'INSERT INTO assignments (id, article_id, reviewer_id, due_at, assigned_at) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE due_at=VALUES(due_at)',
              [id, articleId, reviewerId, new Date(dueAt).getTime(), Date.now()]
            );
          }
          break;
        }
        case 'review:draft':
        case 'review:submit': {
          const r = op.data;
          const status = op.operation === 'submit' ? 'submitted' : (r.status || 'draft');
          await db.execute(
            `INSERT INTO reviews (id, article_id, reviewer_id, strengths, weaknesses, comments, recommendation, status, updated_at, submitted_at)
             VALUES (?,?,?,?,?,?,?,?,?,?)
             ON DUPLICATE KEY UPDATE strengths=VALUES(strengths), weaknesses=VALUES(weaknesses), comments=VALUES(comments), recommendation=VALUES(recommendation), status=VALUES(status), updated_at=VALUES(updated_at), submitted_at=VALUES(submitted_at)`,
            [r.id, r.articleId, r.reviewerId, r.strengths||null, r.weaknesses||null, r.comments||null, r.recommendation||null, status, Date.now(), r.submittedAt||null]
          );
          break;
        }
        default:
          results.push({ id: op.id, status: 'skipped', reason: 'unknown operation' });
          continue;
      }
      results.push({ id: op.id, status: 'synced' });
    } catch (err) {
      results.push({ id: op.id, status: 'failed', error: err.message });
    }
  }

  const synced = results.filter(r => r.status === 'synced').length;
  const failed = results.filter(r => r.status === 'failed').length;
  res.json({ synced, failed, results });
});

// ── HELPER ──
function rowToArticle(r) {
  return {
    id: r.id, title: r.title, author: r.author, email: r.email,
    abstract: r.abstract, keywords: r.keywords, status: r.status,
    createdAt: r.created_at, updatedAt: r.updated_at
  };
}

// ── START ──
async function start() {
  try {
    await initDB();
    app.listen(PORT, () => {
      console.log(`\n🚀 PeerFlow API running on http://localhost:${PORT}`);
      console.log(`   Health: http://localhost:${PORT}/api/health`);
      console.log(`   Database: ${dbConfig.host}/${dbConfig.database}\n`);
    });
  } catch (err) {
    console.error('Failed to start server:', err.message);
    console.log('\n⚠  Running without database — API will return errors');
    console.log('   Start MariaDB and configure DB_HOST, DB_USER, DB_PASS, DB_NAME\n');
    app.listen(PORT, () => console.log(`PeerFlow API (no-db mode) on http://localhost:${PORT}`));
  }
}

start();
