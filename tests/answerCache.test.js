const { cacheKey, getCached, setCached, clearCache } = require('../services/answerCache');

beforeEach(() => clearCache());

describe('answerCache', () => {
  it('returns a stored value and normalizes case/whitespace in the question', () => {
    setCached(cacheKey('doc1', 'What is the  TERM?', 2), { answer: 'twelve months' });
    expect(getCached(cacheKey('doc1', ' what is the term? ', 2))).toEqual({ answer: 'twelve months' });
  });

  it('keeps documents separate', () => {
    setCached(cacheKey('doc1', 'q', 0), { answer: 'a' });
    expect(getCached(cacheKey('doc2', 'q', 0))).toBeNull();
  });

  it('does not reuse an answer given before the risk analysis existed', () => {
    setCached(cacheKey('doc1', 'q', 0), { answer: 'early' });
    expect(getCached(cacheKey('doc1', 'q', 5))).toBeNull();
  });

  it('expires entries after the TTL', () => {
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(1_000);
    setCached(cacheKey('d', 'q'), { answer: 'a' });
    now.mockReturnValue(1_000 + 60 * 60 * 1000 + 1);
    expect(getCached(cacheKey('d', 'q'))).toBeNull();
    now.mockRestore();
  });
});
