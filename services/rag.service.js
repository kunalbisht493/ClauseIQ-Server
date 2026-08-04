const { extractPdfText, chunkText } = require("./pdf.service");
const { embedTexts } = require("./embedding.service");
const { upsertChunks, search } = require("./vector.service");
const { generateJson } = require("./llm.service");

async function indexDocument(document) {
  const text = await extractPdfText(document.fileUrl);

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

async function answerQuestion(document, question) {
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

  const { content } = await generateJson({
    systemInstruction: `
You are an expert legal document assistant.

Answer ONLY using the supplied document context.

Never invent information.

If the answer cannot be found:

{
  "answer": "",
  "riskFlags": [],
  "insufficientContext": true
}

Otherwise return ONLY valid JSON.

Do NOT use markdown.
Do NOT wrap JSON inside \`\`\`.
Do NOT include explanations.

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

${context}

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