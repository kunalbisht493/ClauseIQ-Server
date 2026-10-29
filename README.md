# ClauseIQ — Backend API ⚖️🤖

> Enterprise-grade REST API for PDF contract risk analysis, legal clause extraction, and Retrieval-Augmented Generation (RAG) Q&A.

---

## 📋 Table of Contents
- [Overview](#-overview)
- [Tech Stack](#️-tech-stack)
- [System Architecture](#-system-architecture)
- [Key Features](#-key-features)
- [Environment Variables](#️-environment-variables)
- [API Reference](#-api-reference)
- [Health Check & 24/7 Keep-Alive](#-health-check--247-keep-alive)
- [Getting Started](#-getting-started)
- [Testing](#-testing)
- [Performance Benchmark (CUAD Dataset)](#-performance-benchmark-cuad-dataset)
- [Production Deployment (Render)](#-production-deployment-render)

---

## 🌟 Overview
ClauseIQ Backend is a high-performance, secure Node.js & Express API designed to ingest legal agreements (PDFs), extract clauses (with Gemini Vision OCR fallback for scanned contracts), generate vector embeddings, identify potential commercial & legal risks, and provide conversational clause explanations with precise citation grounding.

---

## 🛠️ Tech Stack
- **Runtime**: Node.js (v18+)
- **Web Framework**: Express 5
- **Database (NoSQL)**: MongoDB with Mongoose (User profiles, document metadata, multi-turn Q&A history)
- **Vector Database**: Qdrant Cloud (dense vector embeddings for semantic clause retrieval)
- **AI Models & LLMs**:
  - **Primary LLM**: Google Gemini (`gemini-3.5-flash` / `gemini-2.5-flash-lite`)
  - **Fallback LLM**: Groq (`openai/gpt-oss-120b` or `llama-3.3-70b-versatile`)
  - **OCR Engine**: Gemini Vision OCR fallback for image/scanned PDF contracts
  - **Embeddings**: Google Gemini Embedding (`gemini-embedding-001` — 768 dimensions)
  - **Cross-Encoder Reranker**: Jina AI Reranker (`jina-reranker-v2-base-multilingual`)
- **Authentication**: JWT in HttpOnly Cookies + Google OAuth 2.0 (Passport.js)
- **Email Delivery**:
  - **Primary (Cloud/Render)**: Resend HTTP REST API (Port 443 HTTPS)
  - **Fallback (Local)**: Nodemailer (Port 465 direct SSL)
- **Security**: Helmet, `express-rate-limit`, `bcryptjs`, dynamic multi-origin CORS

---

## 🚀 Key Features

### 1. Hybrid PDF Ingestion & OCR Fallback
- Direct digital PDF text extraction via `pdfjs-dist`.
- Scanned / flat image PDF detection: automatically invokes Google Gemini Vision OCR when digital text is empty, ensuring zero failed uploads.

### 2. Multi-Turn Clause Q&A & Risk Assessment
- Semantic chunking with token overlaps (`chunkSize: 500`, `chunkOverlap: 50`).
- Vector search via Qdrant with top-10 retrieval and Jina AI re-ranking (top-5).
- Multi-turn conversation persistence (`qaHistory`) with risk flag scoring and exact clause citations.

### 3. Bulletproof Auth & Account Security
- Google OAuth 2.0 with automatic account linking.
- Email verification with 5-minute single-use secure tokens.
- Password reset flow with SHA-256 tokens, **5-minute expiration**, and automatic MongoDB TTL invalidation.
- **Smart Auto-Verify**: Instant account activation for smooth user onboarding (`AUTO_VERIFY_EMAIL=true`).
- **On-Screen Reset Link Fallback**: When domain-restricted email delivery is active, provides secure direct password reset URLs.
- Strict password complexity validation (`8+ characters, uppercase, lowercase, number, special symbol`).

---

## ⚙️ Environment Variables

Create a `.env` file in the root of `/server` based on [`.env.example`](.env.example):

```ini
# ==============================================================================
# SERVER & APP CONFIGURATION
# ==============================================================================
NODE_ENV=development
PORT=5000
API_ORIGIN=http://localhost:5000
CLIENT_ORIGIN=http://localhost:5173

# ==============================================================================
# DATABASE (MongoDB Atlas)
# ==============================================================================
MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.mongodb.net/<database>?retryWrites=true&w=majority

# ==============================================================================
# AUTHENTICATION & SECURITY
# ==============================================================================
JWT_SECRET=your-secure-random-64-character-secret
JWT_EXPIRES_IN=7d
COOKIE_SECURE=false
AUTO_VERIFY_EMAIL=true

# ==============================================================================
# GOOGLE OAUTH 2.0
# ==============================================================================
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_CALLBACK_URL=http://localhost:5000/api/auth/google/callback

# ==============================================================================
# EMAIL DELIVERY (Resend HTTP API or Gmail SMTP)
# ==============================================================================
RESEND_API_KEY=re_your_resend_api_key_here
EMAIL_FROM=ClauseIQ <onboarding@resend.dev>
GMAIL_USER=your-email@gmail.com
GMAIL_APP_PASSWORD=your-16-character-app-password

# ==============================================================================
# AI & EMBEDDINGS (Google Gemini)
# ==============================================================================
GEMINI_API_KEY=your-google-gemini-api-key
GEMINI_MODEL=gemini-3.5-flash
GEMINI_EMBEDDING_MODEL=gemini-embedding-001
GEMINI_EMBEDDING_DIMENSIONS=768

# ==============================================================================
# LLM INFERENCE (Groq Cloud)
# ==============================================================================
GROQ_API_KEY=your-groq-api-key
GROQ_MODEL=openai/gpt-oss-120b

# ==============================================================================
# RERANKING SERVICE (Jina AI)
# ==============================================================================
JINA_API_KEY=your-jina-api-key
JINA_RERANK_MODEL=jina-reranker-v2-base-multilingual

# ==============================================================================
# VECTOR DATABASE (Qdrant Cloud)
# ==============================================================================
QDRANT_URL=https://your-cluster-id.cloud.qdrant.io
QDRANT_API_KEY=your-qdrant-api-key
QDRANT_COLLECTION=legal_document_chunks
```

---

## 📡 API Reference

### Health & Monitoring
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/health` | Pings MongoDB, checks Qdrant collection status, and returns email provider status |

### Authentication (`/api/auth`)
| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/register` | Public | Register new user with email & password (auto-verified if enabled) |
| `POST` | `/api/auth/login` | Public | Sign in with email & password |
| `GET` | `/api/auth/google` | Public | Initiate Google OAuth 2.0 flow |
| `GET` | `/api/auth/google/callback`| Public | Google OAuth redirect callback |
| `GET` | `/api/auth/me` | User | Get authenticated user profile |
| `POST` | `/api/auth/logout` | User | Clear session cookies & invalidate client session |
| `POST` | `/api/auth/forgot-password`| Public | Request password reset token / direct reset URL |
| `POST` | `/api/auth/reset-password` | Public | Consume token and set new password |
| `POST` | `/api/auth/resend-verification` | Public | Resend 5-minute email verification link |

### Documents & Analysis (`/api/documents` & `/api/analyses`)
| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/documents` | User | Upload a PDF. Returns **202** immediately with `status: "processing"`; parsing, embedding and risk analysis run in the background. Re-uploading identical bytes returns the existing document (**200**, `duplicate: true`) |
| `GET` | `/api/documents` | User | List all uploaded documents for current user |
| `GET` | `/api/documents/:id` | User | Poll for status: `processing` → `indexed` (Q&A already works) → `ready` (risk analysis stored), or `failed` |
| `DELETE`| `/api/documents/:id` | User | Delete document, MongoDB records, and Qdrant vector chunks |
| `GET` | `/api/analyses/:documentId` | User | Retrieve risk analysis and full Q&A history |
| `POST` | `/api/analyses/:documentId/questions` | User | Ask a question (RAG). Returns `{ answer, riskFlags, sources, qaEntry }` |
| `POST` | `/api/analyses/:documentId/questions/stream` | User | Same as above, as Server-Sent Events: `sources` → `token`* → `done` (or `error`) |

---

## 💓 Health Check & 24/7 Keep-Alive

The `/health` endpoint checks all critical dependencies on every request:
```json
{
  "status": "ok",
  "mongo": "ok",
  "qdrant": "ok",
  "emailConfigured": true,
  "emailProvider": "resend"
}
```

### Free 24/7 Uptime (cron-job.org / UptimeRobot):
Pinging `https://clauseiq-server.onrender.com/health` every **5 minutes** keeps:
1. **Render**: Permanently awake (0 spin-downs / 0 cold-start delays).
2. **MongoDB Atlas**: Database connection pool active.
3. **Qdrant Cloud**: Vector collection index loaded in memory.

---

## 💻 Getting Started

```bash
# 1. Install dependencies
npm install

# 2. Start development server with auto-reload
npm run dev

# 3. Run full automated test suite
npm test
```

---

## 🧪 Testing

The backend includes a comprehensive Jest test suite verifying:
- Health check endpoints & dependency timeouts (`tests/health.test.js`)
- PDF parsing & text extraction (`tests/pdf.service.test.js`)
- RAG pipeline & vector search (`tests/rag.service.test.js`)
- Risk analysis prompts & categorization (`tests/risk.service.test.js`)
- Email delivery & 5-minute token expiry (`tests/email.service.test.js`)

```bash
npm test
```

---

## 📊 Performance Benchmark (CUAD Dataset)

ClauseIQ includes an end-to-end performance benchmarking suite ([`run-benchmark.js`](run-benchmark.js)) designed to test the complete ingestion, vectorization, LLM risk analysis, and streaming Q&A lifecycle on real-world commercial contracts from the **CUAD (Contract Understanding Atticus Dataset)**.

### Measured Metrics
- **$T_{\text{upload}}$**: Immediate HTTP 202 Accepted upload acknowledgment latency.
- **$T_{\text{indexed}}$**: PDF text extraction & Qdrant vector indexing latency (the exact moment **interactive Q&A unlocks** for the user).
- **$T_{\text{ready}}$**: Full AI legal risk analysis, scoring, and flag generation completion latency.
- **$T_{\text{qa\_first\_token}}$ (TTFT)**: Time-To-First-Token for streaming legal Q&A over Server-Sent Events (SSE).
- **$T_{\text{qa\_total}}$**: Total streaming response duration.
- **$T_{\text{qa\_cached}}$**: In-memory LRU cache retrieval latency on repeated questions.

---

### How to Run the Benchmark

#### 1. Prerequisites
Ensure your local `.env` has valid credentials configured for:
- MongoDB Atlas (`MONGODB_URI`)
- Google Gemini API (`GEMINI_API_KEY`)
- Qdrant Cloud (`QDRANT_URL`, `QDRANT_API_KEY`)

#### 2. Specify Your Test PDFs
You can supply your contracts in three flexible ways:

- **Option A (CLI Arguments — Recommended)**:
  Pass PDF file paths or a directory containing PDFs directly:
  ```bash
  # Test an entire directory of contracts
  node run-benchmark.js ./contracts/

  # Or test specific contracts
  node run-benchmark.js contract1.pdf contract2.pdf
  ```

- **Option B (Environment Variable)**:
  Point to your contract folder before running:
  ```bash
  BENCHMARK_PDF_DIR=./path/to/contracts npm run benchmark
  ```

- **Option C (Edit `run-benchmark.js`)**:
  Open [`run-benchmark.js`](run-benchmark.js) and replace the paths in `defaultPdfFiles` with your local PDF file locations:
  ```javascript
  const defaultPdfFiles = [
    '/path/to/your/first_contract.pdf',
    '/path/to/your/second_contract.pdf',
    // add up to 10 or more contracts
  ];
  ```

#### 3. Execute Benchmark
```bash
# Run the benchmark (resumes previous progress if benchmark_results.json exists)
npm run benchmark

# Re-run all contracts fresh from scratch
node run-benchmark.js --fresh
```

#### 4. View Results
Benchmark data is automatically saved to [`benchmark_results.json`](benchmark_results.json).

---

### Benchmark Results (10 Real Legal Contracts from CUAD)

Evaluated against 10 real contracts from CUAD (Affiliate Agreements & Agency Agreements):

#### Overall Summary Statistics

| Metric | Description | Mean (Average) | Median ($p_{50}$) | Min | Max |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **$T_{\text{upload}}$** | HTTP 202 Accepted response | **1,232.42 ms** | **424.18 ms** | 118.38 ms | 4,382.82 ms |
| **$T_{\text{indexed}}$** | Vectors indexed (**Q&A Unlocked**) | **31.95 s** | **6.92 s** | 2.23 s | 147.15 s* |
| **$T_{\text{ready}}$** | Full AI risk analysis stored | **33.50 s** | **8.67 s** | 3.31 s | 147.15 s* |
| **$T_{\text{qa\_first\_token}}$** | Time-To-First-Token (TTFT streaming) | **3.15 s** | **3.04 s** | 1.75 s | 5.05 s |
| **$T_{\text{qa\_total}}$** | Full streaming answer round-trip | **3.91 s** | **3.79 s** | 1.98 s | 6.04 s |
| **$T_{\text{qa\_cached}}$** | In-memory LRU cache hit | **134.45 ms** | **99.46 ms** | 72.68 ms | 441.37 ms |

*\* Large contracts (>170 KB, up to 104 chunks) hit Gemini Free Tier 30,000 tokens/min limit; automatic quota backoff safely paused and resumed.*

#### 10-Contract Timing Breakdown

| # | Contract File | Size | Chunks | Risks | $T_{\text{upload}}$ | $T_{\text{indexed}}$ (Q&A ready) | $T_{\text{ready}}$ (Full report) | TTFT | Q&A Total | Cached Q&A |
| :-: | :--- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| **1** | `CreditcardscomInc_Affiliate Agreement` | 130.8 KB | 14 | 7 | 4,383 ms | 12.58 s | 13.20 s | 2.00 s | 2.81 s | 86.4 ms |
| **2** | `CybergyHoldingsInc_Affiliate Agreement` | 131.2 KB | 16 | 11 | 332 ms | 5.00 s | 8.75 s | 2.23 s | 2.87 s | 72.7 ms |
| **3** | `DigitalCinemaDestinations_Affiliate Agreement` | 212.8 KB | 51 | 10 | 3,003 ms | 17.96 s | 21.18 s | 4.55 s | 5.63 s | 115.0 ms |
| **4** | `LinkPlusCorp_Affiliate Agreement` | 86.1 KB | 15 | 6 | 219 ms | 2.23 s | 4.30 s | 3.60 s | 4.20 s | 97.5 ms |
| **5** | `SouthernStarEnergyInc_Affiliate Agreement` | 86.3 KB | 17 | 8 | 516 ms | 5.35 s | 8.60 s | 3.49 s | 4.30 s | 122.2 ms |
| **6** | `SteelVaultCorp_Affiliate Agreement` | 79.4 KB | 9 | 7 | 118 ms | 3.49 s | 5.03 s | 4.19 s | 4.99 s | 101.4 ms |
| **7** | `ATHENSBANCSHARESCORP_AGENCY AGREEMENT` | 174.9 KB | 64 | 7 | 2,741 ms | 114.99 s | 114.99 s | 5.05 s | 6.04 s | 441.4 ms |
| **8** | `BONTONSTORESINC_AGENCY AGREEMENT` | 505.1 KB | 104 | 10 | 185 ms | 147.15 s | 147.15 s | 2.06 s | 2.91 s | 85.9 ms |
| **9** | `OLDAPIWIND-DOWNLTD_AGENCY AGREEMENT1` | 230.0 KB | 45 | 6 | 156 ms | 8.49 s | 8.49 s | 2.59 s | 3.39 s | 145.3 ms |
| **10** | `OLDAPIWIND-DOWNLTD_AGENCY AGREEMENT2` | 97.4 KB | 2 | 2 | 672 ms | 2.30 s | 3.31 s | 1.75 s | 1.98 s | 76.8 ms |

---

## 🚀 Production Deployment (Render)

1. Connect your GitHub repository to **Render**.
2. Set Service Type: **Web Service**.
3. **Build Command**: `npm install`
4. **Start Command**: `node server.js` (or `npm start`)
5. Add the Environment Variables from `.env.example` in the **Environment** tab.
6. Set `AUTO_VERIFY_EMAIL=true` and `RESEND_API_KEY=re_...` for reliable cloud delivery.
