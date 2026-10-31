/**
 * ==============================================================================
 * ClauseIQ Benchmark Calculation Module (`benchmark-calculation.js`)
 * ==============================================================================
 * 
 * Provides pure, reusable calculation functions for:
 *  1. Document processing time (upload start -> ready report stored)
 *  2. Complete Q&A response time (question submit -> full SSE stream parsed)
 *  3. Confirmed rate-limit waiting time (Gemini 429 / RESOURCE_EXHAUSTED)
 *  4. Adjusted document processing time (actual elapsed - verified quota wait)
 *  5. Adjusted Q&A response time (actual elapsed - verified quota wait)
 *  6. Statistical aggregation (Average/Mean, Median, Minimum, Maximum)
 * 
 * Enforces strict independence: Document processing timing and Q&A response timing
 * are calculated independently and are never mixed.
 */

/**
 * Calculates document processing time from monotonic timestamps in milliseconds.
 * 
 * @param {number} startMonotonicMs - Monotonic timestamp when upload starts (e.g. performance.now())
 * @param {number} endMonotonicMs - Monotonic timestamp when document status becomes 'ready'
 * @returns {number} Time in seconds rounded to 2 decimal places
 */
function calculateProcessingTime(startMonotonicMs, endMonotonicMs) {
  if (typeof startMonotonicMs !== 'number' || typeof endMonotonicMs !== 'number') {
    throw new TypeError('Timestamps must be numeric milliseconds');
  }
  const deltaMs = Math.max(0, endMonotonicMs - startMonotonicMs);
  return Number((deltaMs / 1000).toFixed(2));
}

/**
 * Calculates complete Q&A response time from monotonic timestamps in milliseconds.
 * Must be called with independent timers created after the document is already ready.
 * 
 * @param {number} startMonotonicMs - Monotonic timestamp when question is submitted
 * @param {number} endMonotonicMs - Monotonic timestamp when the full stream completes
 * @returns {number} Time in seconds rounded to 2 decimal places
 */
function calculateQnaTime(startMonotonicMs, endMonotonicMs) {
  if (typeof startMonotonicMs !== 'number' || typeof endMonotonicMs !== 'number') {
    throw new TypeError('Timestamps must be numeric milliseconds');
  }
  const deltaMs = Math.max(0, endMonotonicMs - startMonotonicMs);
  return Number((deltaMs / 1000).toFixed(2));
}

/**
 * Detects whether an error represents a verified Gemini rate limit (429 / RESOURCE_EXHAUSTED).
 * Never classifies ordinary slow processing or unverified errors as rate limiting.
 * 
 * @param {Error|Object|string} error - Error object, API response, or error message
 * @returns {boolean} True if confirmed 429 or RESOURCE_EXHAUSTED
 */
function detectRateLimitError(error) {
  if (!error) return false;
  if (error.status === 429 || error.code === 429 || error.status === 'RESOURCE_EXHAUSTED') {
    return true;
  }
  const str = typeof error === 'string'
    ? error
    : (error.message || (typeof error.error === 'string' ? error.error : JSON.stringify(error)));
  return (
    str.includes('429') ||
    str.includes('RESOURCE_EXHAUSTED') ||
    str.includes('Quota exceeded') ||
    str.includes('rate_limit_exceeded')
  );
}

/**
 * Extracts confirmed quota waiting and retry delay in seconds from verified Gemini error.
 * Returns 0 if no rate-limit error is present.
 * 
 * @param {Error|Object|string} error - Error containing rate limit information
 * @param {number} [fallbackDelaySec=45] - Fallback wait if retryDelay is not explicitly stated in error
 * @returns {number} Verified quota wait time in seconds (0 if not rate limited)
 */
function calculateRateLimitWait(error, fallbackDelaySec = 45) {
  if (!detectRateLimitError(error)) return 0;
  const str = typeof error === 'string'
    ? error
    : (error.message || (typeof error.error === 'string' ? error.error : JSON.stringify(error)));

  // Look for: "retry in 52.98s", "retryDelay: \"52s\"", or "retry after 52 seconds"
  const matchRetryIn = str.match(/retry\s+in\s+([0-9.]+)\s*s/i);
  if (matchRetryIn) {
    return Number(parseFloat(matchRetryIn[1]).toFixed(2));
  }

  const matchRetryDelay = str.match(/retryDelay["']?\s*:\s*["']?(\d+)/i);
  if (matchRetryDelay) {
    return Number(parseFloat(matchRetryDelay[1]).toFixed(2));
  }

  const matchRetryAfter = str.match(/retry\s+after\s+([0-9.]+)/i);
  if (matchRetryAfter) {
    return Number(parseFloat(matchRetryAfter[1]).toFixed(2));
  }

  return Number(fallbackDelaySec.toFixed(2));
}

/**
 * Computes adjusted document processing time:
 *   documentAdjustedTimeSec = documentProcessingTimeSec - documentRateLimitWaitSec
 * 
 * @param {number} documentProcessingTimeSec - Total elapsed monotonic time in seconds
 * @param {number} documentRateLimitWaitSec - Confirmed rate limit wait time in seconds
 * @returns {number} Adjusted processing time in seconds
 */
function calculateAdjustedProcessingTime(documentProcessingTimeSec, documentRateLimitWaitSec = 0) {
  const actual = Number(documentProcessingTimeSec) || 0;
  const wait = Number(documentRateLimitWaitSec) || 0;
  return Number(Math.max(0, actual - wait).toFixed(2));
}

/**
 * Computes adjusted Q&A response time:
 *   qnaAdjustedTimeSec = qnaResponseTimeSec - qnaRateLimitWaitSec
 * 
 * @param {number} qnaResponseTimeSec - Total elapsed monotonic time in seconds
 * @param {number} qnaRateLimitWaitSec - Confirmed rate limit wait time in seconds
 * @returns {number} Adjusted Q&A time in seconds
 */
function calculateAdjustedQnaTime(qnaResponseTimeSec, qnaRateLimitWaitSec = 0) {
  const actual = Number(qnaResponseTimeSec) || 0;
  const wait = Number(qnaRateLimitWaitSec) || 0;
  return Number(Math.max(0, actual - wait).toFixed(2));
}

/**
 * Calculates statistical metrics (Average/Mean, Median, Minimum, Maximum) for a list of values.
 * 
 * @param {number[]} values - Array of numeric measurements
 * @returns {{ count: number, average: number, median: number, minimum: number, maximum: number }}
 */
function calculateMetricStats(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return {
      count: 0,
      average: 0,
      median: 0,
      minimum: 0,
      maximum: 0,
    };
  }

  const validNumbers = values
    .map(Number)
    .filter((v) => Number.isFinite(v));

  if (validNumbers.length === 0) {
    return { count: 0, average: 0, median: 0, minimum: 0, maximum: 0 };
  }

  validNumbers.sort((a, b) => a - b);
  const sum = validNumbers.reduce((acc, v) => acc + v, 0);
  const average = sum / validNumbers.length;
  
  const mid = Math.floor(validNumbers.length / 2);
  const median = validNumbers.length % 2 === 0
    ? (validNumbers[mid - 1] + validNumbers[mid]) / 2
    : validNumbers[mid];

  const minimum = validNumbers[0];
  const maximum = validNumbers[validNumbers.length - 1];

  return {
    count: validNumbers.length,
    average: Number(average.toFixed(2)),
    median: Number(median.toFixed(2)),
    minimum: Number(minimum.toFixed(2)),
    maximum: Number(maximum.toFixed(2)),
  };
}

/**
 * Formats a standardized document benchmark record matching the required JSON schema.
 * 
 * @param {Object} params
 * @param {string} params.fileName - Name of the PDF contract file
 * @param {number} params.fileSizeKb - File size in KB
 * @param {number} params.documentProcessingTimeSec - Total elapsed document processing time (s)
 * @param {number} [params.documentRateLimitWaitSec=0] - Confirmed quota wait time for document processing (s)
 * @param {number} params.qnaResponseTimeSec - Independent total elapsed Q&A response time (s)
 * @param {number} [params.qnaRateLimitWaitSec=0] - Confirmed quota wait time for Q&A (s)
 * @param {string} [params.status='ready'] - Completion status ('ready' or 'failed')
 * @returns {Object} Standardized benchmark record
 */
function formatBenchmarkRecord({
  fileName,
  fileSizeKb,
  documentProcessingTimeSec,
  documentRateLimitWaitSec = 0,
  qnaResponseTimeSec,
  qnaRateLimitWaitSec = 0,
  status = 'ready',
}) {
  const docActual = Number(Number(documentProcessingTimeSec).toFixed(2));
  const docWait = Number(Number(documentRateLimitWaitSec).toFixed(2));
  const docAdjusted = calculateAdjustedProcessingTime(docActual, docWait);

  const qnaActual = Number(Number(qnaResponseTimeSec).toFixed(2));
  const qnaWait = Number(Number(qnaRateLimitWaitSec).toFixed(2));
  const qnaAdjusted = calculateAdjustedQnaTime(qnaActual, qnaWait);

  return {
    fileName: String(fileName),
    fileSizeKb: Number(Number(fileSizeKb).toFixed(1)),
    documentProcessingTimeSec: docActual,
    documentRateLimitWaitSec: docWait,
    documentAdjustedTimeSec: docAdjusted,
    qnaResponseTimeSec: qnaActual,
    qnaRateLimitWaitSec: qnaWait,
    qnaAdjustedTimeSec: qnaAdjusted,
    status: String(status),
  };
}

/**
 * Aggregates summary statistics for a set of benchmark records.
 * 
 * @param {Object[]} records - Array of benchmark records
 * @returns {Object} Comprehensive statistical summary
 */
function calculateBenchmarkSummary(records) {
  if (!Array.isArray(records)) return null;

  const validRecords = records.filter((r) => r.status === 'ready' || r.status === 'success');
  const failureCount = records.length - validRecords.length;
  const failureRate = records.length > 0
    ? `${((failureCount / records.length) * 100).toFixed(1)}%`
    : '0.0%';

  return {
    totalDocuments: records.length,
    successfulDocuments: validRecords.length,
    failedDocuments: failureCount,
    failureRate,
    documentProcessingTimeSec: calculateMetricStats(validRecords.map((r) => r.documentProcessingTimeSec)),
    documentRateLimitWaitSec: calculateMetricStats(validRecords.map((r) => r.documentRateLimitWaitSec)),
    documentAdjustedTimeSec: calculateMetricStats(validRecords.map((r) => r.documentAdjustedTimeSec)),
    qnaResponseTimeSec: calculateMetricStats(validRecords.map((r) => r.qnaResponseTimeSec)),
    qnaRateLimitWaitSec: calculateMetricStats(validRecords.map((r) => r.qnaRateLimitWaitSec)),
    qnaAdjustedTimeSec: calculateMetricStats(validRecords.map((r) => r.qnaAdjustedTimeSec)),
  };
}

module.exports = {
  calculateProcessingTime,
  calculateQnaTime,
  detectRateLimitError,
  calculateRateLimitWait,
  calculateAdjustedProcessingTime,
  calculateAdjustedQnaTime,
  calculateMetricStats,
  formatBenchmarkRecord,
  calculateBenchmarkSummary,
};

