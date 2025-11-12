/**
 * AI Service Factory
 * Creates appropriate AI manager based on environment configuration
 * Allows easy switching between Gemini Live API and Local AI stack
 */

import { GeminiLiveManager } from './geminiLiveManager.js';
import { LocalAiManager } from './localAiManager.js';

export type AIBackend = 'gemini' | 'local';

/**
 * Create AI manager instance based on environment configuration
 * @returns AI manager instance (Gemini or Local)
 */
export function createAIManager(): any {
  const backend = (process.env.AI_BACKEND?.toLowerCase() || 'gemini') as AIBackend;

  console.log(`🤖 Creating AI Manager with backend: ${backend}`);

  switch (backend) {
    case 'local':
      console.log('✅ Using Local AI Stack (Ollama + Whisper + TTS)');
      return LocalAiManager.getInstance();

    case 'gemini':
    default:
      console.log('✅ Using Google Gemini Live API');
      return GeminiLiveManager.getInstance();
  }
}

/**
 * Get current AI backend configuration
 * @returns Current backend type
 */
export function getCurrentBackend(): AIBackend {
  return (process.env.AI_BACKEND?.toLowerCase() || 'gemini') as AIBackend;
}

/**
 * Check if local AI backend is configured
 * @returns true if AI_BACKEND is set to 'local'
 */
export function isLocalAI(): boolean {
  return getCurrentBackend() === 'local';
}

/**
 * Check if Gemini backend is configured
 * @returns true if AI_BACKEND is set to 'gemini' or not set
 */
export function isGeminiAI(): boolean {
  return getCurrentBackend() === 'gemini';
}

/**
 * Validate AI backend configuration
 * @throws Error if configuration is invalid
 */
export function validateAIBackendConfig(): void {
  const backend = getCurrentBackend();

  if (backend === 'local') {
    // Check local AI service URLs
    const ollamaUrl = process.env.OLLAMA_URL;
    const whisperUrl = process.env.WHISPER_URL;
    const ttsEngine = process.env.TTS_ENGINE || 'kani';
    const ttsUrl = ttsEngine === 'kani' ? process.env.KANI_TTS_URL : process.env.PIPER_URL;

    if (!ollamaUrl || !whisperUrl || !ttsUrl) {
      throw new Error(
        `Local AI backend requires OLLAMA_URL, WHISPER_URL, and ${ttsEngine === 'kani' ? 'KANI_TTS_URL' : 'PIPER_URL'} environment variables`
      );
    }

    console.log('✅ Local AI backend configuration valid');
    console.log(`   - Ollama: ${ollamaUrl}`);
    console.log(`   - Whisper: ${whisperUrl}`);
    console.log(`   - TTS (${ttsEngine}): ${ttsUrl}`);
  } else if (backend === 'gemini') {
    // Check Gemini API key
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

    if (!apiKey) {
      throw new Error('Gemini backend requires GEMINI_API_KEY or GOOGLE_API_KEY environment variable');
    }

    console.log('✅ Gemini backend configuration valid');
  }
}

/**
 * Get AI backend info for health checks
 * @returns Backend information
 */
export function getBackendInfo(): {
  backend: AIBackend;
  services?: string[];
  configured: boolean;
} {
  const backend = getCurrentBackend();

  if (backend === 'local') {
    return {
      backend: 'local',
      services: [
        `Ollama: ${process.env.OLLAMA_URL || 'not configured'}`,
        `Whisper: ${process.env.WHISPER_URL || 'not configured'}`,
        `Piper: ${process.env.PIPER_URL || 'not configured'}`,
      ],
      configured: !!(
        process.env.OLLAMA_URL &&
        process.env.WHISPER_URL &&
        process.env.PIPER_URL
      ),
    };
  }

  return {
    backend: 'gemini',
    services: [
      `Model: ${process.env.GEMINI_LIVE_MODEL || 'default'}`,
      `API Endpoint: https://generativelanguage.googleapis.com`,
    ],
    configured: !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
  };
}
