jest.mock('../services/embedding.service', () => ({ embedTexts: jest.fn() }));
jest.mock('../services/vector.service', () => ({ search: jest.fn(), upsertChunks: jest.fn() }));
jest.mock('../services/llm.service', () => ({ generateJson: jest.fn() }));

const { embedTexts } = require('../services/embedding.service');
const { search } = require('../services/vector.service');
const { generateJson } = require('../services/llm.service');
const { answerQuestion } = require('../services/rag.service');

describe('answerQuestion', () => {
  it('uses the Qdrant payload as retrieved context', async () => {
    embedTexts.mockResolvedValue([[0.1, 0.2]]);
    search.mockResolvedValue([{ score: 0.91, payload: { chunkIndex: 3, text: 'The term is twelve months.' } }]);
    generateJson.mockResolvedValue({ content: JSON.stringify({ answer: 'The term is twelve months.', riskFlags: [], insufficientContext: false }) });

    const result = await answerQuestion({ _id: 'document-id', vectorNS: 'document-id' }, 'What is the term?');

    expect(embedTexts).toHaveBeenCalledWith(['What is the term?'], 'RETRIEVAL_QUERY');
    expect(result.sources).toEqual([{ chunkIndex: 3, score: 0.91, text: 'The term is twelve months.' }]);
    expect(result.answer).toBe('The term is twelve months.');
  });
});
