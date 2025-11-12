/**
 * TTS Service - Unified Text-to-Speech Service
 * Supports multiple TTS engines (Piper, Kani-TTS)
 */

import { KaniTtsClient } from './aiClients/kaniTtsClient.js';
import { getErrorMessage } from '../utils/errorHelpers.js';

export interface TtsSynthesisResult {
  audio: Buffer;
  sample_rate: number;
  duration: number;
}

export type TtsEngine = 'piper' | 'kani';

export class TtsService {
  private engine: TtsEngine;
  private kaniClient: KaniTtsClient | null = null;

  constructor(engine?: TtsEngine) {
    // Determine which TTS engine to use
    this.engine = engine || (process.env.TTS_ENGINE as TtsEngine) || 'kani';

    console.log(`[TTS] Initializing TTS service with engine: ${this.engine}`);

    // Initialize the appropriate client
    this.kaniClient = new KaniTtsClient();
  }

  /**
   * Synthesize text to speech
   * @param text Text to synthesize
   * @returns Audio buffer and metadata
   */
  async synthesize(text: string): Promise<TtsSynthesisResult> {
    try {
      if (this.engine === 'kani' && this.kaniClient) {
        const result = await this.kaniClient.synthesize(text);
        return {
          audio: result.audio,
          sample_rate: result.sample_rate,
          duration: result.duration ?? 0,
        };
      } else {
        throw new Error(`TTS engine '${this.engine}' not initialized`);
      }
    } catch (error) {
      console.error(`[TTS] Synthesis failed with ${this.engine}:`, getErrorMessage(error));
      throw error;
    }
  }

  /**
   * Check if TTS service is healthy
   * @returns true if service is healthy
   */
  async healthCheck(): Promise<boolean> {
    try {
      if (this.engine === 'kani' && this.kaniClient) {
        return await this.kaniClient.healthCheck();
      }
      return false;
    } catch (error) {
      console.error(`[TTS] Health check failed:`, getErrorMessage(error));
      return false;
    }
  }

  /**
   * Get current TTS engine name
   */
  getEngine(): TtsEngine {
    return this.engine;
  }

  /**
   * Get service information
   */
  async getInfo(): Promise<any> {
    try {
      if (this.engine === 'kani' && this.kaniClient) {
        return await this.kaniClient.getInfo();
      }
      return { engine: this.engine };
    } catch (error) {
      return { engine: this.engine, error: getErrorMessage(error) };
    }
  }
}

// Export singleton instance
let ttsServiceInstance: TtsService | null = null;

export function getTtsService(): TtsService {
  if (!ttsServiceInstance) {
    ttsServiceInstance = new TtsService();
  }
  return ttsServiceInstance;
}
