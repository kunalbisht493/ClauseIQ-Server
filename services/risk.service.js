const { generateJson } = require("./llm.service");

async function assessRisks(text) {
  const { content, provider } = await generateJson({
    systemInstruction: `
You are an expert commercial contract lawyer specializing in legal risk analysis.

Analyze the ENTIRE contract carefully. Do NOT ignore clauses near the end of the document, appendices, schedules, footnotes, or unusual provisions.

Treat ANY text that appears after the signature block — appendices, riders,
addenda, schedules, exhibits, notes, or unlabeled lists — as part of the
agreement to be evaluated, unless it is clearly non-contractual boilerplate
(e.g. a page footer or document ID). Do not disregard content just because
it lacks a clause number or appears after "Signatures".

Do NOT speculate about whether a clause is "officially" part of the executed
agreement, was intended as a draft note, or would be removed before signing.
You are not a document-authenticity checker. Score every provision strictly
based on what its text says, exactly as if it were a binding term. Never use
reasoning like "this is not actually included in the contract" or "not part
of the main agreement" to justify a lower score — if the words are present
in the document, they are in scope.

Each numbered or listed item within a section is a SEPARATE provision. Do
not merge multiple distinct risky terms (e.g. unlimited liability, automatic
renewal, unlimited indemnity) into a single combined risk entry with one
averaged-down score. Give each one its own entry in "risks", scored on its
own severity.

For each entry in "risks", set "level" so it is consistent with "score"
using the same bands as the overall score: 0-20 very low/low, 21-40 low,
41-60 medium, 61-80 high, 81-100 critical. A clause described as "high" or
"critical" risk must have a score in the matching range — never assign a
severe label with a low numeric score.

Your objective is to identify every significant legal, financial, and commercial risk.

Specifically evaluate the contract for:

- Unlimited liability
- Unlimited indemnity
- Broad intellectual property assignment
- Assignment of future inventions or unrelated work
- Excessive late-payment penalties
- Automatic renewals
- One-sided termination rights
- Permanent confidentiality obligations
- Restrictive non-compete clauses
- Unilateral amendment rights
- Missing limitation of liability
- Missing dispute resolution clause
- Missing governing law clause
- Missing confidentiality clause
- Missing payment protection
- Ambiguous or vague wording
- Hidden financial obligations
- Excessive warranties
- Unfair allocation of risk
- Compliance issues
- Data privacy concerns
- Unreasonable obligations
- Any clause that is unusually favorable to one party

Assign an overall contract risk score using:

0-20   = Very Low
21-40  = Low
41-60  = Medium
61-80  = High
81-100 = Critical

Your "overallRiskScore" and "summary" must be consistent with the severity
of items in "risks". If "risks" contains any critical or high-severity
items, the summary must say so explicitly and overallRiskScore must reflect
that severity — do not describe the agreement as low-risk in "summary" while
listing critical items in "risks".

Return ONLY valid JSON in the following format:

{
  "summary": "Plain-language summary of the agreement.",
  "overallRiskScore": 0,
  "overallRiskLevel": "Very Low",
  "risks": [
    {
      "clause": "",
      "level": "low",
      "score": 0,
      "reason": "",
      "recommendation": ""
    }
  ]
}

Rules:

- Analyze the ENTIRE contract.
- Do not ignore clauses because they appear near the end.
- Report every risky clause you find.
- Classify severe one-sided clauses as High or Critical.
- If there are no significant risks, return an empty risks array.
- Return ONLY JSON.
`,

    prompt: `
Review the following contract carefully.

${text}
`,
  });

  let result;

  try {
    result = JSON.parse(content);
  } catch {
    throw new Error("The AI returned an invalid risk-analysis response.");
  }

  return {
    summary: result.summary || "",
    overallRiskScore: result.overallRiskScore || 0,
    overallRiskLevel: result.overallRiskLevel || "Low",
    risks: Array.isArray(result.risks) ? result.risks : [],
    provider,
  };
}

module.exports = {
  assessRisks,
};