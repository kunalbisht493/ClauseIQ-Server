const { getGemini } = require("../config/gemini");
const { getGroq } = require("../config/groq");

const RETRYABLE_STATUSES = new Set([429, 500, 503]);
const MAX_GEMINI_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callGemini({ systemInstruction, prompt }) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_GEMINI_ATTEMPTS; attempt++) {
    try {
      const response = await getGemini().models.generateContent({
        model: process.env.GEMINI_MODEL || "gemini-3.5-flash",
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

      if (!content || !content.trim()) {
        throw new Error("Gemini returned an empty response");
      }

      return content;
    } catch (error) {
      lastError = error;
      const isRetryable = RETRYABLE_STATUSES.has(error?.status);

      console.error(`Gemini attempt ${attempt}/${MAX_GEMINI_ATTEMPTS} failed:`, error);

      if (!isRetryable || attempt === MAX_GEMINI_ATTEMPTS) {
        throw lastError;
      }

      await sleep(RETRY_DELAY_MS * attempt);
    }
  }

  throw lastError;
}

async function generateJson({ systemInstruction, prompt }) {
  try {
    const content = await callGemini({ systemInstruction, prompt });
    return { content, provider: "gemini" };
  } catch (geminiError) {
    console.error("Gemini failed after retries, falling back to Groq:", geminiError);

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
      throw new Error(
        "Groq fallback returned an empty response after Gemini failed."
      );
    }

    return {
      content,
      provider: "groq",
    };
  }
}

module.exports = {
  generateJson,
};