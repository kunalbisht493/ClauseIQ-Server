const { getGemini } = require("../config/gemini");
const { getGroq } = require("../config/groq");

async function generateJson({ systemInstruction, prompt }) {
  try {
    const response = await getGemini().models.generateContent({
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
      },
    });

    const content =
      typeof response.text === "function"
        ? await response.text()
        : response.text;

    if (!content || !content.trim()) {
      throw new Error("Gemini returned an empty response");
    }

    return {
      content,
      provider: "gemini",
    };
  } catch (geminiError) {
    console.error("Gemini failed:", geminiError);

    const completion = await getGroq().chat.completions.create({
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: systemInstruction,
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const content = completion.choices[0]?.message?.content;

    if (!content) {
      throw new Error(
        "Groq fallback returned an empty response after Gemini failed."
      );
    }

    return {
      content,
      provider: "groq",
    };
  }
}

module.exports = {
  generateJson,
};