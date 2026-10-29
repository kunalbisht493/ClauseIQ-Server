jest.mock('../services/embedding.service', () => ({ embedTexts: jest.fn() }));
jest.mock('../services/vector.service', () => ({ search: jest.fn(), upsertChunks: jest.fn() }));
jest.mock('../services/llm.service', () => ({ generateJson: jest.fn(), streamText: jest.fn() }));

const { embedTexts } = require('../services/embedding.service');
const { search } = require('../services/vector.service');
const { generateJson, streamText } = require('../services/llm.service');
const { clearCache } = require('../services/answerCache');
const { answerQuestion, streamAnswer } = require('../services/rag.service');

const doc = { _id: 'document-id', vectorNS: 'document-id' };

beforeEach(() => {
  jest.clearAllMocks();
  clearCache();
  embedTexts.mockResolvedValue([[0.1, 0.2]]);
  search.mockResolvedValue([{ score: 0.91, payload: { chunkIndex: 3, text: 'The term is twelve months.' } }]);
});

async function collect(iterable) {
  const events = [];
  for await (const event of iterable) events.push(event);
  return events;
}

async function* pieces(...parts) {
  for (const part of parts) yield part;
}

describe('answerQuestion', () => {
  it('uses the Qdrant payload as retrieved context', async () => {
    generateJson.mockResolvedValue({ content: JSON.stringify({ answer: 'The term is twelve months.', riskFlags: [], insufficientContext: false }) });

    const result = await answerQuestion(doc, 'What is the term?');

    expect(embedTexts).toHaveBeenCalledWith(['What is the term?'], 'RETRIEVAL_QUERY');
    expect(result.sources).toEqual([{ chunkIndex: 3, score: 0.91, text: 'The term is twelve months.' }]);
    expect(result.answer).toBe('The term is twelve months.');
  });

  it('retrieves fewer chunks by default and honours RAG_TOP_K', async () => {
    generateJson.mockResolvedValue({ content: JSON.stringify({ answer: 'a', riskFlags: [] }) });
    await answerQuestion(doc, 'q1');
    expect(search).toHaveBeenLastCalledWith('document-id', 'document-id', [0.1, 0.2], 6);

    process.env.RAG_TOP_K = '4';
    await answerQuestion(doc, 'q2');
    expect(search).toHaveBeenLastCalledWith('document-id', 'document-id', [0.1, 0.2], 4);
    delete process.env.RAG_TOP_K;
  });

  it('caps the known-risk block, keeping the highest-scoring risks', async () => {
    generateJson.mockResolvedValue({ content: JSON.stringify({ answer: 'a', riskFlags: [] }) });
    const risks = Array.from({ length: 20 }, (_, i) => ({ clause: `Clause-${i}`, level: 'low', score: i, reason: 'r' }));

    await answerQuestion(doc, 'q', risks);

    const { prompt } = generateJson.mock.calls[0][0];
    expect(prompt).toContain('Clause-19');
    expect(prompt).toContain('Clause-12');
    expect(prompt).not.toContain('Clause-11'); // 8th highest is 12; lower scores are dropped
    expect(prompt).not.toContain('Clause-0');
  });

  it('serves an identical repeat question from cache without calling the LLM again', async () => {
    generateJson.mockResolvedValue({ content: JSON.stringify({ answer: 'cached me', riskFlags: [] }) });
    await answerQuestion(doc, 'Same question?');
    const second = await answerQuestion(doc, '  same   QUESTION? ');

    expect(second.answer).toBe('cached me');
    expect(generateJson).toHaveBeenCalledTimes(1);
    expect(embedTexts).toHaveBeenCalledTimes(1);
  });

  it('applies the Q&A timeout and generation options', async () => {
    generateJson.mockResolvedValue({ content: JSON.stringify({ answer: 'a', riskFlags: [] }) });
    await answerQuestion(doc, 'q');
    expect(generateJson.mock.calls[0][0].timeoutMs).toBe(25000);
  });
});

describe('streamAnswer', () => {
  it('emits sources first, then answer tokens, then the parsed result', async () => {
    streamText.mockReturnValue(pieces('The term is ', 'twelve months.\n###FL', 'AGS###\n{"riskFlags":[{"level":"low","clause":"2. Term","reason":"ok","chunkIndex":3}],"insufficientContext":false}'));

    const events = await collect(streamAnswer(doc, 'What is the term?'));

    expect(events[0].type).toBe('sources');
    expect(events[0].sources[0].chunkIndex).toBe(3);
    const text = events.filter((e) => e.type === 'token').map((e) => e.text).join('');
    expect(text.trim()).toBe('The term is twelve months.');
    const done = events[events.length - 1];
    expect(done.type).toBe('done');
    expect(done.result.answer).toBe('The term is twelve months.');
    expect(done.result.riskFlags).toHaveLength(1);
    expect(done.result.sources).toHaveLength(1);
  });

  it('caches a streamed answer so a repeat is replayed instantly', async () => {
    streamText.mockReturnValue(pieces('Once.\n###FLAGS###\n{"riskFlags":[],"insufficientContext":false}'));
    await collect(streamAnswer(doc, 'Repeat me'));
    const replay = await collect(streamAnswer(doc, 'repeat me'));

    expect(streamText).toHaveBeenCalledTimes(1);
    expect(replay.map((e) => e.type)).toEqual(['sources', 'token', 'done']);
    expect(replay[1].text).toBe('Once.');
  });

  it('fails clearly when the model returns nothing', async () => {
    streamText.mockReturnValue(pieces(''));
    await expect(collect(streamAnswer(doc, 'q'))).rejects.toThrow('empty response');
  });

  it('passes the abort signal through to the LLM stream', async () => {
    streamText.mockReturnValue(pieces('x\n###FLAGS###\n{}'));
    const controller = new AbortController();
    await collect(streamAnswer(doc, 'q', [], { signal: controller.signal }));
    expect(streamText.mock.calls[0][0].signal).toBe(controller.signal);
  });
});
