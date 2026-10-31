const {
  calculateProcessingTime,
  calculateQnaTime,
  detectRateLimitError,
  calculateRateLimitWait,
  calculateAdjustedProcessingTime,
  calculateAdjustedQnaTime,
  calculateMetricStats,
  formatBenchmarkRecord,
  calculateBenchmarkSummary,
} = require('../benchmark-calculation');

describe('Benchmark Calculation Module (benchmark-calculation.js)', () => {
  describe('Independent Timers', () => {
    it('calculates document processing time accurately from monotonic timestamps in seconds', () => {
      const tUploadStart = 10000;
      const tReadyReport = 24500;
      const docSec = calculateProcessingTime(tUploadStart, tReadyReport);
      expect(docSec).toBe(14.5);
    });

    it('calculates complete Q&A response time accurately and independently', () => {
      const tQuestionSubmit = 30000;
      const tStreamParsed = 33850;
      const qnaSec = calculateQnaTime(tQuestionSubmit, tStreamParsed);
      expect(qnaSec).toBe(3.85);
    });

    it('enforces that document processing and Q&A timing remain completely independent', () => {
      const docStart = 1000;
      const docEnd = 9000; // 8.00s
      const qnaStart = 9500;
      const qnaEnd = 12500; // 3.00s

      const docTime = calculateProcessingTime(docStart, docEnd);
      const qnaTime = calculateQnaTime(qnaStart, qnaEnd);

      expect(docTime).toBe(8.00);
      expect(qnaTime).toBe(3.00);
      // Ensure Q&A time NEVER includes document processing time
      expect(qnaTime).not.toBe(docTime + qnaTime);
      expect(qnaTime).toBeLessThan(docTime);
    });

    it('throws TypeError if non-numeric timestamps are provided', () => {
      expect(() => calculateProcessingTime('invalid', 1000)).toThrow(TypeError);
      expect(() => calculateQnaTime(1000, null)).toThrow(TypeError);
    });
  });

  describe('Rate-Limit Error Detection & Parsing', () => {
    it('detects Gemini 429 and RESOURCE_EXHAUSTED errors accurately', () => {
      const errorJson = JSON.stringify({
        error: {
          code: 429,
          message: 'Quota exceeded for metric: generativelanguage.googleapis.com/embed_content_free_tier_tokens',
          status: 'RESOURCE_EXHAUSTED',
        },
      });

      expect(detectRateLimitError(errorJson)).toBe(true);
      expect(detectRateLimitError({ status: 429 })).toBe(true);
      expect(detectRateLimitError({ status: 'RESOURCE_EXHAUSTED' })).toBe(true);
      expect(detectRateLimitError('Rate limit exceeded: 429')).toBe(true);
    });

    it('returns false for ordinary errors without rate limit evidence', () => {
      expect(detectRateLimitError(null)).toBe(false);
      expect(detectRateLimitError(new Error('SyntaxError in JSON'))).toBe(false);
      expect(detectRateLimitError({ status: 500, message: 'Internal Server Error' })).toBe(false);
      expect(detectRateLimitError('Slow network connection')).toBe(false);
    });

    it('extracts confirmed quota waiting seconds from retry in pattern', () => {
      const errorMsg = 'Quota exceeded for metric ... Please retry in 52.989349933s.';
      const waitSec = calculateRateLimitWait(errorMsg);
      expect(waitSec).toBe(52.99);
    });

    it('extracts confirmed quota waiting seconds from retryDelay field', () => {
      const errorObj = {
        message: '{"details":[{"@type":"...RetryInfo","retryDelay":"55s"}]}',
        status: 429,
      };
      const waitSec = calculateRateLimitWait(errorObj);
      expect(waitSec).toBe(55);
    });

    it('returns 0 wait seconds for normal errors without rate limiting', () => {
      expect(calculateRateLimitWait('Standard validation failure')).toBe(0);
      expect(calculateRateLimitWait(new Error('Document format invalid'))).toBe(0);
    });
  });

  describe('Adjusted Time Calculations', () => {
    it('calculates adjusted document processing time by excluding confirmed quota wait', () => {
      const actualElapsed = 65.50;
      const rateLimitWait = 52.00;
      const adjusted = calculateAdjustedProcessingTime(actualElapsed, rateLimitWait);
      expect(adjusted).toBe(13.50);
    });

    it('returns actual elapsed time unchanged when there is 0 quota wait', () => {
      const actualElapsed = 8.75;
      const adjusted = calculateAdjustedProcessingTime(actualElapsed, 0);
      expect(adjusted).toBe(8.75);
    });

    it('calculates adjusted Q&A response time by excluding verified quota wait', () => {
      const qnaActual = 25.00;
      const qnaWait = 20.00;
      const adjusted = calculateAdjustedQnaTime(qnaActual, qnaWait);
      expect(adjusted).toBe(5.00);
    });

    it('never produces negative adjusted times', () => {
      expect(calculateAdjustedProcessingTime(10, 15)).toBe(0);
      expect(calculateAdjustedQnaTime(5, 10)).toBe(0);
    });
  });

  describe('Statistical Summaries (calculateMetricStats)', () => {
    it('handles empty arrays with 0 for all metrics', () => {
      const stats = calculateMetricStats([]);
      expect(stats).toEqual({
        count: 0,
        average: 0,
        median: 0,
        minimum: 0,
        maximum: 0,
      });
    });

    it('calculates average, median (odd count), min, max accurately', () => {
      const values = [5, 10, 15, 20, 25]; // sum=75, avg=15, median=15
      const stats = calculateMetricStats(values);
      expect(stats.count).toBe(5);
      expect(stats.average).toBe(15.00);
      expect(stats.median).toBe(15.00);
      expect(stats.minimum).toBe(5.00);
      expect(stats.maximum).toBe(25.00);
    });

    it('calculates median for even count correctly', () => {
      const values = [10, 20, 30, 40]; // median = (20 + 30)/2 = 25
      const stats = calculateMetricStats(values);
      expect(stats.count).toBe(4);
      expect(stats.average).toBe(25.00);
      expect(stats.median).toBe(25.00);
    });
  });

  describe('Record Formatting & Benchmark Summary', () => {
    it('formats a document record matching all required JSON fields', () => {
      const record = formatBenchmarkRecord({
        fileName: 'Agreement_1.pdf',
        fileSizeKb: 130.84,
        documentProcessingTimeSec: 65.50,
        documentRateLimitWaitSec: 52.00,
        qnaResponseTimeSec: 3.50,
        qnaRateLimitWaitSec: 0,
        status: 'ready',
      });

      expect(record).toEqual({
        fileName: 'Agreement_1.pdf',
        fileSizeKb: 130.8,
        documentProcessingTimeSec: 65.50,
        documentRateLimitWaitSec: 52.00,
        documentAdjustedTimeSec: 13.50,
        qnaResponseTimeSec: 3.50,
        qnaRateLimitWaitSec: 0.00,
        qnaAdjustedTimeSec: 3.50,
        status: 'ready',
      });
    });

    it('aggregates multiple records into a complete benchmark summary with failure rate', () => {
      const records = [
        formatBenchmarkRecord({
          fileName: 'Doc1.pdf',
          fileSizeKb: 100,
          documentProcessingTimeSec: 10.0,
          documentRateLimitWaitSec: 0,
          qnaResponseTimeSec: 2.5,
          status: 'ready',
        }),
        formatBenchmarkRecord({
          fileName: 'Doc2.pdf',
          fileSizeKb: 200,
          documentProcessingTimeSec: 60.0,
          documentRateLimitWaitSec: 45.0,
          qnaResponseTimeSec: 3.5,
          status: 'ready',
        }),
      ];

      const summary = calculateBenchmarkSummary(records);
      expect(summary.totalDocuments).toBe(2);
      expect(summary.successfulDocuments).toBe(2);
      expect(summary.failedDocuments).toBe(0);
      expect(summary.failureRate).toBe('0.0%');
      expect(summary.documentProcessingTimeSec.average).toBe(35.00);
      expect(summary.documentAdjustedTimeSec.average).toBe(12.50);
      expect(summary.qnaResponseTimeSec.average).toBe(3.00);
    });
  });
});

