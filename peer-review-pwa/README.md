# PeerFlow — Sistema de Revisión por Pares (PWA Offline-First)

## Arquitectura: Offline-First con Sincronización

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CLIENTE (PWA)                                │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────────────────┐    │
│  │  Service  │  │  UI (Views)  │  │  IndexedDB (Local Store)   │    │
│  │  Worker   │  │  Dashboard   │  │  • articles                │    │
│  │  (Cache   │  │  ArticleForm │  │  • reviewers               │    │
│  │  AppShell)│  │  AssignView  │  │  • assignments             │    │
│  └──────────┘  │  ReviewForm  │  │  • reviews                 │    │
│                │  AuthorStatus│  │  • sync_queue ← NEW        │    │
│                └──────┬───────┘  └────────────┬───────────────┘    │
│                       │                        │                    │
│                ┌──────▼───────┐   ┌────────────▼──────────────┐    │
│                │   Services   │   │      SyncService           │    │
│                │  Article     │──▶│  • Detecta online/offline  │    │
│                │  Assignment  │   │  • Lee sync_queue pendiente│    │
│                │  Review      │   │  • Envía al backend        │    │
│                │  Reviewer    │   │  • Marca como sincronizado │    │
│                └──────────────┘   └────────────┬───────────────┘    │
└──────────────────────────────────────────────┬─┴────────────────────┘
                                               │ HTTP / REST
                                               │ (cuando hay internet)
┌──────────────────────────────────────────────▼────────────────────┐
│                    SERVIDOR (Node.js + Express)                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  REST API                                                    │   │
│  │  POST   /api/articles        GET    /api/articles            │   │
│  │  PATCH  /api/articles/:id    POST   /api/reviewers           │   │
│  │  POST   /api/assignments     PUT    /api/reviews/:id         │   │
│  │  POST   /api/reviews/:id/submit                              │   │
│  │  POST   /api/sync/bulk  ← NUEVO (Incremento 5)              │   │
│  │  GET    /api/health                                          │   │
│  └───────────────────────────┬───────────────────────────────┘   │
│                               │                                    │
│  ┌────────────────────────────▼──────────────────────────────┐    │
│  │                    MariaDB                                  │    │
│  │  articles │ reviewers │ assignments │ reviews              │    │
│  └────────────────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────────────┘
```

---

## Diagrama de Componentes (Incremento 5 – Nueva Arquitectura)

```
Infra PWA
├── Service Worker (Cache App Shell: HTML/CSS/JS)
├── Web App Manifest (instalación)
└── Cache Storage (estáticos)

UI (Pantallas)
├── Router (navegación SPA)
├── DashboardView (tablero + indicador de sync)
├── ArticleFormView (crear/editar artículo)
├── EditorAssignView (asignar revisores)
├── ReviewFormView (formulario offline + autosave)
└── AuthorStatusView (leer revisiones)

Lógica de Negocio (Servicios)
├── ArticleService (CRUD + estado)
├── AssignmentService (asignar + deadline)
├── ReviewService (borrador + envío)
├── ReviewerService (gestión de revisores)
├── StatusPolicy (reglas: recibido→en revisión→comentarios listos)
└── ValidationUtils (validaciones básicas)

Persistencia Local (IndexedDB)
├── IdbClient (wrapper: openDB, put, get, getAll, getByIndex)
├── ArticleRepo   → store: articles
├── ReviewerRepo  → store: reviewers
├── AssignmentRepo → store: assignments
├── ReviewRepo    → store: reviews
└── SyncQueueRepo → store: sync_queue  ← NUEVO

Sincronización (SyncService) ← NUEVO
├── Detecta online/offline (window events)
├── Lee sync_queue (pendientes)
├── processSyncItem(): mapea operación → endpoint REST
├── markSynced() / markFailed()
├── syncNow() → resultado: { synced, failed }
├── scheduleSync() → auto-sync al reconectar
└── checkServerConnection() → fetch /api/health

Backend API (Node.js + Express)
├── GET/POST /api/articles
├── PATCH /api/articles/:id
├── GET/POST /api/reviewers
├── DELETE /api/reviewers/:id
├── POST /api/assignments
├── PUT /api/reviews/:id (draft)
├── POST /api/reviews/:id/submit
├── POST /api/sync/bulk   ← Incremento 5
└── GET /api/health

Base de Datos (MariaDB)
├── articles (id, title, author, status, ...)
├── reviewers (id, name, email, specialty)
├── assignments (id, article_id, reviewer_id, due_at)
└── reviews (id, article_id, reviewer_id, status, ...)
```

---

## Diagrama de Secuencia — Sincronización Offline→Online

```
Revisor       ReviewFormView    ReviewService    SyncQueueRepo    SyncService      API /reviews
   |                |                |                |               |                |
   | Sin internet   |                |                |               |                |
   |--escribir----→|                |                |               |                |
   |--saveDraft---→|                |                |               |                |
   |                |--saveDraft--→|                |               |                |
   |                |               |--ReviewRepo.upsert()          |                |
   |                |               |--SyncQueueRepo.enqueue(draft)|               |
   |                |               |                |←──ok─────────|               |
   |                |               |←──saved────────|               |               |
   |                |←──borrador guardado            |               |               |
   |                |                                |               |               |
   | [recupera internet]                             |               |               |
   |                |                                |   online event|               |
   |                |                                |──────────────→|               |
   |                |                                |               |--scheduleSync()|
   |                |                                |               |               |
   |                |                                |               |--getPending()→|
   |                |                                |←──pending[]───|               |
   |                |                                |               |               |
   |                |                                |               | para cada item:|
   |                |                                |               |--PUT /reviews/:id→
   |                |                                |               |              |←ok
   |                |                                |               |--markSynced()|
   |                |                                |               |               |
   |                |                                |               |--emit('sync-complete')
   |                |                                |               |               |
   |                |←──toast: "X cambios sincronizados"            |               |
```

---

## Diagrama de Secuencia — Sincronización Bulk (Incremento 5)

```
SyncService          API /sync/bulk         MariaDB
    |                      |                    |
    |--POST /sync/bulk---->|                    |
    |  [{entity,op,data}]  |                    |
    |                      | para cada op:      |
    |                      |--INSERT/UPDATE---->|
    |                      |←──ok──────────────|
    |                      |                    |
    |←──{synced:N, failed:M, results:[...]}─────|
    |                      |                    |
    |--markSynced(ids)      |                    |
    |--clearSynced()        |                    |
```

---

## Plan de Incrementos

| # | Escenario | Componentes Nuevos | Entregable |
|---|-----------|-------------------|------------|
| 1 | Ver tablero (offline) | DashboardView, ArticleService, ArticleRepo, SW | PWA con lista dinámica desde IndexedDB |
| 2 | Editor crea artículo | ArticleFormView, ArticleService.create(), ArticleRepo.save() | Formulario guarda en IDB, aparece en tablero |
| 3 | Asignar revisores | EditorAssignView, AssignmentService, AssignmentRepo, StatusPolicy | Asignación con fecha límite, estado "En revisión" |
| 4 | Revisor guarda borrador offline | ReviewFormView, ReviewService, ReviewRepo | Borrador persiste sin internet, auto-save |
| 4b | Revisor envía revisión | ReviewForm submit, ReviewService.submit(), StatusPolicy.applyAfterSubmit() | Estado → "Comentarios listos" con ≥2 revisiones |
| 5 | **Sincronización bidireccional** | SyncQueueRepo, SyncService, POST /api/sync/bulk, MariaDB | Cambios offline se sincronizan al reconectar |

---

## Configuración e Instalación

### Frontend (PWA)
Servir los archivos estáticos con cualquier servidor HTTP:
```bash
# Con Python (sin instalar nada)
python3 -m http.server 8080

# Con Node.js http-server
npx http-server . -p 8080

# Abrir: http://localhost:8080
```

### Backend (Incremento 5)
```bash
# 1. Instalar dependencias
npm install

# 2. Configurar MariaDB
mysql -u root -p
CREATE DATABASE peerflow_db;
CREATE USER 'peerflow_user'@'localhost' IDENTIFIED BY 'peerflow_pass';
GRANT ALL ON peerflow_db.* TO 'peerflow_user'@'localhost';
FLUSH PRIVILEGES;

# 3. Iniciar servidor
npm start
# → API disponible en http://localhost:3001
```

### Variables de entorno
```env
DB_HOST=localhost
DB_USER=peerflow_user
DB_PASS=peerflow_pass
DB_NAME=peerflow_db
PORT=3001
```

---

## Stack Tecnológico

| Capa | Tecnología |
|------|-----------|
| Frontend | Vanilla JS (ES Modules), HTML5, CSS3 |
| Offline Storage | IndexedDB (Web API nativa) |
| PWA | Service Worker + Cache Storage API + Web App Manifest |
| Sync Queue | IndexedDB store `sync_queue` |
| Backend | Node.js + Express |
| Base de datos | MariaDB |
| Comunicación | REST/JSON (HTTP fetch) |

---

*Meta 1.4 — Ingeniería de Software asistida por IA · UABC FIM*
*Benitez Lopez Cesar Alfonso · 2026*
