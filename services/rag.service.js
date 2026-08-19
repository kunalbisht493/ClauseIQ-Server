const { extractPdfText, chunkText } = require("./pdf.service");
const { embedTexts } = require("./embedding.service");
const { upsertChunks, search } = require("./vector.service");
const { generateJson } = require("./llm.service");

async function indexDocument(document) {
  const text = await extractPdfText(document.fileUrl, document.mimeType || 'application/pdf');

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

async function answerQuestion(document, question, knownRisks = []) {
  const vector = (
    await embedTexts([question], "RETRIEVAL_QUERY")
  )[0];

  const matches = await search(
    document.vectorNS,
    document._id,
    vector,
    Number(process.env.RAG_TOP_K || 10)
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
        typeof source.text === "string" &&
        source.text.trim().length > 0
    );

  if (!sources.length) {
    throw new Error("No readable document context was found.");
  }

  const context = sources
    .map(
      (source) =>
        `[Chunk ${source.chunkIndex}]\n${source.text}`
    )
    .join("\n\n");

  const knownRisksBlock = knownRisks.length
    ? `\n\nKnown risk flags already identified in this document by a prior full-document review (always consider these, even if not directly retrieved above; mention any that are relevant to the question, especially if they conflict with the retrieved excerpts):\n\n${knownRisks
        .map(
          (risk, i) =>
            `${i + 1}. [${risk.level || "unknown"}] ${risk.clause || ""} — ${risk.reason || ""}`
        )
        .join("\n")}`
    : "";

  const { content } = await generateJson({
    systemInstruction: `
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
      "clause": "",
      "reason": "",
      "chunkIndex": 0
    }
  ],
  "insufficientContext": false
}
`,

    prompt: `
Document Context:

${context}${knownRisksBlock}

Question:

${question}
`,
  });

  const response = parseJsonResponse(content);

  return {
    answer:
      response.answer ||
      "The document context did not provide an answer.",

    riskFlags: Array.isArray(response.riskFlags)
      ? response.riskFlags
      : [],

    insufficientContext: Boolean(
      response.insufficientContext
    ),

    sources,
  };
}

module.exports = {
  indexDocument,
  answerQuestion,
};