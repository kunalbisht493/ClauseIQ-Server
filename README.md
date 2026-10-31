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
- [Performance Benchmark](#-performance-benchmark)
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
- Benchmark calculation & monotonic timing logic (`tests/benchmark-calculation.test.js`)

```bash
npm test
```

---

## 📊 Performance Benchmark

ClauseIQ includes an automated performance benchmark suite ([`run-benchmark.js`](run-benchmark.js)) and modular calculation engine ([`benchmark-calculation.js`](benchmark-calculation.js)) designed to measure end-to-end processing and streaming Q&A performance across real commercial legal contracts from the **CUAD (Contract Understanding Atticus Dataset)**.

### 1. Two Strictly Independent Timers

To ensure clean, unpolluted data, the benchmark records two **completely independent** timers using monotonic clocks (`performance.now()`):

```
[Contract Upload Initiated] ─────── TIMER 1 (Document Processing) ───────► [Status: 'ready' Stored]
                                                                                  │
                                                                       Document is fully ready
                                                                                  │
[Question Submitted to SSE] ──────── TIMER 2 (Independent Q&A) ──────────► [Stream Parse Complete]
```

- **Timer 1: Document Processing Time (`documentProcessingTimeSec`)**:
  - **Start Point**: Monotonic timestamp when the multipart upload request (`POST /api/documents`) begins.
  - **End Point**: Monotonic timestamp when the client/poller detects `document.status === 'ready'` (meaning native/OCR text extraction, chunking, 768-dim Gemini vector embedding, Qdrant upserts, and LLM risk analysis scoring are fully written to MongoDB).
  - **Independence Rule**: Measures only ingestion and risk audit. Q&A execution is never included.

- **Timer 2: Complete Q&A Response Time (`qnaResponseTimeSec`)**:
  - **Start Point**: A **brand new monotonic timer** initiated *strictly after* the document has completed processing and reached `'ready'`, at the exact moment the predefined question is sent to `POST /api/analyses/:id/questions/stream`.
  - **End Point**: Monotonic timestamp when the Server-Sent Events stream emits `event: done`, and the reader finishes parsing the complete answer text and excerpt citations.
  - **Independence Rule**: Document upload and background processing times are **never** added to Q&A measurements.

---

### 2. Rate-Limit Handling (Gemini 429 & RESOURCE_EXHAUSTED)

Under Google Gemini Free Tier quotas (30,000 tokens/min and 100 requests/min), large contracts can encounter API rate limits during vector embedding:

- **Evidence-Based Detection**: The benchmark inspects API error payloads for verified `429` status codes, `RESOURCE_EXHAUSTED`, or `quota exceeded` markers. Ordinary slow processing is **never** classified as rate limiting without concrete error evidence.
- **Quota Recovery Pause**: The verified waiting delay (e.g. from `retryDelay: "55s"` or `Please retry in 55.99s`) is parsed and recorded separately. The test runner pauses for the exact duration of the recovery window and then resumes processing.
- **Adjusted vs. Actual Times**:
  - Actual elapsed monotonic time is always preserved in `documentProcessingTimeSec` and `qnaResponseTimeSec`.
  - Only confirmed quota waiting time is subtracted to compute the adjusted processing times.

---

### 3. Timing Formulas

All calculations are encapsulated in [`benchmark-calculation.js`](benchmark-calculation.js):

$$\text{documentProcessingTimeSec} = \frac{t_{\text{DocReady}} - t_{\text{DocUploadStart}}}{1000}$$

$$\text{documentAdjustedTimeSec} = \max\left(0,\, \text{documentProcessingTimeSec} - \text{documentRateLimitWaitSec}\right)$$

$$\text{qnaResponseTimeSec} = \frac{t_{\text{QnaComplete}} - t_{\text{QnaSubmit}}}{1000}$$

$$\text{qnaAdjustedTimeSec} = \max\left(0,\, \text{qnaResponseTimeSec} - \text{qnaRateLimitWaitSec}\right)$$

---

### 4. Output JSON Fields (`benchmark_results.json`)

Each benchmark record in [`benchmark_results.json`](benchmark_results.json) adheres to the following schema:

| Field Name | Type | Description |
| :--- | :---: | :--- |
| `fileName` | `string` | Basename of the legal PDF contract |
| `fileSizeKb` | `number` | Contract file size in kilobytes |
| `documentProcessingTimeSec` | `number` | Actual elapsed monotonic time from upload start until risk report is ready (seconds) |
| `documentRateLimitWaitSec` | `number` | Confirmed Gemini quota wait time during document processing (seconds, 0 if none) |
| `documentAdjustedTimeSec` | `number` | Document processing time excluding verified quota wait (`documentProcessingTimeSec - documentRateLimitWaitSec`) |
| `qnaResponseTimeSec` | `number` | Independent elapsed time for complete streaming Q&A response (seconds) |
| `qnaRateLimitWaitSec` | `number` | Confirmed quota wait time during Q&A (seconds, 0 if none) |
| `qnaAdjustedTimeSec` | `number` | Q&A response time excluding verified quota wait (`qnaResponseTimeSec - qnaRateLimitWaitSec`) |
| `status` | `string` | Final document status (`ready` or `failed`) |

---

### 5. How to Run the Benchmark

#### Prerequisites
Ensure your local `.env` contains valid credentials:
- `MONGODB_URI` (MongoDB Atlas instance)
- `GEMINI_API_KEY` (Google Gemini API key)
- `QDRANT_URL` & `QDRANT_API_KEY` (Qdrant Cloud vector database)

#### Execution Commands
```bash
# Run benchmark using default contract locations
npm run benchmark

# Or specify a custom folder containing legal PDF contracts
node run-benchmark.js "C:\path\to\your\contracts_folder"

# Or run specific contract files
node run-benchmark.js contract1.pdf contract2.pdf

# Re-run all contracts fresh from scratch (ignoring cached results)
node run-benchmark.js --fresh
```

---

### 6. Actual Benchmark Results (10 Real Legal Contracts from CUAD)

Evaluated across 10 commercial agreements from CUAD (*Affiliate Agreements* and *Agency Agreements*):

#### Overall Statistical Summary

| Benchmark Metric | Mean (Average) | Median ($p_{50}$) | Minimum | Maximum | Failure Rate |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Document Processing Time** | **72.23 s** | **12.50 s** | 4.33 s | 341.02 s | 0.0% |
| **Document Quota Wait Time** | 29.23 s | 0.00 s | 0.00 s | 137.54 s | - |
| **Document Adjusted Time** | **43.00 s** | **9.55 s** | 4.33 s | 341.02 s | **0.0%** |
| **Q&A Response Time (Independent)** | **2.66 s** | **2.57 s** | 2.08 s | 3.90 s | 0.0% |
| **Q&A Adjusted Time** | **2.66 s** | **2.57 s** | 2.08 s | 3.90 s | **0.0%** |

*Note: For contracts with >50 chunks, quota waiting reflects Gemini Free Tier 30k tokens/min replenishment windows.*

#### 10-Contract Individual Measurement Breakdown

| # | Legal Contract File | Size (KB) | Document Processing (s) | Quota Wait (s) | Document Adjusted (s) | Q&A Response (s) | Status |
| :-: | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **1** | `CreditcardscomInc_Affiliate Agreement.pdf` | 130.8 | 13.11 s | 0.00 s | 13.11 s | 3.09 s | `ready` |
| **2** | `CybergyHoldingsInc_Affiliate Agreement.pdf` | 131.2 | 6.51 s | 0.00 s | 6.51 s | 2.58 s | `ready` |
| **3** | `DigitalCinemaDestinations_Affiliate Agreement.pdf` | 212.8 | 11.88 s | 0.00 s | 11.88 s | 2.49 s | `ready` |
| **4** | `LinkPlusCorp_Affiliate Agreement.pdf` | 86.1 | 77.72 s | 70.49 s | 7.23 s | 2.75 s | `ready` |
| **5** | `SouthernStarEnergyInc_Affiliate Agreement.pdf` | 86.3 | 6.41 s | 0.00 s | 6.41 s | 2.11 s | `ready` |
| **6** | `SteelVaultCorp_Affiliate Agreement.pdf` | 79.4 | 6.55 s | 0.00 s | 6.55 s | 2.82 s | `ready` |
| **7** | `ATHENSBANCSHARESCORP_AGENCY AGREEMENT.PDF` | 174.9 | 99.20 s | 84.23 s | 14.97 s | 2.56 s | `ready` |
| **8** | `BONTONSTORESINC_AGENCY AGREEMENT.PDF` | 505.1 | 155.57 s | 137.54 s | 18.03 s | 2.17 s | `ready` |
| **9** | `OLDAPIWIND-DOWNLTD_AGENCY AGREEMENT1.pdf` | 230.0 | 341.02 s | 0.00 s | 341.02 s | 3.90 s | `ready` |
| **10** | `OLDAPIWIND-DOWNLTD_AGENCY AGREEMENT2.pdf` | 97.4 | 4.33 s | 0.00 s | 4.33 s | 2.08 s | `ready` |

---

## 🚀 Production Deployment (Render)

1. Connect your GitHub repository to **Render**.
2. Set Service Type: **Web Service**.
3. **Build Command**: `npm install`
4. **Start Command**: `node server.js` (or `npm start`)
5. Add the Environment Variables from `.env.example` in the **Environment** tab.
6. Set `AUTO_VERIFY_EMAIL=true` and `RESEND_API_KEY=re_...` for reliable cloud delivery.
