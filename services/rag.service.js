const { extractPdfText, chunkText } = require("./pdf.service");
const { embedTexts } = require("./embedding.service");
const { upsertChunks, search } = require("./vector.service");
const { generateJson, streamText } = require("./llm.service");
const { cacheKey, getCached, setCached } = require("./answerCache");
const { FlagSplitter, FLAGS_MARKER } = require("./streamSplitter");

async function indexText(document, text) {
  const chunks = chunkText(text);

  if (!chunks.length) {
    throw new Error("No readable text found in the PDF");
  }

  const embeddings = await embedTexts(chunks, "RETRIEVAL_DOCUMENT");

  await upsertChunks(
    document.vectorNS,
    document._id,
    chunks,
    embeddings
  );

  return chunks.length;
}

async function indexDocument(document) {
  const text = await extractPdfText(document.fileUrl, document.mimeType || 'application/pdf');
  return indexText(document, text);
}

function parseJsonResponse(content) {
  if (!content || typeof content !== "string") {
    throw new Error("The AI returned an empty response.");
  }

  const cleaned = content
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    console.error("========== JSON PARSE ERROR ==========");
    console.error(cleaned);
    console.error("======================================");
    throw new Error("The AI returned an invalid structured response.");
  }
}

// Fewer, better chunks => shorter prompt => faster answer. 10 was the old default.
const DEFAULT_TOP_K = 6;
// Cap how many prior risk flags are appended to every prompt (highest score first).
const DEFAULT_MAX_KNOWN_RISKS = 8;

const QA_TIMEOUT_MS = Number(process.env.LLM_QA_TIMEOUT_MS || 25_000);

function qaGeneration() {
  return {
    thinkingBudget: process.env.QA_THINKING_BUDGET,
    maxOutputTokens: process.env.QA_MAX_OUTPUT_TOKENS,
  };
}

async function retrieveSources(document, question) {
  const vector = (await embedTexts([question], "RETRIEVAL_QUERY"))[0];

  const matches = await search(
    document.vectorNS,
    document._id,
    vector,
    Number(process.env.RAG_TOP_K || DEFAULT_TOP_K)
  );

  if (!matches.length) {
    throw new Error("No relevant document context was found.");
  }

  const sources = matches
    .map((match) => {
      const metadata = match.payload || match.metadata || {};
      return {
        chunkIndex: metadata.chunkIndex,
        score: match.score,
        text: metadata.text,
      };
    })
    .filter(
      (source) =>
        typeof source.text === "string" && source.text.trim().length > 0
    );

  if (!sources.length) {
    throw new Error("No readable document context was found.");
  }

  return sources;
}

function selectKnownRisks(knownRisks = []) {
  const max = Number(process.env.RAG_MAX_KNOWN_RISKS || DEFAULT_MAX_KNOWN_RISKS);
  if (!Array.isArray(knownRisks) || knownRisks.length <= max) return knownRisks || [];
  return [...knownRisks]
    .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0))
    .slice(0, max);
}

function buildPrompt(sources, knownRisks, question) {
  const context = sources
    .map((source) => `[Chunk ${source.chunkIndex}]\n${source.text}`)
    .join("\n\n");

  const risks = selectKnownRisks(knownRisks);
  const knownRisksBlock = risks.length
    ? `\n\nKnown risk flags already identified in this document by a prior full-document review (always consider these, even if not directly retrieved above; mention any that are relevant to the question, especially if they conflict with the retrieved excerpts):\n\n${risks
        .map(
          (risk, i) =>
            `${i + 1}. [${risk.level || "unknown"}] ${risk.clause || ""} — ${risk.reason || ""}`
        )
        .join("\n")}`
    : "";

  return `
Document Context:

${context}${knownRisksBlock}

Question:

${question}
`;
}

const GROUNDING_RULES = `
You are an expert legal document assistant helping a non-lawyer understand a contract.

Ground every factual claim ONLY in the supplied document context and the
known risk flags list (if provided). Never invent facts, numbers, dates, or
terms that are not present in either.

However, grounding in the context does not mean quoting it back. Your job is
to explain, interpret, and translate legal language into plain terms:

- If asked to "explain," "simplify," or clarify a clause, do not just restate
  the clause text. Say what it actually means in practice, what could happen
  as a result, and why it matters — using only facts drawn from the context.
- Convert technical or compounding terms into concrete outcomes wherever the
  context supports it (e.g. a monthly rate can be expressed as its annualized
  equivalent if the context provides the monthly figure; a notice period can
  be explained in terms of how it limits the reader's options).
- If the document contains more than one figure or clause on the same topic
  (e.g. two different interest rates, two different notice periods) across
  the retrieved excerpts or the known risk flags list, you MUST surface all
  of them and flag the discrepancy explicitly. Do not silently answer with
  only one figure when the context shows more than one.
- Where the context supports comparison (e.g. this term vs. a more standard
  numbered clause elsewhere in the document), point that out.
- Keep the tone clear and direct, as if explaining to someone with no legal
  background, in 2-4 sentences unless the question calls for more detail.
`;

const JSON_FORMAT = `
If the answer cannot be found:

{
  "answer": "",
  "riskFlags": [],
  "insufficientContext": true
}

Otherwise return ONLY valid JSON.

Do NOT use markdown.
Do NOT wrap JSON inside \`\`\`.
Do NOT include explanations outside the JSON structure itself.

Required format:

{
  "answer": "",
  "riskFlags": [
    {
      "level": "low|medium|high",
      "clause": "Exact clause number and heading as written in the contract (e.g., '10. Non-Compete')",
      "reason": "",
      "chunkIndex": 0
    }
  ],
  "insufficientContext": false
}
`;

// Streaming layout: prose first (so it can be shown immediately), then a marker, then JSON.
const STREAM_FORMAT = `
Respond in EXACTLY this layout and nothing else:

1. The plain-text answer for the reader. No markdown, no JSON, no bullet syntax.
2. A new line containing only the marker ${FLAGS_MARKER}
3. Then ONLY a JSON object (no code fences) in this shape:

{"riskFlags":[{"level":"low|medium|high","clause":"Exact clause number and heading as written in the contract (e.g., '10. Non-Compete')","reason":"","chunkIndex":0}],"insufficientContext":false}

If the answer cannot be found in the context, write nothing before the marker and
set "insufficientContext" to true.
`;

const FALLBACK_ANSWER = "The document context did not provide an answer.";

async function answerQuestion(document, question, knownRisks = []) {
  const key = cacheKey(document._id, question, knownRisks.length);
  const cached = getCached(key);
  if (cached) return { ...cached, cached: true };

  const sources = await retrieveSources(document, question);

  const { content } = await generateJson({
    systemInstruction: GROUNDING_RULES + JSON_FORMAT,
    prompt: buildPrompt(sources, knownRisks, question),
    preferredProvider: process.env.QA_LLM_PROVIDER || "gemini",
    timeoutMs: QA_TIMEOUT_MS,
    generation: qaGeneration(),
  });

  const response = parseJsonResponse(content);

  const result = {
    answer: response.answer || FALLBACK_ANSWER,
    riskFlags: Array.isArray(response.riskFlags) ? response.riskFlags : [],
    insufficientContext: Boolean(response.insufficientContext),
    sources,
  };

  setCached(key, result);
  return result;
}

// Async generator used by the SSE endpoint. Yields:
//   { type: "sources", sources }   right after retrieval (citations can render immediately)
//   { type: "token", text }        pieces of the plain-text answer
//   { type: "done", result }       final { answer, riskFlags, insufficientContext, sources }
async function* streamAnswer(document, question, knownRisks = [], { signal } = {}) {
  const key = cacheKey(document._id, question, knownRisks.length);
  const cached = getCached(key);
  if (cached) {
    yield { type: "sources", sources: cached.sources };
    yield { type: "token", text: cached.answer };
    yield { type: "done", result: { ...cached, cached: true } };
    return;
  }

  const sources = await retrieveSources(document, question);
  yield { type: "sources", sources };

  const splitter = new FlagSplitter();
  const stream = streamText({
    systemInstruction: GROUNDING_RULES + STREAM_FORMAT,
    prompt: buildPrompt(sources, knownRisks, question),
    preferredProvider: process.env.QA_LLM_PROVIDER || "gemini",
    signal,
    timeoutMs: QA_TIMEOUT_MS,
    generation: qaGeneration(),
  });

  for await (const piece of stream) {
    const visible = splitter.push(piece);
    if (visible) yield { type: "token", text: visible };
  }

  const { remaining, answer, riskFlags, insufficientContext } = splitter.finish();
  if (remaining) yield { type: "token", text: remaining };

  if (!answer && !insufficientContext) {
    throw new Error("The AI returned an empty response.");
  }

  const result = {
    answer: answer || FALLBACK_ANSWER,
    riskFlags,
    insufficientContext,
    sources,
  };
  setCached(key, result);
  yield { type: "done", result };
}

module.exports = {
  indexDocument,
  indexText,
  answerQuestion,
  streamAnswer,
};