-- ============================================================
-- PeerFlow v2 — Script de inicialización MySQL
-- Ejecutar como: mysql -u root -p < database/init.sql
-- ============================================================

CREATE DATABASE IF NOT EXISTS peerflow_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- NOTA: Las líneas de CREATE USER y GRANT se omiten porque el servidor
-- puede estar corriendo con --skip-grant-tables.
-- Si necesitas crear el usuario después, ejecuta manualmente (como root, sin --skip-grant-tables):
--
--   CREATE USER IF NOT EXISTS 'peerflow_user'@'localhost' IDENTIFIED BY 'peerflow_pass';
--   GRANT ALL PRIVILEGES ON peerflow_db.* TO 'peerflow_user'@'localhost';
--   FLUSH PRIVILEGES;

USE peerflow_db;

-- ── ARTICLES ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS articles (
  id          VARCHAR(64)   PRIMARY KEY,
  title       TEXT          NOT NULL,
  author      VARCHAR(255)  NOT NULL,
  email       VARCHAR(255),
  abstract    TEXT,
  keywords    TEXT,
  status      VARCHAR(32)   NOT NULL DEFAULT 'received',
  author_id   VARCHAR(64),
  pdf_path    VARCHAR(500)  NULL COMMENT 'Ruta del archivo PDF subido',
  pdf_name    VARCHAR(255)  NULL COMMENT 'Nombre original del PDF',
  pdf_size    BIGINT        NULL COMMENT 'Tamaño en bytes del PDF',
  created_at  BIGINT        NOT NULL,
  updated_at  BIGINT        NOT NULL,
  INDEX idx_status    (status),
  INDEX idx_author_id (author_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── REVIEWERS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reviewers (
  id          VARCHAR(64)   PRIMARY KEY,
  name        VARCHAR(255)  NOT NULL,
  email       VARCHAR(255)  NOT NULL UNIQUE,
  specialty   VARCHAR(255),
  created_at  BIGINT        NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── ASSIGNMENTS ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS assignments (
  id           VARCHAR(128)  PRIMARY KEY,
  article_id   VARCHAR(64)   NOT NULL,
  reviewer_id  VARCHAR(64)   NOT NULL,
  due_at       BIGINT,
  assigned_at  BIGINT        NOT NULL,
  FOREIGN KEY (article_id)  REFERENCES articles(id)  ON DELETE CASCADE,
  FOREIGN KEY (reviewer_id) REFERENCES reviewers(id) ON DELETE CASCADE,
  INDEX idx_article_id  (article_id),
  INDEX idx_reviewer_id (reviewer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── REVIEWS ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reviews (
  id              VARCHAR(128)  PRIMARY KEY,
  article_id      VARCHAR(64)   NOT NULL,
  reviewer_id     VARCHAR(64)   NOT NULL,
  strengths       TEXT,
  weaknesses      TEXT,
  recommendation  VARCHAR(64),
  status          VARCHAR(32)   NOT NULL DEFAULT 'draft',
  updated_at      BIGINT        NOT NULL,
  submitted_at    BIGINT,
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
  INDEX idx_article_id  (article_id),
  INDEX idx_reviewer_id (reviewer_id),
  INDEX idx_status      (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── COMMENTS (nuevo: hilo de comentarios por revisión) ────────
CREATE TABLE IF NOT EXISTS review_comments (
  id           VARCHAR(64)   PRIMARY KEY,
  review_id    VARCHAR(128)  NOT NULL,
  article_id   VARCHAR(64)   NOT NULL,
  author_role  VARCHAR(32)   NOT NULL COMMENT 'reviewer | editor | author',
  author_name  VARCHAR(255)  NOT NULL,
  author_id    VARCHAR(64)   NOT NULL,
  content      TEXT          NOT NULL,
  created_at   BIGINT        NOT NULL,
  FOREIGN KEY (review_id)  REFERENCES reviews(id)   ON DELETE CASCADE,
  FOREIGN KEY (article_id) REFERENCES articles(id)  ON DELETE CASCADE,
  INDEX idx_review_id  (review_id),
  INDEX idx_article_id (article_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── SYNC LOG ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sync_log (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  client_op_id VARCHAR(128),
  entity       VARCHAR(32)   NOT NULL,
  operation    VARCHAR(32)   NOT NULL,
  entity_id    VARCHAR(128),
  synced_at    BIGINT        NOT NULL,
  INDEX idx_entity_id (entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- DATOS DE EJEMPLO
-- ============================================================

INSERT IGNORE INTO reviewers (id, name, email, specialty, created_at) VALUES
  ('rev_1', 'Dra. Ana Martínez', 'a.martinez@uabc.edu.mx', 'Inteligencia Artificial',   UNIX_TIMESTAMP()*1000),
  ('rev_2', 'Dr. Carlos Pérez',  'c.perez@uabc.edu.mx',    'Redes de Computadoras',     UNIX_TIMESTAMP()*1000),
  ('rev_3', 'Mtra. Sofia Ruiz',  's.ruiz@uabc.edu.mx',     'Seguridad Informática',     UNIX_TIMESTAMP()*1000);

INSERT IGNORE INTO articles (id, title, author, email, abstract, keywords, status, author_id, created_at, updated_at) VALUES
  ('art_demo_1',
   'Detección de anomalías en redes IoT mediante aprendizaje federado',
   'M. González', 'm.gonzalez@uabc.edu.mx',
   'Se propone un modelo de detección de anomalías distribuido para redes IoT usando aprendizaje federado.',
   'IoT, federated learning, anomaly detection',
   'in-review', 'author_1',
   (UNIX_TIMESTAMP() - 15*86400)*1000, UNIX_TIMESTAMP()*1000),

  ('art_demo_2',
   'Algoritmos de planificación energética para centros de datos en la nube',
   'L. Hernández', 'l.hernandez@uabc.edu.mx',
   'Estudio comparativo de algoritmos de scheduling para eficiencia energética en cloud computing.',
   'cloud computing, energy efficiency, scheduling',
   'received', 'author_2',
   (UNIX_TIMESTAMP() - 5*86400)*1000, UNIX_TIMESTAMP()*1000),

  ('art_demo_3',
   'Análisis de vulnerabilidades en sistemas SCADA industriales',
   'P. Salinas', 'p.salinas@uabc.edu.mx',
   'Revisión sistemática de vulnerabilidades conocidas en infraestructuras SCADA.',
   'SCADA, industrial security, ICS',
   'comments-ready', 'author_3',
   (UNIX_TIMESTAMP() - 30*86400)*1000, UNIX_TIMESTAMP()*1000);

INSERT IGNORE INTO assignments (id, article_id, reviewer_id, due_at, assigned_at) VALUES
  ('art_demo_1__rev_1', 'art_demo_1', 'rev_1', (UNIX_TIMESTAMP()+6*86400)*1000,  (UNIX_TIMESTAMP()-10*86400)*1000),
  ('art_demo_1__rev_2', 'art_demo_1', 'rev_2', (UNIX_TIMESTAMP()+6*86400)*1000,  (UNIX_TIMESTAMP()-10*86400)*1000),
  ('art_demo_3__rev_1', 'art_demo_3', 'rev_1', (UNIX_TIMESTAMP()-5*86400)*1000,  (UNIX_TIMESTAMP()-25*86400)*1000),
  ('art_demo_3__rev_2', 'art_demo_3', 'rev_2', (UNIX_TIMESTAMP()-5*86400)*1000,  (UNIX_TIMESTAMP()-25*86400)*1000);

INSERT IGNORE INTO reviews (id, article_id, reviewer_id, strengths, weaknesses, recommendation, status, updated_at, submitted_at) VALUES
  ('art_demo_1__rev_2', 'art_demo_1', 'rev_2',
   'Metodología sólida y bien documentada. Resultados reproducibles.',
   'Falta comparación con métodos centralizados del estado del arte.',
   'minor-revisions', 'submitted', UNIX_TIMESTAMP()*1000, (UNIX_TIMESTAMP()-3*86400)*1000),

  ('art_demo_3__rev_1', 'art_demo_3', 'rev_1',
   'Revisión exhaustiva de la literatura. Clasificación clara de vectores de ataque.',
   'Propuesta de mitigaciones poco desarrollada en la sección 4.',
   'minor-revisions', 'submitted', UNIX_TIMESTAMP()*1000, (UNIX_TIMESTAMP()-2*86400)*1000),

  ('art_demo_3__rev_2', 'art_demo_3', 'rev_2',
   'Casos de estudio bien seleccionados. Buena estructura general.',
   'Las métricas de evaluación de riesgo no están bien justificadas.',
   'major-revisions', 'submitted', UNIX_TIMESTAMP()*1000, (UNIX_TIMESTAMP()-1*86400)*1000);

-- Comentarios de ejemplo en revisión art_demo_3__rev_1
INSERT IGNORE INTO review_comments (id, review_id, article_id, author_role, author_name, author_id, content, created_at) VALUES
  ('cmt_1', 'art_demo_3__rev_1', 'art_demo_3', 'reviewer', 'Dra. Ana Martínez', 'rev_1',
   'Sugiero expandir la sección 4 con al menos 3 propuestas de mitigación concretas con métricas de efectividad.', (UNIX_TIMESTAMP()-1*86400)*1000),
  ('cmt_2', 'art_demo_3__rev_1', 'art_demo_3', 'editor',   'Dr. Ramírez',       'editor_1',
   'Estoy de acuerdo con el revisor. El autor debe responder a estos comentarios antes de la siguiente ronda.', (UNIX_TIMESTAMP()-86400+3600)*1000);

SELECT 'Base de datos PeerFlow v2 (MySQL) inicializada correctamente ✓' AS resultado;
