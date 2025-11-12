/**
 * Kani-TTS Client - Text-to-Speech Service
 * Model: nineninesix/kani-tts-370m (Apache 2.0 License)
 *
 * Attribution: This product uses the Kani-TTS model (© 2025 NineNineSix)
 * licensed under the Apache License 2.0.
 * Source: https://huggingface.co/nineninesix/kani-tts-370m
 */

import fetch from 'node-fetch';
import { getErrorMessage } from '../../utils/errorHelpers.js';

export interface KaniTtsSynthesisResponse {
  audio: Buffer;
  sample_rate: number;
  duration: number;
}

export class KaniTtsError extends Error {
  constructor(
    message: string,
    public code: string,
    public service: string = 'kani-tts'
  ) {
    super(message);
    this.name = 'KaniTtsError';
  }
}

export class KaniTtsClient {
  private baseUrl: string;
  private sampleRate: number;

  constructor(
    baseUrl: string = process.env.KANI_TTS_URL || 'http://localhost:10400',
    sampleRate: number = 22050
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.sampleRate = sampleRate;
  }

  /**
   * Synthesize text to speech using Kani-TTS
   * @param text Text to synthesize
   * @returns Audio buffer and metadata
   */
  async synthesize(text: string): Promise<KaniTtsSynthesisResponse> {
    try {
      // Kani-TTS requires minimum text length to avoid kernel size errors
      // Pad very short text to meet minimum requirements
      const minLength = 20;
      let synthesisText = text.trim();

      if (synthesisText.length < minLength) {
        console.log(`[Kani-TTS] Text too short (${synthesisText.length} chars), padding to minimum length`);
        // Add padding words that don't change meaning significantly
        synthesisText = synthesisText + '. Please note this.';
      }

      console.log(`[Kani-TTS] Synthesizing text (${synthesisText.length} chars)`);

      const response = await fetch(`${this.baseUrl}/api/tts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: synthesisText }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new KaniTtsError(
          `Kani-TTS API error: ${response.status} ${response.statusText} - ${errorText}`,
          `HTTP_${response.status}`
        );
      }

      // Get audio buffer
      const audioBuffer = Buffer.from(await response.arrayBuffer());

      if (audioBuffer.length === 0) {
        throw new KaniTtsError('Kani-TTS returned empty audio buffer', 'EMPTY_AUDIO');
      }

      console.log(`[Kani-TTS] Synthesized ${audioBuffer.length} bytes`);

      // Calculate duration (assuming WAV format with 16-bit PCM)
      // WAV header is 44 bytes, then 2 bytes per sample
      const numSamples = Math.max(0, (audioBuffer.length - 44) / 2);
      const duration = numSamples / this.sampleRate;

      return {
        audio: audioBuffer,
        sample_rate: this.sampleRate,
        duration,
      };
    } catch (error) {
      if (error instanceof KaniTtsError) {
        throw error;
      }

      // Handle network errors
      if (error instanceof Error && error.message.includes('ECONNREFUSED')) {
        throw new KaniTtsError(
          `Failed to connect to Kani-TTS service at ${this.baseUrl}. Is it running?`,
          'CONNECTION_ERROR'
        );
      }

      throw new KaniTtsError(
        `Kani-TTS synthesis failed: ${getErrorMessage(error)}`,
        'UNKNOWN_ERROR'
      );
    }
  }

  /**
   * Check if Kani-TTS service is healthy
   * @returns true if service is reachable and healthy
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
      });

      if (!response.ok) {
        return false;
      }

      const data: any = await response.json();
      return data.status === 'ok';
    } catch (error) {
      console.error('[Kani-TTS] Health check failed:', getErrorMessage(error));
      return false;
    }
  }

  /**
   * Get service information
   * @returns Service metadata
   */
  async getInfo(): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
      });

      if (!response.ok) {
        throw new KaniTtsError('Failed to get service info', 'INFO_ERROR');
      }

      return await response.json();
    } catch (error) {
      throw new KaniTtsError(
        `Failed to get Kani-TTS info: ${getErrorMessage(error)}`,
        'INFO_ERROR'
      );
    }
  }
}

// Export singleton instance
let kaniTtsInstance: KaniTtsClient | null = null;

export function getKaniTtsClient(): KaniTtsClient {
  if (!kaniTtsInstance) {
    kaniTtsInstance = new KaniTtsClient();
  }
  return kaniTtsInstance;
}
