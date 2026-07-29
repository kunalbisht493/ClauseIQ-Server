const { getOpenAI } = require('../config/openai');

async function assessRisks(text) {
  const result = await getOpenAI().chat.completions.create({
    model: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'You identify contractual risks. Return JSON with summary and risks, where every risk has clause, level, score, and reason.' },
      { role: 'user', content: text.slice(0, 30000) },
    ],
  });
  return JSON.parse(result.choices[0].message.content);
}

module.exports = { assessRisks };
