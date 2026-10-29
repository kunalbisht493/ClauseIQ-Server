jest.mock('../config/gemini', () => ({ getGemini: jest.fn() }));
jest.mock('../config/groq', () => ({ getGroq: jest.fn() }));

const { getGemini } = require('../config/gemini');
const { getGroq } = require('../config/groq');
const { generateJson, streamText, withTimeout } = require('../services/llm.service');

async function collect(iterable) {
  const out = [];
  for await (const piece of iterable) out.push(piece);
  return out;
}

// builds an object that behaves like the SDK's async-iterable stream
function fakeStream(parts, failAfter) {
  return {
    async *[Symbol.asyncIterator]() {
      let i = 0;
      for (const text of parts) {
        if (failAfter !== undefined && i === failAfter) throw Object.assign(new Error('mid-stream failure'), { status: 503 });
        yield { text };
        i++;
      }
      if (failAfter !== undefined && i === failAfter) throw Object.assign(new Error('mid-stream failure'), { status: 503 });
    },
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  delete process.env.GROQ_API_KEY;
  delete process.env.GEMINI_MODEL;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => console.warn.mockRestore?.());

describe('withTimeout', () => {
  it('rejects with a 408 and fires onTimeout when the promise is too slow', async () => {
    const onTimeout = jest.fn();
    const never = new Promise(() => {});
    await expect(withTimeout(never, 20, onTimeout)).rejects.toMatchObject({ status: 408 });
    expect(onTimeout).toHaveBeenCalled();
  });

  it('passes the value through when fast enough', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000)).resolves.toBe('ok');
  });
});

describe('generateJson', () => {
  it('rotates to the next Gemini model when one times out', async () => {
    const generateContent = jest
      .fn()
      .mockImplementationOnce(() => new Promise(() => {})) // hangs -> timeout -> 408
      .mockResolvedValueOnce({ text: '{"ok":true}' });
    getGemini.mockReturnValue({ models: { generateContent } });

    const result = await generateJson({ systemInstruction: 's', prompt: 'p', timeoutMs: 30 });

    expect(result).toEqual({ content: '{"ok":true}', provider: 'gemini' });
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(generateContent.mock.calls[0][0].model).not.toBe(generateContent.mock.calls[1][0].model);
  });

  it('only sets thinking/max-token options when asked to', async () => {
    const generateContent = jest.fn().mockResolvedValue({ text: '{}' });
    getGemini.mockReturnValue({ models: { generateContent } });

    await generateJson({ systemInstruction: 's', prompt: 'p' });
    expect(generateContent.mock.calls[0][0].config.thinkingConfig).toBeUndefined();
    expect(generateContent.mock.calls[0][0].config.maxOutputTokens).toBeUndefined();

    await generateJson({ systemInstruction: 's', prompt: 'p', generation: { thinkingBudget: '0', maxOutputTokens: '2048' } });
    expect(generateContent.mock.calls[1][0].config.thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(generateContent.mock.calls[1][0].config.maxOutputTokens).toBe(2048);
  });

  it('does not rotate on a non-retryable error', async () => {
    const generateContent = jest.fn().mockRejectedValue(Object.assign(new Error('bad request'), { status: 400 }));
    getGemini.mockReturnValue({ models: { generateContent } });
    await expect(generateJson({ systemInstruction: 's', prompt: 'p' })).rejects.toThrow('bad request');
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
});

describe('streamText', () => {
  it('yields pieces from Gemini in order', async () => {
    const generateContentStream = jest.fn().mockResolvedValue(fakeStream(['Hel', 'lo']));
    getGemini.mockReturnValue({ models: { generateContentStream } });
    expect(await collect(streamText({ systemInstruction: 's', prompt: 'p' }))).toEqual(['Hel', 'lo']);
  });

  it('rotates models if the first one is rate-limited before any token', async () => {
    const generateContentStream = jest
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('rate limited'), { status: 429 }))
      .mockResolvedValueOnce(fakeStream(['fine']));
    getGemini.mockReturnValue({ models: { generateContentStream } });
    expect(await collect(streamText({ systemInstruction: 's', prompt: 'p' }))).toEqual(['fine']);
    expect(generateContentStream).toHaveBeenCalledTimes(2);
  });

  it('falls back to Groq when Gemini fails before the first token', async () => {
    process.env.GROQ_API_KEY = 'x';
    const generateContentStream = jest.fn().mockRejectedValue(Object.assign(new Error('down'), { status: 503 }));
    getGemini.mockReturnValue({ models: { generateContentStream } });
    const groqStream = (async function* () {
      yield { choices: [{ delta: { content: 'from ' } }] };
      yield { choices: [{ delta: { content: 'groq' } }] };
    })();
    getGroq.mockReturnValue({ chat: { completions: { create: jest.fn().mockResolvedValue(groqStream) } } });

    expect(await collect(streamText({ systemInstruction: 's', prompt: 'p' }))).toEqual(['from ', 'groq']);
  });

  it('does NOT restart on another provider once text has been shown', async () => {
    process.env.GROQ_API_KEY = 'x';
    const generateContentStream = jest.fn().mockResolvedValue(fakeStream(['partial ', 'answer'], 1));
    getGemini.mockReturnValue({ models: { generateContentStream } });
    const create = jest.fn();
    getGroq.mockReturnValue({ chat: { completions: { create } } });

    const seen = [];
    await expect(
      (async () => { for await (const p of streamText({ systemInstruction: 's', prompt: 'p' })) seen.push(p); })()
    ).rejects.toThrow('mid-stream failure');
    expect(seen).toEqual(['partial ']);
    expect(create).not.toHaveBeenCalled();
  });

  it('can prefer Groq when configured', async () => {
    process.env.GROQ_API_KEY = 'x';
    const groqStream = (async function* () { yield { choices: [{ delta: { content: 'fast' } }] }; })();
    const create = jest.fn().mockResolvedValue(groqStream);
    getGroq.mockReturnValue({ chat: { completions: { create } } });
    getGemini.mockImplementation(() => { throw new Error('should not be used'); });

    expect(await collect(streamText({ systemInstruction: 's', prompt: 'p', preferredProvider: 'groq' }))).toEqual(['fast']);
    expect(create.mock.calls[0][0].stream).toBe(true);
  });
});
