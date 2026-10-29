// Tiny in-memory LRU+TTL cache for Q&A results.
// A contract never changes after upload, so an identical question against the same
// document (with the same known-risk context) can safely reuse its answer.
const MAX_ENTRIES = Number(process.env.QA_CACHE_MAX || 500);
const TTL_MS = Number(process.env.QA_CACHE_TTL_MS || 60 * 60 * 1000);

const store = new Map();

function normalize(question) {
  return String(question || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function cacheKey(documentId, question, riskCount = 0) {
  return `${documentId}|${riskCount}|${normalize(question)}`;
}

function getCached(key) {
  if (MAX_ENTRIES <= 0) return null;
  const hit = store.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    store.delete(key);
    return null;
  }
  // refresh recency
  store.delete(key);
  store.set(key, hit);
  return hit.value;
}

function setCached(key, value) {
  if (MAX_ENTRIES <= 0) return;
  store.delete(key);
  store.set(key, { value, at: Date.now() });
  while (store.size > MAX_ENTRIES) {
    store.delete(store.keys().next().value);
  }
}

function clearCache() {
  store.clear();
}

module.exports = { cacheKey, getCached, setCached, clearCache };
