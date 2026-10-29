/**
 * ClauseIQ Performance Benchmark Suite
 * 
 * Measures end-to-end performance across real legal contracts:
 *  1. T_upload: HTTP 202 Accepted upload acknowledgment latency
 *  2. T_indexed: Document chunking & vector indexing latency (Q&A unlock point)
 *  3. T_ready: Full AI legal risk analysis completion latency
 *  4. TTFT: Time-To-First-Token for streaming Q&A (Server-Sent Events)
 *  5. T_qa_total: Full streaming Q&A answer generation latency
 *  6. T_qa_cached: In-memory LRU cache hit latency for repeat questions
 * 
 * Usage:
 *   node run-benchmark.js
 *   node run-benchmark.js /path/to/contracts/folder
 *   node run-benchmark.js contract1.pdf contract2.pdf
 *   node run-benchmark.js --fresh   (re-runs all files ignoring cached results)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const app = require('./app');
const { connectDatabase } = require('./config/db');
const User = require('./models/User.model');
const Document = require('./models/Document.model');

// ==============================================================================
// 1. SPECIFY YOUR PDF FILES HERE
// ==============================================================================
// Replace these paths with paths to your local PDF agreements, or pass paths via CLI:
// Example: node run-benchmark.js ./contracts/
const defaultPdfFiles = [
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
  const targets = args.length > 0
    ? args
    : (process.env.BENCHMARK_PDFS
        ? process.env.BENCHMARK_PDFS.split(',')
        : (process.env.BENCHMARK_PDF_DIR ? [process.env.BENCHMARK_PDF_DIR] : defaultPdfFiles));

  const collected = [];
  for (const item of targets) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (fs.existsSync(trimmed)) {
      const stat = fs.statSync(trimmed);
      if (stat.isDirectory()) {
        const files = fs.readdirSync(trimmed)
          .filter((f) => f.toLowerCase().endsWith('.pdf'))
          .map((f) => path.join(trimmed, f));
        collected.push(...files);
      } else if (trimmed.toLowerCase().endsWith('.pdf')) {
        collected.push(trimmed);
      }
    }
  }
  return collected;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runStreamingQa(baseUrl, token, documentId, question) {
  const tStart = performance.now();
  let tFirstToken = null;
  let fullAnswer = '';

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
    throw new Error(`Streaming request failed: ${res.status}`);
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

      if (event === 'token') {
        if (tFirstToken === null) {
          tFirstToken = performance.now() - tStart;
        }
        try {
          const payload = JSON.parse(data);
          fullAnswer += payload.text || '';
        } catch {}
      }
    }
  }

  const tTotal = performance.now() - tStart;
  return {
    tFirstToken: tFirstToken || tTotal,
    tTotal,
    fullAnswer: fullAnswer.trim(),
  };
}

async function runCachedQa(baseUrl, token, documentId, question) {
  const tStart = performance.now();
  const res = await fetch(`${baseUrl}/api/analyses/${documentId}/questions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ question }),
  });
  const tTotal = performance.now() - tStart;
  let data = {};
  try {
    data = await res.json();
  } catch {}
  return { tTotal, cached: Boolean(data.cached) };
}

async function main() {
  const isFresh = process.argv.includes('--fresh');
  const pdfFiles = resolvePdfFiles();

  if (pdfFiles.length === 0) {
    console.error('\n❌ No valid PDF files found to benchmark!');
    console.error('Please pass PDF paths via command line or configure defaultPdfFiles in run-benchmark.js:');
    console.error('  node run-benchmark.js /path/to/contract.pdf');
    console.error('  node run-benchmark.js /path/to/contracts_folder\n');
    process.exit(1);
  }

  console.log(`\nStarting ClauseIQ Benchmark with ${pdfFiles.length} document(s)...`);
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
  console.log(`Ephemeral API server active on ${baseUrl}`);

  // Load existing benchmark results if available (unless --fresh is passed)
  let results = [];
  if (!isFresh && fs.existsSync('benchmark_results.json')) {
    try {
      const prev = JSON.parse(fs.readFileSync('benchmark_results.json', 'utf8'));
      if (Array.isArray(prev)) {
        results = prev;
      }
    } catch {}
  }

  for (let i = 0; i < pdfFiles.length; i++) {
    const filePath = pdfFiles[i];
    const fileName = path.basename(filePath);
    const fileSize = fs.statSync(filePath).size;

    // Check if we already have a valid completed benchmark for this file
    const existingIndex = results.findIndex((r) => r.fileName === fileName);
    if (!isFresh && existingIndex !== -1 && results[existingIndex].tReadySec && !results[existingIndex].status) {
      console.log(`\n======================================================`);
      console.log(`[${i + 1}/${pdfFiles.length}] SKIPPING (Already completed): ${fileName}`);
      console.log(`  Upload: ${results[existingIndex].tUploadMs.toFixed(0)} ms | Ready: ${results[existingIndex].tReadySec.toFixed(2)} s | TTFT: ${results[existingIndex].ttftSec.toFixed(2)} s`);
      console.log(`======================================================`);
      continue;
    }

    console.log(`\n======================================================`);
    console.log(`[${i + 1}/${pdfFiles.length}] Testing: ${fileName} (${(fileSize / 1024).toFixed(1)} KB)`);
    console.log(`======================================================`);

    // Clean any prior pending/failed test document for this filename
    await Document.deleteMany({ userId: testUser._id, filename: fileName, status: { $ne: 'ready' } });

    const fileBuffer = fs.readFileSync(filePath);
    const blob = new Blob([fileBuffer], { type: 'application/pdf' });
    const formData = new FormData();
    formData.append('file', blob, fileName);

    // 1. Measure Upload Acknowledgment (T_upload)
    let uploadRes;
    let tUpload = 0;
    for (let attempt = 0; attempt < 5; attempt++) {
      const tUploadStart = performance.now();
      try {
        uploadRes = await fetch(`${baseUrl}/api/documents`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });
        tUpload = performance.now() - tUploadStart;
        if (uploadRes.status === 429) {
          console.warn('Express rate limited on upload (429), pausing 10s...');
          await sleep(10000);
          continue;
        }
        break;
      } catch (err) {
        console.warn('Network error on upload, waiting 3s...', err.message);
        await sleep(3000);
      }
    }

    let uploadData;
    try {
      uploadData = await uploadRes.json();
    } catch {
      uploadData = { message: 'Invalid JSON response from server' };
    }

    if (!uploadRes.ok) {
      console.error(`Upload failed:`, uploadData);
      const failedEntry = { fileName, fileSize, status: 'upload_failed', error: uploadData.message };
      if (existingIndex !== -1) results[existingIndex] = failedEntry;
      else results.push(failedEntry);
      continue;
    }

    const documentId = uploadData.document._id;
    console.log(`✓ Upload accepted in ${tUpload.toFixed(0)} ms (Status: ${uploadRes.status}, Doc ID: ${documentId})`);

    // 2. Poll for 'indexed' and 'ready'
    let tIndexed = null;
    let tReady = null;
    let finalDoc = null;
    let finalAnalysis = null;
    const pollStart = performance.now();

    while (performance.now() - pollStart < 360000) {
      await sleep(2000);
      let pollRes;
      try {
        pollRes = await fetch(`${baseUrl}/api/documents/${documentId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch (err) {
        console.warn('Network error while polling:', err.message);
        continue;
      }

      if (!pollRes.ok) {
        if (pollRes.status === 429) {
          console.warn('Rate limited on poll (429), pausing 4s...');
          await sleep(4000);
        }
        continue;
      }

      let pollData;
      try {
        pollData = await pollRes.json();
      } catch {
        continue;
      }

      finalDoc = pollData.document;
      finalAnalysis = pollData.analysis;

      if (!tIndexed && (finalDoc.status === 'indexed' || finalDoc.status === 'ready')) {
        tIndexed = performance.now() - pollStart;
        console.log(`✓ Reached 'indexed' (Q&A unlocked) in ${(tIndexed / 1000).toFixed(2)} s (Chunks: ${finalDoc.chunkCount})`);
      }

      if (finalDoc.status === 'ready') {
        tReady = performance.now() - pollStart;
        console.log(`✓ Reached 'ready' (Full risk review stored) in ${(tReady / 1000).toFixed(2)} s (Risks: ${finalAnalysis?.riskClauses?.length || 0}, Score: ${finalAnalysis?.riskScore || 0})`);
        break;
      }

      if (finalDoc.status === 'failed') {
        console.error(`Processing failed: ${finalDoc.error}`);
        break;
      }
    }

    if (finalDoc?.status !== 'ready' && !tReady) {
      const failedEntry = { fileName, fileSize, status: finalDoc?.status || 'timed_out', tUpload, tIndexed };
      if (existingIndex !== -1) results[existingIndex] = failedEntry;
      else results.push(failedEntry);
      continue;
    }

    // 3. Test Q&A with Streaming (TTFT + Full Answer)
    const testQuestion = 'What are the termination conditions, notice period, and liability terms?';
    console.log(`Testing streaming Q&A: "${testQuestion}"`);
    let qaStreamResult;
    try {
      qaStreamResult = await runStreamingQa(baseUrl, token, documentId, testQuestion);
      console.log(`✓ Q&A First Token (TTFT): ${(qaStreamResult.tFirstToken / 1000).toFixed(2)} s | Full Stream: ${(qaStreamResult.tTotal / 1000).toFixed(2)} s`);
    } catch (err) {
      console.error(`Streaming Q&A error:`, err.message);
      qaStreamResult = { tFirstToken: 0, tTotal: 0, fullAnswer: '' };
    }

    // 4. Test Repeat Cached Q&A
    console.log(`Testing repeat cached Q&A...`);
    let cachedQaResult;
    try {
      cachedQaResult = await runCachedQa(baseUrl, token, documentId, testQuestion);
      console.log(`✓ Cached Q&A Round-Trip: ${cachedQaResult.tTotal.toFixed(1)} ms (Cached hit: ${cachedQaResult.cached})`);
    } catch (err) {
      console.error(`Cached Q&A error:`, err.message);
      cachedQaResult = { tTotal: 0, cached: false };
    }

    // 5. Cleanup document from DB to keep database clean
    await fetch(`${baseUrl}/api/documents/${documentId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    const successEntry = {
      fileName,
      fileSizeKb: (fileSize / 1024).toFixed(1),
      chunks: finalDoc.chunkCount,
      riskCount: finalAnalysis?.riskClauses?.length || 0,
      riskScore: finalAnalysis?.riskScore || 0,
      tUploadMs: tUpload,
      tIndexedSec: tIndexed ? tIndexed / 1000 : null,
      tReadySec: tReady ? tReady / 1000 : null,
      ttftSec: qaStreamResult.tFirstToken / 1000,
      qaTotalSec: qaStreamResult.tTotal / 1000,
      cachedMs: cachedQaResult.tTotal,
    };

    if (existingIndex !== -1) results[existingIndex] = successEntry;
    else results.push(successEntry);

    // Persist progress to JSON
    fs.writeFileSync('benchmark_results.json', JSON.stringify(results, null, 2), 'utf8');

    // Pacing delay between contracts to respect Free Tier API quota
    if (i < pdfFiles.length - 1) {
      console.log('Pacing pause (25s) to stay within free-tier rate limits...');
      await sleep(25000);
    }
  }

  server.close();

  // Save final benchmark data
  fs.writeFileSync('benchmark_results.json', JSON.stringify(results, null, 2), 'utf8');
  console.log('\n======================================================');
  console.log(`BENCHMARK COMPLETE! Saved ${results.length} result(s) to benchmark_results.json`);
  console.log('======================================================\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('Benchmark fatal error:', err);
  process.exit(1);
});
