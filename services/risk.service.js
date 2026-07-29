const { generateJson } = require("./llm.service");

async function assessRisks(text) {
  return await generateJson({
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
}

module.exports = { assessRisks };