const request = require('supertest');
const app = require('../app');

describe('GET /health', () => {
  it('returns the service status', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      status: 'ok',
      mongo: expect.stringMatching(/^(ok|error)$/),
      qdrant: expect.stringMatching(/^(ok|error)$/),
    }));
  });
});
