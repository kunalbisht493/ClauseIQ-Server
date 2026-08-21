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
| `POST` | `/api/documents/upload` | User | Upload PDF contract, parse text, generate vectors, and queue analysis |
| `GET` | `/api/documents` | User | List all uploaded documents for current user |
| `GET` | `/api/documents/:id` | User | Get document status and metadata |
| `DELETE`| `/api/documents/:id` | User | Delete document, MongoDB records, and Qdrant vector chunks |
| `GET` | `/api/analyses/:documentId` | User | Retrieve risk analysis and full Q&A history |
| `POST` | `/api/analyses/:documentId/qa` | User | Ask a clause-specific question (RAG + Jina reranking) |

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

## 🚀 Production Deployment (Render)

1. Connect your GitHub repository to **Render**.
2. Set Service Type: **Web Service**.
3. **Build Command**: `npm install`
4. **Start Command**: `node server.js` (or `npm start`)
5. Add the Environment Variables from `.env.example` in the **Environment** tab.
6. Set `AUTO_VERIFY_EMAIL=true` and `RESEND_API_KEY=re_...` for reliable cloud delivery.
