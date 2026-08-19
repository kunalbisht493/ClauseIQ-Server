# ClauseIQ — Backend API ⚖️🤖

> Enterprise-grade REST API for PDF contract risk analysis, legal clause extraction, and Retrieval-Augmented Generation (RAG) Q&A.

---

## 📋 Table of Contents
- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [System Architecture](#system-architecture)
- [Key Features](#key-features)
- [Environment Variables](#environment-variables)
- [AI Model Deprecation & Lifecycle Policy](#️-ai-model-deprecation--lifecycle-policy)
- [API Reference](#api-reference)
- [Getting Started](#getting-started)
- [Testing](#testing)
- [Docker & Containerization](#docker--containerization)
- [Production Deployment](#production-deployment)

---

## 🌟 Overview
ClauseIQ Backend is a high-performance, secure Node.js & Express API designed to ingest legal PDF agreements, extract clauses (including scanned documents via OCR fallback), generate vector embeddings, identify potential commercial & legal risks, and provide conversational clause explanations with precise citations.

---

## 🛠️ Tech Stack
- **Runtime**: Node.js (v18+)
- **Web Framework**: Express 5
- **Database (NoSQL)**: MongoDB with Mongoose (User management, document metadata, multi-turn Q&A history)
- **Vector Database**: Qdrant Cloud (dense embeddings for legal clause search)
- **AI Models & LLMs**:
  - **Primary LLM**: Google Gemini (`gemini-3.5-flash` / `gemini-2.5-flash-lite`)
  - **Fallback LLM**: Groq (`openai/gpt-oss-120b`, or active models like `llama-3.3-70b-versatile`)
  - **OCR Engine**: Gemini Vision OCR fallback for image/scanned PDFs
  - **Embeddings**: Google Gemini Embedding (`gemini-embedding-001`)
  - **Reranker**: Jina AI Reranker (`jina-reranker-v2-base-multilingual`)
- **Authentication**: JWT in HttpOnly Cookies + Google OAuth 2.0 (Passport.js)
- **Email Delivery**: Nodemailer (SMTP / Gmail App Password)
- **Security**: Helmet, `express-rate-limit`, `bcryptjs`

---

## 🚀 Key Features

### 1. Hybrid PDF Ingestion & OCR Fallback
- Direct digital PDF text extraction via `pdfjs-dist`.
- Scanned / flat image PDF detection: automatically invokes Google Gemini Vision OCR when digital text is empty, ensuring zero failed uploads.

### 2. Multi-Turn Clause Q&A & Risk Assessment
- Semantic chunking with token overlaps.
- Vector search via Qdrant with top-k retrieval and Jina AI re-ranking.
- Multi-turn conversation persistence (`qaHistory`) with risk flag scoring and exact clause citations.

### 3. Bulletproof Auth & Account Security
- Google OAuth 2.0 with automatic account linking.
- Email verification with 5-minute single-use secure tokens.
- Password reset flow with SHA-256 tokens, **5-minute expiration**, and automatic MongoDB TTL invalidation.
- Strict password complexity regex (`8+ characters, uppercase, lowercase, number, special symbol`).
- Graceful support for Google-only users transitioning to email/password authentication.

---

## ⚙️ Environment Variables

Create a `.env` file in the root of `/server`:

```ini
# Server Configuration
NODE_ENV=development
PORT=5000
CLIENT_ORIGIN=http://localhost:5173
API_ORIGIN=http://localhost:5000
COOKIE_SECURE=false

# Database & Vector DB
MONGODB_URI=mongodb://localhost:27017/clauseiq
QDRANT_URL=https://your-cluster-id.cloud.qdrant.io
QDRANT_API_KEY=your-qdrant-api-key
QDRANT_COLLECTION=legal_document_chunks

# Authentication & Security
JWT_SECRET=your-secure-random-64-character-secret
JWT_EXPIRES_IN=7d

# Google OAuth 2.0
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_CALLBACK_URL=http://localhost:5000/api/auth/google/callback

# Email / SMTP
GMAIL_USER=your-email@gmail.com
GMAIL_APP_PASSWORD=your-16-character-app-password
EMAIL_FROM=ClauseIQ <your-email@gmail.com>

# AI & LLM Providers
GEMINI_API_KEY=your-gemini-api-key
GEMINI_MODEL=gemini-3.5-flash
GEMINI_EMBEDDING_MODEL=gemini-embedding-001
GEMINI_EMBEDDING_DIMENSIONS=768
GROQ_API_KEY=your-groq-api-key
GROQ_MODEL=openai/gpt-oss-120b

# Reranking & Retrieval
JINA_API_KEY=your-jina-api-key
JINA_RERANK_MODEL=jina-reranker-v2-base-multilingual
RAG_CHUNK_SIZE=500
RAG_CHUNK_OVERLAP=50
RAG_TOP_K=10
RAG_RERANK_TOP_K=5
```

---

## ⚠️ AI Model Deprecation & Lifecycle Policy

Free-tier, preview, and open-source models on external providers (**Groq** and **Google Gemini**) are frequently subject to provider retirement schedules, context changes, or replacement by newer generation checkpoints.

> [!WARNING]
> **What to do if a model is deprecated or returns a 404/400 error:**
> If a model (such as `openai/gpt-oss-120b` or `gemini-3.5-flash`) is deprecated or retired by the provider, **no codebase modification or rebuild is necessary**. The backend is completely decoupled: simply update the corresponding environment variable in your `.env` (or cloud hosting dashboard) to any currently supported model from the table below.

### Supported / Tested Model Reference

| Provider | Config Key | Configured Model | Recommended Alternatives if Deprecated |
| :--- | :--- | :--- | :--- |
| **Google Gemini** (Primary LLM) | `GEMINI_MODEL` | `gemini-3.5-flash` | `gemini-2.5-flash-lite`, `gemini-2.5-flash`, `gemini-1.5-flash` |
| **Groq** (Failover LLM) | `GROQ_MODEL` | `openai/gpt-oss-120b` | `llama-3.3-70b-versatile`, `llama-3.1-8b-instant`, `mixtral-8x7b-32768` |
| **Google Gemini** (Embeddings) | `GEMINI_EMBEDDING_MODEL` | `gemini-embedding-001` | `text-embedding-004` |
| **Jina AI** (Reranker) | `JINA_RERANK_MODEL` | `jina-reranker-v2-base-multilingual` | `jina-reranker-v1-base-en` |

---

## 📡 API Reference

### Auth Endpoints (`/api/auth`)
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/auth/register` | Register with email & strong password |
| `POST` | `/api/auth/login` | Sign in with email & password |
| `POST` | `/api/auth/logout` | Clear session cookie |
| `GET` | `/api/auth/me` | Fetch authenticated user profile |
| `GET` | `/api/auth/google` | Trigger Google OAuth 2.0 flow |
| `GET` | `/api/auth/google/callback` | Google OAuth callback handler |
| `GET` | `/api/auth/verify-email?token=...` | Confirm email verification token |
| `POST` | `/api/auth/resend-verification` | Resend activation link |
| `POST` | `/api/auth/forgot-password` | Send 5-minute password reset link |
| `POST` | `/api/auth/reset-password` | Set new password with reset token |
| `POST` | `/api/auth/change-password` | Update password (or initialize for Google users) |
| `DELETE` | `/api/auth/me` | Delete account and associated data |

### Document & Analysis Endpoints (`/api/documents` & `/api/analyses`)
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/documents/upload` | Upload PDF contract for background processing |
| `GET` | `/api/documents` | List uploaded contracts with status |
| `GET` | `/api/documents/:id` | Get document analysis, risk scores, and summary |
| `DELETE` | `/api/documents/:id` | Delete document and remove Qdrant vector chunks |
| `POST` | `/api/analyses/:id/ask` | Ask clause questions (RAG + citations + multi-turn history) |
| `GET` | `/api/analyses/:id/history` | Retrieve full Q&A conversation history |

### Health Check
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/health` | Live probe checking MongoDB & Qdrant connectivity |

---

## 💻 Getting Started

### Prerequisites
- Node.js 18+ and npm installed
- MongoDB instance (local or Atlas)
- Qdrant cluster (cloud or local docker)

### Installation
```bash
# 1. Navigate to server directory
cd server

# 2. Install dependencies
npm install

# 3. Create .env configuration
cp .env.example .env

# 4. Start development server with live reload
npm run dev
```

The server will be available at `http://localhost:5000`.

---

## 🧪 Testing

The server includes end-to-end unit and integration tests written with **Jest** and **Supertest**:

```bash
# Run all test suites
npm test
```

All 5 core test suites:
- `tests/health.test.js`: Health check probes & timeouts
- `tests/pdf.service.test.js`: PDF parser with Gemini OCR fallback
- `tests/rag.service.test.js`: RAG retrieval pipeline & Groq fallback
- `tests/risk.service.test.js`: Clause risk evaluation
- `tests/email.service.test.js`: Email verification & 5-minute reset links

---

## 🐳 Docker & Containerization

Build and run using Docker Compose:

```bash
# Start server + local dependencies
docker compose up --build
```

---

## 🚢 Production Deployment

1. **Platform**: Deploy on **Render**, **Railway**, **Fly.io**, or **AWS ECS**.
2. **Environment**:
   - Set `NODE_ENV=production`
   - Set `COOKIE_SECURE=true`
   - Set `CLIENT_ORIGIN=https://your-frontend-domain.com`
   - Set `API_ORIGIN=https://your-api-domain.com`
3. **Start Command**: `npm start`
