jest.mock('../services/llm.service', () => ({ generateJson: jest.fn() }));

const { generateJson } = require('../services/llm.service');
const { assessRisks } = require('../services/risk.service');

describe('assessRisks', () => {
  it('parses the structured response before returning it to the controller', async () => {
    generateJson.mockResolvedValue({
      provider: 'gemini',
      content: JSON.stringify({ summary: 'One material risk.', risks: [{ clause: 'Auto-renewal', level: 'high', score: 80, reason: 'Requires notice.' }] }),
    });

    await expect(assessRisks('contract text')).resolves.toEqual({
      provider: 'gemini',
      summary: 'One material risk.',
      overallRiskScore: 0,
      overallRiskLevel: 'Low',
      risks: [{ clause: 'Auto-renewal', level: 'high', score: 80, reason: 'Requires notice.' }],
    });
  });
});
