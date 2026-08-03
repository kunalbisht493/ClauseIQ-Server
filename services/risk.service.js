const { generateJson } = require("./llm.service");

async function assessRisks(text) {
  const { content, provider } = await generateJson({
    systemInstruction: `
You are an expert legal contract risk analyzer.

Return JSON:

{
  "summary":"",
  "risks":[
    {
      "clause":"",
      "level":"low|medium|high",
      "score":0,
      "reason":""
    }
  ]
}
`,
    prompt: text.slice(0, 30000),
  });
  let result;
  try {
    result = JSON.parse(content);
  } catch {
    throw new Error('The AI returned an invalid risk-analysis response');
  }
  return {
    summary: typeof result.summary === 'string' ? result.summary : '',
    risks: Array.isArray(result.risks) ? result.risks : [],
    provider,
  };
}

module.exports = { assessRisks };
