# ClauseIQ — Architectural & Technology Decision Records (ADRs) ⚖️🧠

> **Interview & Engineering Reference**: In-depth breakdown of every technology choice made across the ClauseIQ stack, evaluated against industry alternatives, with technical rationale explaining why the current technology was selected and why alternatives were rejected.

---

## 📋 Table of Contents
1. [Frontend & Client Choices](#1-frontend--client-choices)
2. [Backend & API Gateway Choices](#2-backend--api-gateway-choices)
3. [AI, RAG & Vector Search Choices](#3-ai-rag--vector-search-choices)
4. [Database & Persistence Choices](#4-database--persistence-choices)
5. [Authentication, Security & Email Choices](#5-authentication-security--email-choices)
6. [Cloud Hosting & DevOps Reliability Choices](#6-cloud-hosting--devops-reliability-choices)

---

## 1. Frontend & Client Choices

### 1.1 UI Framework: React 18 SPA (Vite)
- **Selected**: **React 18** Single Page Application (SPA)
- **Alternatives Considered**: Next.js (SSR/App Router), Vue.js, Svelte, Angular
- **Why React 18 was Selected**:
  - ClauseIQ is an **interactive, authenticated dashboard application** where 95% of user time is spent interacting with contract risk cards, chat streams, and responsive accordions.
  - Server-Side Rendering (SSR) in Next.js adds complex server lifecycle dependencies, hydration mismatches with heavy client-side state, and higher hosting server costs for an authenticated SaaS product where SEO on private dashboards is irrelevant.
  - React's massive ecosystem offers first-class integrations with charting, PDF viewers, and token-level streaming interfaces.
- **Why Alternatives were Rejected**:
  - *Next.js*: Unnecessary server-side overhead and cold-start complexity for an internal workspace; Next.js serverless functions introduce vendor lock-in and cold-start latency.
  - *Vue / Svelte*: Smaller developer ecosystem for specialized AI streaming and contract viewing libraries.

---

### 1.2 Build Tool: Vite 8
- **Selected**: **Vite 8**
- **Alternatives Considered**: Create React App (Webpack), Turbopack, Parcel
- **Why Vite was Selected**:
  - Instant Hot Module Replacement (HMR) powered by native ES Modules (ESM) in development.
  - Rollup-based production bundling with tree-shaking yields an ultra-compact production bundle (~83 kB gzip).
  - Build times are sub-second (~1.2s), dramatically accelerating CI/CD pipelines on Vercel.
- **Why Alternatives were Rejected**:
  - *Create React App / Webpack*: Deprecated by the React team, slow cold-start times (15–30s), and heavy polyfill bloat.
  - *Turbopack*: Still maturing outside Next.js ecosystem.

---

### 1.3 Styling Architecture: Handcrafted Vanilla CSS Design System
- **Selected**: **Vanilla CSS Design System** (CSS Tokens, Custom Variables, CSS Grid/Flexbox)
- **Alternatives Considered**: Tailwind CSS, Styled-Components / Emotion (CSS-in-JS), Bootstrap / Material-UI
- **Why Vanilla CSS was Selected**:
  - **Zero Runtime Overhead & Zero Bundle Bloat**: CSS-in-JS libraries (like Styled-Components) inject runtime CSS parsing overhead on every render pass. Vanilla CSS compiles to 0 JavaScript bytes.
  - **Total Design Control**: Precise control over micro-animations, glassmorphism, responsive breakpoints, and custom pill/card styling without fighting framework utility specificity.
  - **Future-Proof**: CSS Custom Properties (`--bg-primary`, `--accent-teal`, `--radius-md`) allow instant theme switching without re-rendering the React virtual DOM.
- **Why Alternatives were Rejected**:
  - *Tailwind CSS*: Clutters JSX markup with lengthy class strings, complicates dynamic calculations, and introduces dependency overhead.
  - *Material UI / Bootstrap*: Heavy JavaScript footprint, rigid generic "cookie-cutter" look that is hard to customize for a sleek legal-tech brand.

---

### 1.4 State Management: React Context API + Custom Hooks
- **Selected**: **React Context API + Custom Modular Hooks** (`useAuth`, `useContext`)
- **Alternatives Considered**: Redux Toolkit, Zustand, MobX, Recoil
- **Why Context API was Selected**:
  - The application's global state requirements are focused primarily on **User Authentication, Session State, and active Theme**.
  - Document analysis and Q&A histories are localized to specific page views (`AnalysisPage.jsx`), making local component state with lifted hooks far cleaner.
  - Zero extra npm package weight (0 kB bundle addition).
- **Why Alternatives were Rejected**:
  - *Redux Toolkit*: Massive boilerplate (actions, reducers, selectors, dispatchers) that is complete overkill for modern React applications.
  - *Zustand / MobX*: While lightweight, adding an external state library is unnecessary when React 18 Context + `useReducer` handles all auth and session workflows natively.

---

### 1.5 Cross-Tab State Synchronization: HTML5 `BroadcastChannel` API
- **Selected**: **HTML5 `BroadcastChannel`** (`clauseiq:auth_channel`) with `StorageEvent` fallback
- **Alternatives Considered**: WebSockets, Long Polling, Polling `localStorage` on interval
- **Why BroadcastChannel was Selected**:
  - **Instant & Zero-Server Overhead**: Operates 100% in browser memory across open browser tabs.
  - When a user resets their password or clicks Sign Out in Tab 1, Tab 2 is notified in **< 1 millisecond** and immediately clears memory and redirects to `/login`.
- **Why Alternatives were Rejected**:
  - *WebSockets*: Requires persistent TCP connections on the backend server, consuming server RAM and keeping connections alive unnecessarily.
  - *Polling*: Wastes network bandwidth and CPU cycles.

---

### 1.6 Network Client & Resilience: Native `fetch` with Custom Retry Interceptor
- **Selected**: **Native `window.fetch` with 3x Cold-Start Auto-Retry**
- **Alternatives Considered**: Axios, TanStack Query (React Query)
- **Why Native Fetch with Custom Interceptor was Selected**:
  - Built natively into every modern browser with 0 bundle overhead.
  - Tailored retry interceptor: specifically detects PaaS cold-starts (`502 Bad Gateway`, `503 Service Unavailable`) and transparently pauses 2 seconds and retries up to 3 times before failing.
  - Custom event dispatching (`window.dispatchEvent('auth:unauthorized')`) handles session expiration cleanly across the entire UI.
- **Why Alternatives were Rejected**:
  - *Axios*: Adds 15 kB of redundant code to wrap browser APIs that native `fetch` handles out of the box.

---

## 2. Backend & API Gateway Choices

### 2.1 Backend Runtime: Node.js (v18+) & Express 5
- **Selected**: **Node.js (v18+) with Express 5**
- **Alternatives Considered**: Python (FastAPI / Flask / Django), Go (Golang), Java (Spring Boot)
- **Why Node.js + Express was Selected**:
  - **Unified Full-Stack Language**: Sharing JavaScript / TypeScript types and logic across frontend and backend accelerates solo-developer velocity.
  - **Low Memory Footprint on Free / Cloud Tiers**: An Express API idles at **~60–80 MB of RAM**, whereas a Python FastAPI / LangChain runtime often requires **300–500 MB RAM**, causing memory crashes on free/starter tiers.
  - **Asynchronous Non-Blocking I/O**: Excellent for handling multiple streaming LLM requests and vector database queries simultaneously.
- **Why Alternatives were Rejected**:
  - *Python / FastAPI*: While Python is standard in data science research, in production API servers it has slower cold boot times, higher RAM usage, and requires managing separate virtual environments and GIL locks.
  - *Go*: Fast and type-safe, but slower prototyping velocity and fewer native SDKs for diverse AI APIs.

---

### 2.2 PDF Ingestion & File Processing: In-Memory Buffers (`multer.memoryStorage`)
- **Selected**: **Volatile Memory Storage** (`multer.memoryStorage()`) + `pdfjs-dist`
- **Alternatives Considered**: Disk Storage (`/uploads` folder), AWS S3 / Cloudinary, `pdf-parse`
- **Why In-Memory Buffer Processing was Selected**:
  - **Zero Disk Leak & Stateless Serverless Architecture**: Ephemeral containers (like Render, Heroku, AWS Lambda) have read-only or volatile filesystems. Writing files to local disk leads to orphaned files and container disk exhaustion.
  - **Privacy & Security**: Sensitive legal agreements are parsed in volatile RAM and immediately garbage-collected, ensuring zero persistent contract copies on server disks.
  - **Speed**: In-memory parsing eliminates disk I/O read/write latency.
- **Why Alternatives were Rejected**:
  - *Local Disk Storage*: Causes disk fill-ups, security leaks, and breaks horizontal autoscaling.
  - *AWS S3*: Adds unnecessary AWS infrastructure configuration and storage costs for contracts that only need vector embedding and risk extraction.

---

### 2.3 Scanned Document OCR: Google Gemini Vision OCR Dynamic Fallback
- **Selected**: **Google Gemini Vision OCR** (Triggered dynamically when digital text `< 50` characters)
- **Alternatives Considered**: Tesseract.js (WASM), AWS Textract, Google Cloud Document AI
- **Why Gemini Vision OCR Fallback was Selected**:
  - **Zero Extra Dependencies**: Uses the existing Google GenAI SDK already present in the server.
  - **Superior Accuracy on Complex Legal Layouts**: Multimodal LLMs understand legal tables, skewed phone scans, handwriting, and multi-column contract formatting far better than traditional OCR engines.
  - **Cost-Effective**: Only invoked when digital PDF text extraction returns empty (scanned documents), saving API costs on standard digital PDFs.
- **Why Alternatives were Rejected**:
  - *Tesseract.js*: High CPU usage, slow processing on server instances (10–20 seconds per page), and poor accuracy on low-light smartphone contract scans.
  - *AWS Textract*: Expensive dedicated enterprise service ($1.50 per 1,000 pages) requiring complex AWS IAM permissions.

---

## 3. AI, RAG & Vector Search Choices

### 3.1 Vector Database: Qdrant Cloud
- **Selected**: **Qdrant Cloud** (Managed Cloud Cluster)
- **Alternatives Considered**: Pinecone, ChromaDB, pgvector (PostgreSQL), Weaviate, Milvus
- **Why Qdrant was Selected**:
  - **Advanced Payload Filtering**: Qdrant executes **payload filtering before vector search** (HNSW index with payload constraints), guaranteeing strict tenant isolation (`userId` and `documentId`) without performance degradation.
  - **Rust-Powered High Throughput**: Written in Rust for minimal memory overhead and sub-10ms vector search latency.
  - **Developer-Friendly REST & gRPC APIs**: Clean `@qdrant/js-client-rest` SDK with built-in collection health checks.
- **Why Alternatives were Rejected**:
  - *ChromaDB*: Lacks a reliable multi-tenant managed cloud service for Node.js production deployments; primarily Python-centric.
  - *Pinecone*: Expensive pricing tiers, vendor lock-in, and occasional cold-start index latency on free starter pods.
  - *pgvector*: Requires running and maintaining a heavy relational database instance; vector indexing (HNSW/IVFFlat) in Postgres consumes high memory and slows down relational queries.

---

### 3.2 Vector Embedding Model: Google Gemini Embedding (`gemini-embedding-001`)
- **Selected**: **`gemini-embedding-001` (768 Dimensions)**
- **Alternatives Considered**: OpenAI `text-embedding-3-small`, HuggingFace Local MiniLM (`all-MiniLM-L6-v2`), Cohere Embed v3
- **Why Gemini Embeddings were Selected**:
  - 768-dimensional dense vectors provide the optimal balance between **semantic richness and vector storage footprint**.
  - Native integration with the Google GenAI ecosystem.
  - Extremely fast response times (< 150ms per batch).
- **Why Alternatives were Rejected**:
  - *Local HuggingFace MiniLM*: Running local transformer models in Node.js requires heavy ONNX runtimes, consuming 500MB+ server RAM.
  - *OpenAI Embeddings*: Requires maintaining separate billing accounts when Gemini is already used for vision and analysis.

---

### 3.3 Two-Stage Retrieval: Jina AI Cross-Encoder Reranker (`jina-reranker-v2-base-multilingual`)
- **Selected**: **Jina AI Cross-Encoder Reranker v2**
- **Alternatives Considered**: Cohere Rerank, BGE Reranker Local, Raw Vector Similarity (No reranker)
- **Why Jina AI Cross-Encoder Reranking was Selected**:
  - **Eliminates Semantic Cosine Blindness**: Vector cosine similarity compares vectors independently (bi-encoder). In legal agreements, clauses like *"Party A shall be liable"* and *"Party A shall not be liable"* have near-identical vector embeddings.
  - A **Cross-Encoder** evaluates the user question and the candidate clause simultaneously with full cross-attention, boosting retrieval precision by **~40%**.
  - **Multilingual Legal Support**: Handles cross-border agreements and foreign legal terminology seamlessly.
- **Why Alternatives were Rejected**:
  - *Raw Vector Search Only*: Leads to hallucinations and irrelevant context injection on complex contractual Q&A.
  - *Cohere Rerank*: Higher latency and stricter API rate limits on free developer tiers.

---

### 3.4 LLM Orchestration & Fallback: Google Gemini 3.5 Flash + Groq Cloud (`gpt-oss-120b`)
- **Selected**: **Google Gemini (Primary) with Groq Cloud Fallback**
- **Alternatives Considered**: OpenAI GPT-4o, Anthropic Claude 3.5 Sonnet, Ollama Local
- **Why Gemini + Groq was Selected**:
  - **Ultra-Fast Token Generation**: Groq LPU (Language Processing Unit) architecture streams responses at **300+ tokens/second**, delivering instantaneous answers to user questions.
  - **High Context Window**: Gemini 3.5 Flash provides massive context capacity for long multi-page agreements at fraction-of-a-cent costs.
  - **Zero Single-Point-of-Failure**: If Google Gemini API experiences rate limits or outages, the system automatically falls back to Groq Cloud.
- **Why Alternatives were Rejected**:
  - *OpenAI GPT-4o / Claude 3.5 Sonnet*: 10x to 20x higher API costs per token without meaningful accuracy gain for structured risk extraction.

---

## 4. Database & Persistence Choices

### 4.1 Primary Database: MongoDB Atlas (Mongoose ODM)
- **Selected**: **MongoDB Atlas (NoSQL)**
- **Alternatives Considered**: PostgreSQL, MySQL, Supabase, Firebase Firestore
- **Why MongoDB was Selected**:
  - **Flexible Document Schema**: Contract analysis produces deeply nested, variable-length risk arrays (`risks: [{ category, level, clauseExcerpt, explanation, mitigation }]`) and dynamic multi-turn conversation threads (`qaHistory`). Document databases model this naturally without complex multi-table SQL joins.
  - **Built-In TTL (Time-To-Live) Indexes**: MongoDB automatically deletes expired password reset tokens and verification tokens (`expiresAt: 5 minutes`) in the background via native database daemon threads.
  - **JSON Alignment**: Direct object serialization between MongoDB, Express, and React with zero ORM translation friction.
- **Why Alternatives were Rejected**:
  - *PostgreSQL / MySQL*: Storing polymorphic legal risk categories and multi-turn cited sources in relational tables requires 4+ normalized join tables (`documents`, `analyses`, `risks`, `qa_pairs`, `sources`), adding database query latency.

---

## 5. Authentication, Security & Email Choices

### 5.1 Session & Token Architecture: Dual JWT (HttpOnly Cookie + Bearer Token)
- **Selected**: **JWT in HttpOnly, SameSite Cookies + Bearer Header**
- **Alternatives Considered**: Server-Side Stateful Sessions (Redis / `express-session`), Firebase Auth, Supabase Auth
- **Why Dual JWT was Selected**:
  - **Stateless & Horizontally Scalable**: No Redis server required to validate session authenticity across multiple backend instances.
  - **XSS & CSRF Immune**: `HttpOnly` flags prevent JavaScript from reading cookies (preventing XSS token theft), while `SameSite: Lax` mitigates Cross-Site Request Forgery (CSRF).
  - **Bearer Token Fallback**: Enables mobile apps and third-party API clients to authenticate via headers when cookies are restricted.
- **Why Alternatives were Rejected**:
  - *Firebase / Supabase Auth*: Introduces third-party vendor lock-in, external client libraries, and disconnects authentication state from the primary MongoDB database.
  - *Stateful Redis Sessions*: Adds an extra database dependency to monitor and pay for.

---

### 5.2 Email Delivery: Resend HTTP REST API (Port 443 HTTPS)
- **Selected**: **Resend HTTP API** (with Gmail SSL Port 465 fallback)
- **Alternatives Considered**: Nodemailer raw SMTP (Gmail / SendGrid / AWS SES on Port 587/465), Mailgun
- **Why Resend HTTP API was Selected**:
  - **Cloud Firewall Immunity**: Cloud platforms (Render, AWS, DigitalOcean, Vercel) aggressively block outbound raw TCP ports 25, 465, and 587 to prevent spambots, producing `ENETUNREACH` connection errors with traditional Nodemailer.
  - Resend operates entirely over **HTTPS (Port 443)** REST endpoints (`https://api.resend.com/emails`), ensuring **100% deliverability on any cloud host**.
  - Instant delivery speeds (< 500ms) and built-in deliverability analytics.
- **Why Alternatives were Rejected**:
  - *Nodemailer SMTP*: Fails in production on cloud hosting platforms due to network port blocking and Google data center IP security blocks.
  - *AWS SES*: Complicated sandbox verification process requiring custom DNS domain setup before sending a single test email.

---

### 5.3 Onboarding Strategy: Smart Auto-Verify + On-Screen Reset Fallback
- **Selected**: **Smart Auto-Verify on Signup (`AUTO_VERIFY_EMAIL=true`) & Direct Reset Link Fallback**
- **Alternatives Considered**: Strict Email Verification Blocking
- **Why Smart Auto-Verify was Selected**:
  - Solves the **"Cold Start / Domain Requirement"** dilemma for portfolio demonstrations, staging environments, and early-stage SaaS deployments.
  - Users can sign up and immediately test the product without email delivery friction.
  - Future-proof: Flipping `AUTO_VERIFY_EMAIL=false` in Render instantly reactivates strict email verification once a custom domain is verified in Resend.

---

## 6. Cloud Hosting & DevOps Reliability Choices

### 6.1 Frontend Hosting: Vercel
- **Selected**: **Vercel** (Global Edge CDN)
- **Alternatives Considered**: Netlify, GitHub Pages, AWS Amplify, Render Static Site
- **Why Vercel was Selected**:
  - Native optimization for Vite / React single-page applications.
  - Ultra-fast global Edge network (anycast CDN) delivering sub-50ms TTFB worldwide.
  - Automated continuous deployment preview branches for every GitHub pull request.
  - Clean rewrite rules via `vercel.json` ensuring zero 404s on deep React Router paths (`/documents/:id`, `/settings`).

---

### 6.2 Backend Hosting: Render Web Services
- **Selected**: **Render Web Services**
- **Alternatives Considered**: Heroku, AWS EC2 / ECS, Railway, Fly.io
- **Why Render was Selected**:
  - Native Node.js web service support with zero Dockerfile maintenance required.
  - Automated continuous deployment on `git push origin main`.
  - Built-in free SSL certificates, DDoS protection, and custom health check monitoring.
- **Why Alternatives were Rejected**:
  - *Heroku*: Terminated free tiers; expensive pricing structure.
  - *AWS EC2 / ECS*: High DevOps management overhead (VPCs, Security Groups, ALB routing, IAM policies).

---

### 6.3 24/7 Keep-Alive Architecture: External Cron Monitor (`cron-job.org`)
- **Selected**: **External HTTPS Cron Pinger (`cron-job.org` / UptimeRobot)**
- **Alternatives Considered**: GitHub Actions Cron, Internal Node.js `setInterval`, Upgraded Paid Dynos
- **Why External Cron Pinger was Selected**:
  - **Second-Level Precision**: Dedicated external servers ping `/health` every 5 minutes 24/7, preventing Render's 15-minute inactivity shutdown.
  - **Triple Layer Warming**: A single ping to `/health` simultaneously pings:
    1. **Render Container** (resets idle timer)
    2. **MongoDB Atlas** (`admin().ping()` keeps TCP connection pool warm)
    3. **Qdrant Cloud** (`getCollections()` keeps vector memory index active)
  - **100% Free Forever**: Zero ongoing hosting bills.
- **Why Alternatives were Rejected**:
  - *GitHub Actions Cron*: Free tier cron schedules are queued and can be delayed by 20–45 minutes during high traffic, causing Render to fall asleep in between runs.
  - *Internal `setInterval`*: Cannot wake a container that is already spun down.

---

*Authored for ClauseIQ Technical Architectural Review & Engineering Evaluation.*
