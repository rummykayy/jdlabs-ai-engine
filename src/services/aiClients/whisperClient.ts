/**
 * Whisper Client - Speech-to-Text Service
 * Handles audio transcription using OpenAI Whisper ASR WebService
 */

import FormData from 'form-data';
import fetch from 'node-fetch';
import {
  WhisperTranscriptionRequest,
  WhisperTranscriptionResponse,
  WhisperError,
} from '../../types/localAI.js';
import {
  getErrorMessage,
  isFetchError,
  isTimeoutError,
  isErrorWithCode,
} from '../../utils/errorHelpers.js';

export class WhisperClient {
  private baseUrl: string;
  private model: string;
  private language: string;

  constructor(
    baseUrl: string = process.env.WHISPER_URL || 'http://localhost:9000',
    model: string = process.env.WHISPER_MODEL || 'base.en',
    language: string = process.env.WHISPER_LANGUAGE || 'en'
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.model = model;
    this.language = language;
  }

  /**
   * Transcribe audio buffer to text
   * @param audioBuffer Audio data as Buffer (WAV or WebM format)
   * @param options Additional transcription options
   * @returns Transcription text and metadata
   */
  async transcribe(
    audioBuffer: Buffer,
    options: Partial<WhisperTranscriptionRequest> = {}
  ): Promise<WhisperTranscriptionResponse> {
    try {
      // Create multipart form data
      const formData = new FormData();
      formData.append('audio_file', audioBuffer, {
        filename: 'audio.wav',
        contentType: 'audio/wav',
      });

      // Add optional parameters
      if (options.task) {
        formData.append('task', options.task);
      }
      if (options.language || this.language) {
        formData.append('language', options.language || this.language);
      }
      if (options.initial_prompt) {
        formData.append('initial_prompt', options.initial_prompt);
      }
      if (options.vad_filter !== undefined) {
        formData.append('vad_filter', String(options.vad_filter));
      }
      if (options.word_timestamps !== undefined) {
        formData.append('word_timestamps', String(options.word_timestamps));
      }

      // Send request to Whisper API
      const response = await fetch(`${this.baseUrl}/asr`, {
        method: 'POST',
        body: formData,
        headers: formData.getHeaders(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new WhisperError(
          `Whisper API error: ${response.status} ${response.statusText} - ${errorText}`,
          `HTTP_${response.status}`
        );
      }

      const result: any = await response.json();

      // Handle different response formats
      if (typeof result === 'string') {
        return { text: result };
      }

      if (result.text) {
        return {
          text: result.text,
          language: result.language,
          segments: result.segments,
        };
      }

      throw new WhisperError('Invalid response format from Whisper API', 'INVALID_RESPONSE');
    } catch (error) {
      if (error instanceof WhisperError) {
        throw error;
      }

      if (isFetchError(error)) {
        throw new WhisperError(
          `Failed to connect to Whisper service at ${this.baseUrl}. Is it running?`,
          'CONNECTION_ERROR'
        );
      }

      if (isTimeoutError(error)) {
        throw new WhisperError('Whisper transcription timed out', 'TIMEOUT');
      }

      throw new WhisperError(
        `Whisper transcription failed: ${getErrorMessage(error)}`,
        'UNKNOWN_ERROR'
      );
    }
  }

  /**
   * Transcribe with retry logic
   * @param audioBuffer Audio data
   * @param options Transcription options
   * @param maxRetries Maximum number of retries
   * @returns Transcription result
   */
  async transcribeWithRetry(
    audioBuffer: Buffer,
    options: Partial<WhisperTranscriptionRequest> = {},
    maxRetries: number = 3
  ): Promise<WhisperTranscriptionResponse> {
    let lastError: Error | undefined = undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.transcribe(audioBuffer, options);
      } catch (error) {
        lastError = error as Error;
        console.warn(`Whisper transcription attempt ${attempt} failed:`, getErrorMessage(error));

        // Don't retry on certain errors
        if (
          error instanceof WhisperError &&
          error.code &&
          ['INVALID_RESPONSE', 'HTTP_400', 'HTTP_422'].includes(error.code)
        ) {
          throw error;
        }

        // Wait before retrying (exponential backoff)
        if (attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError || new Error('Transcription failed after retries');
  }

  /**
   * Check if Whisper service is healthy
   * @returns true if service is reachable and healthy
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/`, {
        method: 'GET',
      });
      return response.ok;
    } catch (error) {
      console.error('Whisper health check failed:', getErrorMessage(error));
      return false;
    }
  }

  /**
   * Get available models (if API supports it)
   */
  async getAvailableModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        method: 'GET',
      });

      if (response.ok) {
        const data: any = await response.json();
        return data.models || [];
      }

      // Default models if endpoint not available
      return ['tiny', 'base', 'small', 'medium', 'large'];
    } catch (error) {
      console.warn('Could not fetch Whisper models:', getErrorMessage(error));
      return ['tiny', 'base', 'small', 'medium', 'large'];
    }
  }
}

// Export singleton instance
let whisperInstance: WhisperClient | null = null;

export function getWhisperClient(): WhisperClient {
  if (!whisperInstance) {
    whisperInstance = new WhisperClient();
  }
  return whisperInstance;
}
