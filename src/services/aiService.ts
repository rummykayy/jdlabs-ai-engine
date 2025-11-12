import { Chat, Type } from '@google/genai';
import type { InterviewSettings, AiChatSession, InterviewQuestion, InterviewAnswer, FeedbackData } from '../types/shared/types.js';
import { createGenAI, createGenerativeAI } from './aiConfig.js';

// ===== EXISTING IMPLEMENTATION (for backward compatibility) =====

// --- Gemini Implementation (Existing) ---
const createGeminiChatSession = (model: string, systemInstruction: string): AiChatSession => {
  const ai = createGenAI();
  const chat: Chat = ai.chats.create({
    model,
    config: { systemInstruction },
  });
  return {
    sendMessage: async (message: string): Promise<string> => {
      const result = await chat.sendMessage({ message });
      return result.text || '';
    },
  };
};

// --- Public Factory Function for Chat (Existing) ---
interface CreateChatSessionParams {
  model: string;
  systemInstruction: string;
}

export const createChatSession = ({ model, systemInstruction }: CreateChatSessionParams): AiChatSession => {
  return createGeminiChatSession(model, systemInstruction);
};

// --- Public Function for URL Text Extraction (Existing) ---
interface ExtractTextFromUrlParams {
  model: string;
  url: string;
}

export const extractTextFromUrl = async ({ model, url }: ExtractTextFromUrlParams): Promise<string> => {
  const prompt = `Please extract the full, clean text of the main job description from the following URL. Respond with only the job description text, with no introductory or concluding phrases like "Here is the job description". URL: ${url}`;

  const ai = createGenAI();
  const response = await ai.models.generateContent({ model, contents: prompt });
  return (response.text || '').trim();
};

// --- Public Function for Question Generation (Existing) ---
interface GenerateQuestionsParams {
  model: string;
  jobDescription: string;
  difficulty: string;
}

export const generateQuestions = async ({ model, jobDescription, difficulty }: GenerateQuestionsParams): Promise<string[]> => {
  const questionSchema = {
    type: Type.OBJECT,
    properties: {
      questions: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
      },
    },
    required: ['questions'],
  };

  const prompt = `Based on the following job description and interview difficulty, generate 5 relevant interview questions.

    Job Description: "${jobDescription}"
    Difficulty: "${difficulty}"

    Return the questions as a JSON object with a single key "questions" containing an array of strings. Do not add any other text.`;

  const ai = createGenAI();
  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: questionSchema,
    }
  });

  try {
    const result = JSON.parse(response.text || '{}');
    if (result.questions && Array.isArray(result.questions)) {
      return result.questions;
    }
    throw new Error("Invalid format for generated questions.");
  } catch (e) {
    console.error("Failed to parse AI-generated questions:", response.text, e);
    // Fallback to simpler parsing if strict JSON fails
    const lines = (response.text || '').split('\n').filter((line: string) => line.trim().match(/^\d+\./));
    if (lines.length > 0) return lines.map((line: string) => line.replace(/^\d+\.\s*/, '').trim());
    throw new Error("Could not generate or parse interview questions.");
  }
};


// --- Public Function for Feedback Generation (Existing) ---
interface GenerateFeedbackParams {
  model: string;
  questions: InterviewQuestion[];
  answers: InterviewAnswer[];
  settings: InterviewSettings;
}

export const generateFeedback = async ({ model, questions, answers, settings }: GenerateFeedbackParams): Promise<FeedbackData> => {
  const feedbackSchema = {
    type: Type.OBJECT,
    properties: {
      overallRating: { type: Type.NUMBER, description: "Overall rating from 1-10" },
      overallReasoning: { type: Type.STRING },
      recommendation: { type: Type.STRING, description: "A final hiring recommendation. Must be one of: 'Recommended for Hire', 'Needs Improvement', 'Not a Fit'." },
      metrics: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            rating: { type: Type.NUMBER, description: "Rating from 1-10" },
            reasoning: { type: Type.STRING }
          },
          required: ['name', 'rating', 'reasoning']
        }
      },
      strengths: {
        type: Type.ARRAY,
        items: { type: Type.STRING }
      },
      areasForImprovement: {
        type: Type.ARRAY,
        items: { type: Type.STRING }
      }
    },
    required: ['overallRating', 'overallReasoning', 'recommendation', 'metrics', 'strengths', 'areasForImprovement']
  };

  const qaPairs = questions.map((q, i) => {
    const answer = answers.find(a => a.question_id === q.id);
    return `Q${i + 1}: ${q.question_text}\nA${i + 1}: ${answer?.answer_text || 'No answer provided'}`;
  }).join('\n\n');

  const prompt = `You are an AI evaluating a job interview for a "${settings.position}" role.

Job Description: "${settings.jobDescription}"
Difficulty: ${settings.difficulty}
Interview Mode: ${settings.mode}

Here are the interview questions and candidate answers:

${qaPairs}

Evaluate the candidate and provide:
1. Overall rating (1-10 scale)
2. Overall reasoning
3. Hiring recommendation (exactly one of: "Recommended for Hire", "Needs Improvement", "Not a Fit")
4. At least 3 metrics with ratings and reasoning (e.g., Technical Skills, Communication, Problem-Solving)
5. At least 2 strengths
6. At least 2 areas for improvement

Return as structured JSON.`;

  const ai = createGenAI();
  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: feedbackSchema,
    }
  });

  try {
    const feedback = JSON.parse(response.text || '{}');
    return feedback;
  } catch (e) {
    console.error("Failed to parse AI-generated feedback:", response.text, e);
    throw new Error("Could not generate or parse interview feedback.");
  }
};

// ===== NEW MULTI-STAGE INTERVIEW IMPLEMENTATION =====

const genAI = createGenerativeAI();

export const GEMINI_MODELS = {
  hr: "gemini-2.5-flash",
  tech: "gemini-2.5-flash",
  voice: "gemini-2.5-flash-native-audio-latest",
  summary: "gemini-2.5-pro",
};

// Create multi-stage chat session (HR, Tech, or Summary)
export const createMultiStageChatSession = (
  round: "hr" | "tech" | "summary",
  systemInstruction: string
): AiChatSession => {
  const model = genAI.getGenerativeModel({ model: GEMINI_MODELS[round] });

  return {
    sendMessage: async (message: string): Promise<string> => {
      try {
        const result = await model.generateContent([
          { text: systemInstruction },
          { text: message }
        ]);
        return result.response.text();
      } catch (error) {
        console.error(`Error in ${round} round:`, error);
        throw error;
      }
    },
  };
};

// Voice-based interview round analysis
export const analyzeVoiceResponse = async (audioBuffer: Buffer): Promise<string> => {
  const model = genAI.getGenerativeModel({ model: GEMINI_MODELS.voice });

  try {
    const result = await model.generateContent([
      { text: "Analyze the tone, fluency, confidence, and communication skills demonstrated in this voice response. Provide detailed feedback on verbal communication quality." },
      {
        inlineData: {
          mimeType: "audio/wav",
          data: audioBuffer.toString("base64"),
        }
      }
    ]);

    return result.response.text();
  } catch (error) {
    console.error("Error analyzing voice response:", error);
    throw error;
  }
};

// Extract job text from URL (multi-stage compatible)
export const extractJobDescriptionFromUrl = async (url: string): Promise<string> => {
  const prompt = `Extract the main job description from this URL. Return only the job description text without any introduction or conclusion: ${url}`;
  const model = genAI.getGenerativeModel({ model: GEMINI_MODELS.hr });

  try {
    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (error) {
    console.error("Error extracting job description:", error);
    throw error;
  }
};

// Final summary generation combining all interview stages
export const generateFinalReport = async (
  candidateName: string,
  hrSummary: string,
  techSummary: string,
  voiceSummary: string
): Promise<string> => {
  const model = genAI.getGenerativeModel({ model: GEMINI_MODELS.summary });
  const prompt = `
  Generate a comprehensive final interview report for the following candidate:

  Candidate Name: ${candidateName}

  HR Round Summary:
  ${hrSummary}

  Technical Round Summary:
  ${techSummary}

  Voice/Communication Evaluation:
  ${voiceSummary}

  Create a concise final report with the following sections:
  1. Executive Summary
  2. HR Round Assessment (rating 1-10)
  3. Technical Skills Evaluation (rating 1-10)
  4. Communication & Soft Skills (rating 1-10)
  5. Overall Score (weighted average)
  6. Key Strengths (3-5 points)
  7. Areas for Development (2-3 points)
  8. Final Recommendation: [Strongly Recommend / Recommend / Consider / Not Recommend / Strongly Not Recommend]

  Format the report professionally and include specific examples from each round.
  `;

  try {
    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (error) {
    console.error("Error generating final report:", error);
    throw error;
  }
};

// Generate stage-specific questions
export const generateStageQuestions = async (
  stage: "hr" | "tech",
  jobRole: string,
  jobDescription: string,
  difficulty: string,
  count: number = 5
): Promise<string[]> => {
  const model = genAI.getGenerativeModel({ model: GEMINI_MODELS[stage] });

  const stageContext = stage === "hr"
    ? "Focus on behavioral questions, culture fit, motivation, career goals, and soft skills."
    : "Focus on technical competency, problem-solving, coding knowledge, system design, and role-specific technical skills.";

  const prompt = `You are conducting a ${stage.toUpperCase()} interview for a ${jobRole} position.

Job Description:
${jobDescription}

Difficulty Level: ${difficulty}
${stageContext}

Generate ${count} relevant interview questions for this ${stage} round.
Return ONLY a JSON array of question strings, like: ["Question 1?", "Question 2?", ...]
No additional text or formatting.`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();

    // Try to parse as JSON
    try {
      const questions = JSON.parse(text);
      if (Array.isArray(questions)) {
        return questions;
      }
    } catch (e) {
      // Fallback: extract questions manually
      const lines = text.split('\n').filter((line: string) => line.trim().match(/^\d+[\.)]/));
      if (lines.length > 0) {
        return lines.map((line: string) => line.replace(/^\d+[\.)]\s*/, '').trim());
      }
    }

    throw new Error("Could not parse questions from AI response");
  } catch (error) {
    console.error(`Error generating ${stage} questions:`, error);
    throw error;
  }
};

// Evaluate stage-specific answers
export const evaluateStageAnswers = async (
  stage: "hr" | "tech",
  questions: string[],
  answers: string[],
  jobRole: string
): Promise<{
  overallScore: number;
  feedback: string;
  strengths: string[];
  improvements: string[];
}> => {
  const model = genAI.getGenerativeModel({ model: GEMINI_MODELS[stage] });

  const qaPairs = questions.map((q, i) =>
    `Q${i + 1}: ${q}\nA${i + 1}: ${answers[i] || 'No answer provided'}`
  ).join('\n\n');

  const prompt = `Evaluate this ${stage.toUpperCase()} interview for a ${jobRole} position:

${qaPairs}

Provide evaluation in JSON format:
{
  "overallScore": <number 1-10>,
  "feedback": "<detailed feedback>",
  "strengths": ["<strength 1>", "<strength 2>", ...],
  "improvements": ["<area 1>", "<area 2>", ...]
}`;

  try {
    const result = await model.generateContent(prompt);
    const evaluation = JSON.parse(result.response.text());
    return evaluation;
  } catch (error) {
    console.error(`Error evaluating ${stage} answers:`, error);
    throw error;
  }
};

console.log('✅ AI Service initialized with multi-stage interview support (Gemini 2.0)');
