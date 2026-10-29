const { getGemini } = require("../config/gemini");
const { getGroq } = require("../config/groq");

// Statuses that mean "this model/provider is unavailable right now, try the next one".
// 408 is our own timeout error (see withTimeout).
const ROTATE_STATUSES = new Set([404, 408, 429, 503]);

const CANDIDATE_GEMINI_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-flash-lite-latest",
  "gemini-3.5-flash",
];

const DEFAULT_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 30_000);

function geminiModels() {
  const preferred = process.env.GEMINI_MODEL;
  return preferred && preferred !== "gemini-3.5-flash"
    ? [preferred, ...CANDIDATE_GEMINI_MODELS.filter((m) => m !== preferred)]
    : CANDIDATE_GEMINI_MODELS;
}

function timeoutError(ms) {
  const error = new Error(`LLM request timed out after ${ms}ms`);
  error.status = 408;
  return error;
}

// Rejects with a 408 if `promise` hasn't settled in `ms`, and calls `onTimeout`
// so the underlying HTTP request can be aborted instead of left running.
function withTimeout(promise, ms, onTimeout) {
  if (!ms || ms <= 0) return promise;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try { onTimeout?.(); } catch { /* ignore */ }
      reject(timeoutError(ms));
    }, ms);
  });
  promise.catch(() => {}); // avoid an unhandled rejection if the timeout wins the race
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Optional per-call tuning. Everything is opt-in so default behaviour is unchanged.
//  - thinkingBudget: caps "thinking" tokens on models that support it (0 disables).
//  - maxOutputTokens: hard cap on output. NOTE: on some models thinking tokens count
//    against this, so set it generously (or set a thinking budget as well).
function geminiGenerationConfig({ thinkingBudget, maxOutputTokens } = {}) {
  const config = {};
  if (thinkingBudget !== undefined && thinkingBudget !== "" && Number.isFinite(Number(thinkingBudget))) {
    config.thinkingConfig = { thinkingBudget: Number(thinkingBudget) };
  }
  const max = Number(maxOutputTokens);
  if (Number.isInteger(max) && max > 0) config.maxOutputTokens = max;
  return config;
}

async function callGemini({ systemInstruction, prompt, timeoutMs = DEFAULT_TIMEOUT_MS, generation }) {
  let lastError;

  for (const model of geminiModels()) {
    const controller = new AbortController();
    try {
      const response = await withTimeout(
        getGemini().models.generateContent({
          model,
          contents: prompt,
          config: {
            systemInstruction,
            responseMimeType: "application/json",
            abortSignal: controller.signal,
            ...geminiGenerationConfig(generation),
          },
        }),
        timeoutMs,
        () => controller.abort()
      );

      const content =
        typeof response.text === "function" ? await response.text() : response.text;

      if (content && content.trim()) {
        return content;
      }
    } catch (error) {
      lastError = error;
      console.warn(`Gemini model ${model} unavailable (${error?.status || error.message}), falling back to next candidate...`);
      if (!ROTATE_STATUSES.has(error?.status)) {
        throw error;
      }
    }
  }

  throw lastError;
}

async function callGroq({ systemInstruction, prompt, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const completion = await getGroq().chat.completions.create(
    {
      model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemInstruction },
        { role: "user", content: prompt },
      ],
    },
    { timeout: timeoutMs }
  );

  const content = completion.choices[0]?.message?.content;

  if (!content) {
    throw new Error("Groq returned an empty response.");
  }

  return content;
}

async function generateJson({ systemInstruction, prompt, preferredProvider, timeoutMs, generation }) {
  const primaryProvider = preferredProvider || process.env.LLM_PRIMARY_PROVIDER || "gemini";
  const args = { systemInstruction, prompt, timeoutMs, generation };

  if (primaryProvider === "groq" && process.env.GROQ_API_KEY) {
    try {
      const content = await callGroq(args);
      return { content, provider: "groq" };
    } catch (groqError) {
      console.warn("Groq failed or rate-limited, falling back to Gemini:", groqError?.message || groqError);
      try {
        const content = await callGemini(args);
        return { content, provider: "gemini" };
      } catch (geminiError) {
        throw new Error(`Both LLM providers failed: Groq (${groqError.message}), Gemini (${geminiError.message})`);
      }
    }
  }

  try {
    const content = await callGemini(args);
    return { content, provider: "gemini" };
  } catch (geminiError) {
    console.warn("Gemini failed, falling back to Groq:", geminiError?.message || geminiError);
    if (!process.env.GROQ_API_KEY) throw geminiError;
    const content = await callGroq(args);
    return { content, provider: "groq" };
  }
}

// ---------------------------------------------------------------------------
// Streaming (plain text). Yields string pieces as they arrive.
// Provider/model fallback only happens BEFORE the first piece is yielded; once the
// user has seen text we surface the error instead of silently restarting.
// ---------------------------------------------------------------------------

async function* streamGemini({ systemInstruction, prompt, signal, timeoutMs = DEFAULT_TIMEOUT_MS, generation }) {
  let lastError;

  for (const model of geminiModels()) {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    let yielded = false;

    try {
      // The timeout covers connecting AND receiving the first chunk (time-to-first-token).
      const started = (async () => {
        const stream = await getGemini().models.generateContentStream({
          model,
          contents: prompt,
          config: { systemInstruction, abortSignal: controller.signal, ...geminiGenerationConfig(generation) },
        });
        const iterator = stream[Symbol.asyncIterator]();
        return { iterator, first: await iterator.next() };
      })();

      const { iterator, first } = await withTimeout(started, timeoutMs, () => controller.abort());

      let step = first;
      while (!step.done) {
        const text = step.value?.text;
        if (text) {
          yielded = true;
          yield text;
        }
        step = await iterator.next();
      }
      return;
    } catch (error) {
      lastError = error;
      if (yielded || signal?.aborted || !ROTATE_STATUSES.has(error?.status)) throw error;
      console.warn(`Gemini stream on ${model} unavailable (${error?.status || error.message}), trying next candidate...`);
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }

  throw lastError;
}

async function* streamGroq({ systemInstruction, prompt, signal, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const stream = await getGroq().chat.completions.create(
    {
      model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
      stream: true,
      messages: [
        { role: "system", content: systemInstruction },
        { role: "user", content: prompt },
      ],
    },
    { signal, timeout: timeoutMs }
  );

  for await (const chunk of stream) {
    const text = chunk.choices?.[0]?.delta?.content;
    if (text) yield text;
  }
}

async function* streamText({ systemInstruction, prompt, preferredProvider, signal, timeoutMs, generation }) {
  const primary = preferredProvider || process.env.LLM_PRIMARY_PROVIDER || "gemini";
  const hasGroq = Boolean(process.env.GROQ_API_KEY);
  const order = primary === "groq" && hasGroq ? ["groq", "gemini"] : hasGroq ? ["gemini", "groq"] : ["gemini"];

  let lastError;
  for (const provider of order) {
    let yielded = false;
    try {
      const args = { systemInstruction, prompt, signal, timeoutMs, generation };
      const iterable = provider === "groq" ? streamGroq(args) : streamGemini(args);
      for await (const piece of iterable) {
        yielded = true;
        yield piece;
      }
      return;
    } catch (error) {
      lastError = error;
      if (yielded || signal?.aborted) throw error;
      console.warn(`${provider} stream failed before first token, falling back:`, error?.message || error);
    }
  }

  throw lastError;
}

module.exports = {
  generateJson,
  streamText,
  // exported for tests
  withTimeout,
};
