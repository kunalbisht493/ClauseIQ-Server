const { getGemini } = require("../config/gemini");
const { getGroq } = require("../config/groq");

const RETRYABLE_STATUSES = new Set([429, 500, 503]);
const MAX_GEMINI_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const CANDIDATE_GEMINI_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-flash-lite-latest",
  "gemini-3.5-flash",
];

async function callGemini({ systemInstruction, prompt }) {
  const preferred = process.env.GEMINI_MODEL;
  const models = preferred && preferred !== "gemini-3.5-flash"
    ? [preferred, ...CANDIDATE_GEMINI_MODELS.filter((m) => m !== preferred)]
    : CANDIDATE_GEMINI_MODELS;

  let lastError;

  for (const model of models) {
    try {
      const response = await getGemini().models.generateContent({
        model,
        contents: prompt,
        config: {
          systemInstruction,
          responseMimeType: "application/json",
        },
      });

      const content =
        typeof response.text === "function"
          ? await response.text()
          : response.text;

      if (content && content.trim()) {
        return content;
      }
    } catch (error) {
      lastError = error;
      console.warn(`Gemini model ${model} unavailable (${error?.status || error.message}), falling back to next candidate...`);
      if (error?.status !== 429 && error?.status !== 503 && error?.status !== 404) {
        throw error;
      }
    }
  }

  throw lastError;
}

async function callGroq({ systemInstruction, prompt }) {
  const completion = await getGroq().chat.completions.create({
    model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: systemInstruction,
      },
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  const content = completion.choices[0]?.message?.content;

  if (!content) {
    throw new Error("Groq returned an empty response.");
  }

  return content;
}

async function generateJson({ systemInstruction, prompt, preferredProvider }) {
  const primaryProvider = preferredProvider || process.env.LLM_PRIMARY_PROVIDER || "gemini";

  if (primaryProvider === "groq" && process.env.GROQ_API_KEY) {
    try {
      const content = await callGroq({ systemInstruction, prompt });
      return { content, provider: "groq" };
    } catch (groqError) {
      console.warn("Groq failed or rate-limited, falling back to Gemini:", groqError?.message || groqError);
      try {
        const content = await callGemini({ systemInstruction, prompt });
        return { content, provider: "gemini" };
      } catch (geminiError) {
        throw new Error(`Both LLM providers failed: Groq (${groqError.message}), Gemini (${geminiError.message})`);
      }
    }
  }

  try {
    const content = await callGemini({ systemInstruction, prompt });
    return { content, provider: "gemini" };
  } catch (geminiError) {
    console.warn("Gemini failed, falling back to Groq:", geminiError?.message || geminiError);
    if (!process.env.GROQ_API_KEY) throw geminiError;
    const content = await callGroq({ systemInstruction, prompt });
    return { content, provider: "groq" };
  }
}

module.exports = {
  generateJson,
};