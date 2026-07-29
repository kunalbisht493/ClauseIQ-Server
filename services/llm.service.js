const { getGemini } = require('../config/gemini');
const { getGroq } = require('../config/groq');

async function generateJson({ systemInstruction, prompt }) {
  try {
    const response = await getGemini().models.generateContent({
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite',
      contents: prompt,
      config: { systemInstruction, responseMimeType: 'application/json' },
    });
    if (!response.text) throw new Error('Gemini returned an empty response');
    return { content: response.text, provider: 'gemini' };
  } catch (geminiError) {
    const completion = await getGroq().chat.completions.create({
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: systemInstruction }, { role: 'user', content: prompt }],
    });
    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error('Groq fallback returned an empty response after Gemini failed: ' + geminiError.message);
    return { content, provider: 'groq' };
  }
}

module.exports = { generateJson };
