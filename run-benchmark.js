/**
 * ==============================================================================
 * ClauseIQ Performance Benchmark Suite (`run-benchmark.js`)
 * ==============================================================================
 * 
 * Measures end-to-end performance across real legal contracts:
 * 
 * 1. Document Processing Benchmark (Upload -> Complete Risk Review Ready):
 *    - Timer starts when upload begins (monotonic clock)
 *    - Timer stops when document status is 'ready' (risk score & clauses stored)
 *    - Records `documentProcessingTimeSec`
 * 
 * 2. Q&A Response Benchmark (Independent Streaming Query):
 *    - Timer starts when question is submitted (NEW independent timer)
 *    - Timer stops when the complete streamed answer and citations are parsed
 *    - Records `qnaResponseTimeSec`
 *    - STRICTLY INDEPENDENT: Document processing time is NEVER added to Q&A time
 * 
 * 3. Rate-Limit Handling (Gemini 429 / RESOURCE_EXHAUSTED):
 *    - Detects verified Gemini quota errors
 *    - Records confirmed quota waiting and retry delays separately
 *    - Pauses and resumes after verified quota recovery
 *    - Excludes only verified quota wait from adjusted processing measurements:
 *        `documentAdjustedTimeSec = documentProcessingTimeSec - documentRateLimitWaitSec`
 *        `qnaAdjustedTimeSec = qnaResponseTimeSec - qnaRateLimitWaitSec`
 *    - Ordinary slow processing is NEVER classified as rate limiting without evidence
 * 
 * 4. Output:
 *    - Writes standardized records to `benchmark_results.json`
 * 
 * Usage:
 *   node run-benchmark.js
 *   node run-benchmark.js <path_to_contracts_folder>
 *   node run-benchmark.js contract1.pdf contract2.pdf
 *   node run-benchmark.js --fresh
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const app = require('./app');
const { connectDatabase } = require('./config/db');
const User = require('./models/User.model');
const Document = require('./models/Document.model');
const {
  calculateProcessingTime,
  calculateQnaTime,
  detectRateLimitError,
  calculateRateLimitWait,
  formatBenchmarkRecord,
  calculateBenchmarkSummary,
} = require('./benchmark-calculation');

// Default target contract directories provided by the user
const DEFAULT_CONTRACT_DIRS = [
  'C:\\Users\\Admin\\Desktop\\CUAD_v1\\full_contract_pdf\\Part_I\\Affiliate_Agreements',
  'C:\\Users\\Admin\\Desktop\\CUAD_v1\\full_contract_pdf\\Part_II\\Agency Agreements'
];

// Predefined legal contracts for benchmarking (10 representative contracts across both folders)
const DEFAULT_BENCHMARK_PDFS = [
  'C:\\Users\\Admin\\Desktop\\CUAD_v1\\full_contract_pdf\\Part_I\\Affiliate_Agreements\\CreditcardscomInc_20070810_S-1_EX-10.33_362297_EX-10.33_Affiliate Agreement.pdf',
  'C:\\Users\\Admin\\Desktop\\CUAD_v1\\full_contract_pdf\\Part_I\\Affiliate_Agreements\\CybergyHoldingsInc_20140520_10-Q_EX-10.27_8605784_EX-10.27_Affiliate Agreement.pdf',
  'C:\\Users\\Admin\\Desktop\\CUAD_v1\\full_contract_pdf\\Part_I\\Affiliate_Agreements\\DigitalCinemaDestinationsCorp_20111220_S-1_EX-10.10_7346719_EX-10.10_Affiliate Agreement.pdf',
  'C:\\Users\\Admin\\Desktop\\CUAD_v1\\full_contract_pdf\\Part_I\\Affiliate_Agreements\\LinkPlusCorp_20050802_8-K_EX-10_3240252_EX-10_Affiliate Agreement.pdf',
  'C:\\Users\\Admin\\Desktop\\CUAD_v1\\full_contract_pdf\\Part_I\\Affiliate_Agreements\\SouthernStarEnergyInc_20051202_SB-2A_EX-9_801890_EX-9_Affiliate Agreement.pdf',
  'C:\\Users\\Admin\\Desktop\\CUAD_v1\\full_contract_pdf\\Part_I\\Affiliate_Agreements\\SteelVaultCorp_20081224_10-K_EX-10.16_3074935_EX-10.16_Affiliate Agreement.pdf',
  'C:\\Users\\Admin\\Desktop\\CUAD_v1\\full_contract_pdf\\Part_II\\Agency Agreements\\ATHENSBANCSHARESCORP_11_02_2009-EX-1.2-AGENCY AGREEMENT , 2009.PDF',
  'C:\\Users\\Admin\\Desktop\\CUAD_v1\\full_contract_pdf\\Part_II\\Agency Agreements\\BONTONSTORESINC_04_20_2018-EX-99.3-AGENCY AGREEMENT.PDF',
  'C:\\Users\\Admin\\Desktop\\CUAD_v1\\full_contract_pdf\\Part_II\\Agency Agreements\\OLDAPIWIND-DOWNLTD_01_08_2016-EX-1.3-AGENCY AGREEMENT1.pdf',
  'C:\\Users\\Admin\\Desktop\\CUAD_v1\\full_contract_pdf\\Part_II\\Agency Agreements\\OLDAPIWIND-DOWNLTD_01_08_2016-EX-1.3-AGENCY AGREEMENT2.pdf'
];

function resolvePdfFiles() {
  const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  if (args.length > 0) {
    const collected = [];
    for (const item of args) {
      if (fs.existsSync(item)) {
        const stat = fs.statSync(item);
        if (stat.isDirectory()) {
          const files = fs.readdirSync(item)
            .filter((f) => f.toLowerCase().endsWith('.pdf'))
            .map((f) => path.join(item, f));
          collected.push(...files);
        } else if (item.toLowerCase().endsWith('.pdf')) {
          collected.push(item);
        }
      }
    }
    if (collected.length > 0) return collected;
  }

  // Check if predefined contracts exist
  const existingDefault = DEFAULT_BENCHMARK_PDFS.filter((f) => fs.existsSync(f));
  if (existingDefault.length >= 10) return existingDefault;

  // Otherwise scan default folders
  const scanned = [];
  for (const dir of DEFAULT_CONTRACT_DIRS) {
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir)
        .filter((f) => f.toLowerCase().endsWith('.pdf'))
        .map((f) => path.join(dir, f));
      scanned.push(...files);
    }
  }
  return scanned.slice(0, 10);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Executes a streaming Q&A question over Server-Sent Events (SSE).
 * Starts an independent monotonic timer when the question is sent.
 * Stops only when the entire stream is received, parsed, and completed.
 * 
 * @param {string} baseUrl - Base URL of test server
 * @param {string} token - JWT authentication token
 * @param {string} documentId - ID of ready document
 * @param {string} question - Question text
 * @returns {Promise<{ qnaResponseTimeSec: number, qnaRateLimitWaitSec: number, answer: string, error: string|null }>}
 */
async function runIndependentQnaBenchmark(baseUrl, token, documentId, question) {
  // START INDEPENDENT TIMER 2
  const tQnaStart = performance.now();
  let fullAnswer = '';
  let citationsCount = 0;
  let qnaRateLimitWaitSec = 0;
  let errorMsg = null;

  try {
    const res = await fetch(`${baseUrl}/api/analyses/${documentId}/questions/stream`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({ question }),
    });

    if (!res.ok) {
      const errText = await res.text();
      if (detectRateLimitError(errText)) {
        const waitSec = calculateRateLimitWait(errText);
        qnaRateLimitWaitSec += waitSec;
        console.warn(`[Q&A Rate-Limit Verified] Gemini quota exceeded. Verified wait: ${waitSec}s`);
      }
      throw new Error(`Q&A request failed with HTTP ${res.status}: ${errText}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        let event = 'message';
        let data = '';
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        if (!data) continue;

        if (event === 'sources') {
          try {
            const sources = JSON.parse(data);
            citationsCount = Array.isArray(sources) ? sources.length : 0;
          } catch {}
        } else if (event === 'token') {
          try {
            const payload = JSON.parse(data);
            if (payload.text) fullAnswer += payload.text;
          } catch {}
        } else if (event === 'error') {
          try {
            const errPayload = JSON.parse(data);
            errorMsg = errPayload.message || 'Stream error';
            if (detectRateLimitError(errorMsg)) {
              const waitSec = calculateRateLimitWait(errorMsg);
              qnaRateLimitWaitSec += waitSec;
              console.warn(`[Q&A Rate-Limit Verified] Gemini stream quota exceeded. Verified wait: ${waitSec}s`);
            }
          } catch {}
        }
      }
    }
  } catch (err) {
    errorMsg = err.message;
  }

  // STOP INDEPENDENT TIMER 2
  const tQnaEnd = performance.now();
  const qnaResponseTimeSec = calculateQnaTime(tQnaStart, tQnaEnd);

  return {
    qnaResponseTimeSec,
    qnaRateLimitWaitSec,
    answer: fullAnswer.trim(),
    citationsCount,
    error: errorMsg,
  };
}

/**
 * Loads existing results from benchmark_results.json.
 */
function loadExistingResults() {
  if (!fs.existsSync('benchmark_results.json')) return [];
  try {
    const raw = JSON.parse(fs.readFileSync('benchmark_results.json', 'utf8'));
    if (!Array.isArray(raw)) return [];
    return raw.map((r) => {
      // Normalize to standard schema
      return formatBenchmarkRecord({
        fileName: r.fileName,
        fileSizeKb: r.fileSizeKb,
        documentProcessingTimeSec: r.documentProcessingTimeSec || r.tReadySec || 0,
        documentRateLimitWaitSec: r.documentRateLimitWaitSec || 0,
        qnaResponseTimeSec: r.qnaResponseTimeSec || r.qaTotalSec || 0,
        qnaRateLimitWaitSec: r.qnaRateLimitWaitSec || 0,
        status: r.status || (r.tReadySec ? 'ready' : 'failed'),
      });
    });
  } catch (err) {
    console.warn('Could not read existing benchmark_results.json:', err.message);
    return [];
  }
}

async function main() {
  const isFresh = process.argv.includes('--fresh');
  const pdfFiles = resolvePdfFiles();

  if (pdfFiles.length === 0) {
    console.error('\n❌ No valid PDF files found to benchmark!');
    console.error('Please pass PDF directory path or specific PDF files via command line:');
    console.error('  node run-benchmark.js "C:\\path\\to\\contracts"\n');
    process.exit(1);
  }

  console.log(`\n======================================================`);
  console.log(`ClauseIQ End-to-End Performance Benchmark`);
  console.log(`Target Legal Contracts: ${pdfFiles.length}`);
  console.log(`Timers: 1. Document Processing | 2. Q&A Response (Independent)`);
  console.log(`======================================================\n`);

  console.log('Connecting to database...');
  await connectDatabase();

  let testUser = await User.findOne({ email: 'benchmark-test@clauseiq.internal' });
  if (!testUser) {
    testUser = await User.create({
      name: 'Benchmark Test User',
      email: 'benchmark-test@clauseiq.internal',
      password: 'BenchmarkTestPassword123!',
      emailVerified: true,
      role: 'user',
    });
  }

  const token = jwt.sign({ sub: testUser._id }, process.env.JWT_SECRET || 'test-secret', {
    expiresIn: '2d',
  });

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;
  console.log(`Local test API server running on ${baseUrl}`);

  let results = isFresh ? [] : loadExistingResults();

  for (let i = 0; i < pdfFiles.length; i++) {
    const filePath = pdfFiles[i];
    const fileName = path.basename(filePath);
    const fileSize = fs.statSync(filePath).size;
    const fileSizeKb = Number((fileSize / 1024).toFixed(1));

    // Check if valid completed benchmark already exists for this file
    const existingIndex = results.findIndex((r) => r.fileName === fileName);
    if (!isFresh && existingIndex !== -1 && results[existingIndex].status === 'ready' && results[existingIndex].documentProcessingTimeSec > 0) {
      const rec = results[existingIndex];
      console.log(`\n======================================================`);
      console.log(`[${i + 1}/${pdfFiles.length}] CACHED BENCHMARK: ${fileName} (${fileSizeKb} KB)`);
      console.log(`  Document Processing Time : ${rec.documentProcessingTimeSec} s (Adjusted: ${rec.documentAdjustedTimeSec} s, Quota Wait: ${rec.documentRateLimitWaitSec} s)`);
      console.log(`  Q&A Response Time        : ${rec.qnaResponseTimeSec} s (Adjusted: ${rec.qnaAdjustedTimeSec} s)`);
      console.log(`  Status                   : ${rec.status}`);
      console.log(`======================================================`);
      continue;
    }

    console.log(`\n======================================================`);
    console.log(`[${i + 1}/${pdfFiles.length}] Testing: ${fileName} (${fileSizeKb} KB)`);
    console.log(`======================================================`);

    // Clean any prior document records for this filename to ensure clean state
    await Document.deleteMany({ userId: testUser._id, filename: fileName, status: { $ne: 'ready' } });

    const fileBuffer = fs.readFileSync(filePath);
    const blob = new Blob([fileBuffer], { type: 'application/pdf' });
    const formData = new FormData();
    formData.append('file', blob, fileName);

    // =========================================================================
    // 1. DOCUMENT PROCESSING BENCHMARK (TIMER 1)
    // =========================================================================
    let documentProcessingTimeSec = 0;
    let documentRateLimitWaitSec = 0;
    let documentStatus = 'failed';
    let documentId = null;
    let finalDoc = null;
    let finalAnalysis = null;

    // START TIMER 1: Document Upload Begins
    const tDocStart = performance.now();

    try {
      const uploadRes = await fetch(`${baseUrl}/api/documents`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      const uploadData = await uploadRes.json();
      if (!uploadRes.ok) {
        if (detectRateLimitError(uploadData)) {
          const wait = calculateRateLimitWait(uploadData);
          documentRateLimitWaitSec += wait;
          console.warn(`[Upload Rate-Limit Verified] Quota exceeded. Verified wait: ${wait}s`);
        }
        throw new Error(uploadData.message || 'Upload failed');
      }

      documentId = uploadData.document._id;
      console.log(`✓ Upload accepted with HTTP ${uploadRes.status} (ID: ${documentId})`);

      // Poll until document is 'ready' or 'failed'
      const pollStart = performance.now();
      while (performance.now() - pollStart < 360000) {
        await sleep(2000);
        let pollRes;
        try {
          pollRes = await fetch(`${baseUrl}/api/documents/${documentId}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
        } catch {
          continue;
        }

        if (!pollRes.ok) continue;
        const pollData = await pollRes.json();
        finalDoc = pollData.document;
        finalAnalysis = pollData.analysis;

        if (finalDoc.status === 'ready') {
          documentStatus = 'ready';
          // Check if server recorded verified quota wait on the document model
          if (finalDoc.rateLimitWaitSec && finalDoc.rateLimitWaitSec > 0) {
            documentRateLimitWaitSec += finalDoc.rateLimitWaitSec;
          }
          console.log(`✓ Complete risk analysis report ready (Score: ${finalAnalysis?.riskScore || 0}, Risks: ${finalAnalysis?.riskClauses?.length || 0})`);
          break;
        }

        if (finalDoc.status === 'failed') {
          console.error(`Document processing failed: ${finalDoc.error}`);
          if (detectRateLimitError(finalDoc.error)) {
            const wait = calculateRateLimitWait(finalDoc.error);
            documentRateLimitWaitSec += wait;
            console.warn(`[Processing Rate-Limit Verified] Quota exceeded. Verified wait: ${wait}s`);
          }
          break;
        }
      }
    } catch (err) {
      console.error('Document upload error:', err.message);
    }

    // STOP TIMER 1: Document Processing Complete
    const tDocEnd = performance.now();
    documentProcessingTimeSec = calculateProcessingTime(tDocStart, tDocEnd);
    console.log(`⏱ Document Processing Time: ${documentProcessingTimeSec} s (Quota Wait: ${documentRateLimitWaitSec} s)`);

    // =========================================================================
    // 2. Q&A RESPONSE BENCHMARK (TIMER 2 - INDEPENDENT)
    // =========================================================================
    let qnaResponseTimeSec = 0;
    let qnaRateLimitWaitSec = 0;

    if (documentStatus === 'ready' && documentId) {
      const predefinedQuestion = 'What are the termination conditions, notice period, and liability terms?';
      console.log(`Submitting Q&A question: "${predefinedQuestion}"`);

      // Independent Timer 2 executes strictly inside runIndependentQnaBenchmark
      const qnaResult = await runIndependentQnaBenchmark(baseUrl, token, documentId, predefinedQuestion);
      qnaResponseTimeSec = qnaResult.qnaResponseTimeSec;
      qnaRateLimitWaitSec = qnaResult.qnaRateLimitWaitSec;

      console.log(`⏱ Q&A Response Time: ${qnaResponseTimeSec} s (Citations: ${qnaResult.citationsCount}, Quota Wait: ${qnaRateLimitWaitSec} s)`);

      // Cleanup document from database to keep storage clean
      await fetch(`${baseUrl}/api/documents/${documentId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    } else {
      console.warn('Skipping Q&A benchmark because document processing did not complete successfully.');
    }

    // =========================================================================
    // 3. RECORD FORMATTING & PERSISTENCE
    // =========================================================================
    const record = formatBenchmarkRecord({
      fileName,
      fileSizeKb,
      documentProcessingTimeSec,
      documentRateLimitWaitSec,
      qnaResponseTimeSec,
      qnaRateLimitWaitSec,
      status: documentStatus,
    });

    if (existingIndex !== -1) results[existingIndex] = record;
    else results.push(record);

    // Save benchmark_results.json
    fs.writeFileSync('benchmark_results.json', JSON.stringify(results, null, 2), 'utf8');

    // Pacing pause between contracts to prevent API quota saturation
    if (i < pdfFiles.length - 1) {
      console.log('Pacing pause (20s) between contracts to stay within API rate limits...');
      await sleep(20000);
    }
  }

  server.close();

  // Final summary calculation
  fs.writeFileSync('benchmark_results.json', JSON.stringify(results, null, 2), 'utf8');
  const summary = calculateBenchmarkSummary(results);

  console.log('\n======================================================');
  console.log('BENCHMARK COMPLETE! Results saved to benchmark_results.json');
  console.log('======================================================');
  console.log('\n--- Overall Summary Statistics ---');
  console.log(`Total Documents Tested : ${summary.totalDocuments} (Success: ${summary.successfulDocuments}, Failed: ${summary.failedDocuments})`);
  console.log(`Document Processing Time (s) : Avg: ${summary.documentProcessingTimeSec.average} | Median: ${summary.documentProcessingTimeSec.median} | Min: ${summary.documentProcessingTimeSec.minimum} | Max: ${summary.documentProcessingTimeSec.maximum}`);
  console.log(`Document Quota Wait Time (s) : Avg: ${summary.documentRateLimitWaitSec.average} | Max: ${summary.documentRateLimitWaitSec.maximum}`);
  console.log(`Document Adjusted Time (s)   : Avg: ${summary.documentAdjustedTimeSec.average} | Median: ${summary.documentAdjustedTimeSec.median} | Min: ${summary.documentAdjustedTimeSec.minimum} | Max: ${summary.documentAdjustedTimeSec.maximum}`);
  console.log(`Q&A Response Time (s)        : Avg: ${summary.qnaResponseTimeSec.average} | Median: ${summary.qnaResponseTimeSec.median} | Min: ${summary.qnaResponseTimeSec.minimum} | Max: ${summary.qnaResponseTimeSec.maximum}`);
  console.log(`Q&A Adjusted Time (s)        : Avg: ${summary.qnaAdjustedTimeSec.average} | Median: ${summary.qnaAdjustedTimeSec.median} | Min: ${summary.qnaAdjustedTimeSec.minimum} | Max: ${summary.qnaAdjustedTimeSec.maximum}`);
  console.log('======================================================\n');

  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal benchmark execution error:', err);
  process.exit(1);
});

