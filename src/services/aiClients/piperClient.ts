/**
 * Piper Client - Text-to-Speech Service
 * Handles speech synthesis using Piper TTS
 */

import fetch from 'node-fetch';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
  PiperSynthesisRequest,
  PiperSynthesisResponse,
  PiperVoice,
  PiperError,
} from '../../types/localAI.js';
import {
  getErrorMessage,
  isFetchError,
  isTimeoutError,
  isErrorWithCode,
} from '../../utils/errorHelpers.js';

const execAsync = promisify(exec);

export class PiperClient {
  private baseUrl: string;
  private voice: string;
  private sampleRate: number;

  constructor(
    baseUrl: string = process.env.PIPER_URL || 'http://localhost:10200',
    voice: string = process.env.PIPER_VOICE || 'en_US-lessac-medium',
    sampleRate: number = parseInt(process.env.PIPER_SAMPLE_RATE || '24000')
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.voice = voice;
    this.sampleRate = sampleRate;
  }

  /**
   * Synthesize text to speech
   * @param text Text to convert to speech
   * @param options Synthesis options
   * @returns Audio buffer and metadata
   */
  async synthesize(
    text: string,
    options: Partial<PiperSynthesisRequest> = {}
  ): Promise<PiperSynthesisResponse> {
    try {
      // Piper runs as a Docker container, so we'll use docker exec
      const voice = options.voice || this.voice;
      const lengthScale = options.length_scale || 1.0;
      const noiseScale = options.noise_scale || 0.667;
      const noiseW = options.noise_w || 0.8;

      // Escape text for shell
      const escapedText = text.replace(/'/g, "'\\''");

      // Build Piper command
      const command = `docker exec jdlabs-piper bash -c "echo '${escapedText}' | /data/piper/piper --model ${voice} --output_raw --length_scale ${lengthScale} --noise_scale ${noiseScale} --noise_w ${noiseW}"`;

      const { stdout, stderr } = await execAsync(command, {
        encoding: 'buffer',
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      });

      if (stderr && stderr.length > 0) {
        const errorText = stderr.toString();
        // Piper sometimes outputs info to stderr, only throw if it's an actual error
        if (errorText.toLowerCase().includes('error') || errorText.toLowerCase().includes('failed')) {
          throw new PiperError(`Piper stderr: ${errorText}`, 'SYNTHESIS_ERROR');
        }
      }

      // stdout contains raw PCM audio
      const audioBuffer = Buffer.from(stdout);

      if (audioBuffer.length === 0) {
        throw new PiperError('Piper returned empty audio buffer', 'EMPTY_AUDIO');
      }

      // Calculate duration (PCM Int16, mono)
      const numSamples = audioBuffer.length / 2; // 2 bytes per sample (Int16)
      const duration = numSamples / this.sampleRate;

      return {
        audio: audioBuffer,
        sample_rate: this.sampleRate,
        duration,
      };
    } catch (error) {
      if (error instanceof PiperError) {
        throw error;
      }

      if (isErrorWithCode(error) && error.code === 'ENOENT') {
        throw new PiperError(
          'Docker not found. Make sure Docker is installed and running.',
          'DOCKER_NOT_FOUND'
        );
      }

      if (getErrorMessage(error).includes('No such container')) {
        throw new PiperError(
          'Piper container not found. Run docker-compose up first.',
          'CONTAINER_NOT_FOUND'
        );
      }

      throw new PiperError(`Piper synthesis failed: ${getErrorMessage(error)}`, 'UNKNOWN_ERROR');
    }
  }

  /**
   * Alternative HTTP-based synthesis (if Piper is exposed via HTTP API)
   * Note: Default Piper image doesn't have HTTP API, this is for future compatibility
   */
  async synthesizeHTTP(
    text: string,
    options: Partial<PiperSynthesisRequest> = {}
  ): Promise<PiperSynthesisResponse> {
    try {
      const requestBody = {
        text,
        voice: options.voice || this.voice,
        speaker: options.speaker || 0,
        length_scale: options.length_scale || 1.0,
        noise_scale: options.noise_scale || 0.667,
        noise_w: options.noise_w || 0.8,
      };

      const response = await fetch(`${this.baseUrl}/synthesize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new PiperError(
          `Piper HTTP API error: ${response.status} ${response.statusText} - ${errorText}`,
          `HTTP_${response.status}`
        );
      }

      const audioBuffer = Buffer.from(await response.arrayBuffer());

      if (audioBuffer.length === 0) {
        throw new PiperError('Piper returned empty audio buffer', 'EMPTY_AUDIO');
      }

      const numSamples = audioBuffer.length / 2;
      const duration = numSamples / this.sampleRate;

      return {
        audio: audioBuffer,
        sample_rate: this.sampleRate,
        duration,
      };
    } catch (error) {
      if (error instanceof PiperError) {
        throw error;
      }

      if (isFetchError(error)) {
        throw new PiperError(
          `Failed to connect to Piper service at ${this.baseUrl}`,
          'CONNECTION_ERROR'
        );
      }

      if (isTimeoutError(error)) {
        throw new PiperError('Piper synthesis timed out', 'TIMEOUT');
      }

      throw new PiperError(`Piper HTTP synthesis failed: ${getErrorMessage(error)}`, 'UNKNOWN_ERROR');
    }
  }

  /**
   * Synthesize with retry logic
   * @param text Text to synthesize
   * @param options Synthesis options
   * @param maxRetries Maximum retry attempts
   * @returns Audio buffer
   */
  async synthesizeWithRetry(
    text: string,
    options: Partial<PiperSynthesisRequest> = {},
    maxRetries: number = 3
  ): Promise<PiperSynthesisResponse> {
    let lastError: Error | undefined = undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.synthesize(text, options);
      } catch (error) {
        lastError = error as Error;
        console.warn(`Piper synthesis attempt ${attempt} failed:`, getErrorMessage(error));

        // Don't retry on certain errors
        if (
          error instanceof PiperError &&
          error.code &&
          ['EMPTY_AUDIO', 'DOCKER_NOT_FOUND', 'CONTAINER_NOT_FOUND'].includes(error.code)
        ) {
          throw error;
        }

        // Wait before retrying
        if (attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError || new Error('Synthesis failed after retries');
  }

  /**
   * Check if Piper service is healthy
   * @returns true if service is reachable
   */
  async healthCheck(): Promise<boolean> {
    try {
      const { stdout, stderr } = await execAsync(
        'docker exec jdlabs-piper /data/piper/piper --version'
      );
      return stdout.toString().includes('piper') || stderr.toString().includes('piper');
    } catch (error) {
      console.error('Piper health check failed:', getErrorMessage(error));
      return false;
    }
  }

  /**
   * List available voices
   * @returns Array of available voices
   */
  async listVoices(): Promise<PiperVoice[]> {
    try {
      const { stdout } = await execAsync(
        'docker exec jdlabs-piper /data/piper/piper --list-voices'
      );

      const lines = stdout.toString().split('\n');
      const voices: PiperVoice[] = [];

      for (const line of lines) {
        // Parse voice info (format varies, this is a simple parser)
        const match = line.match(/^(\S+)\s+(\w+)\s+(\w+)/);
        if (match) {
          voices.push({
            name: match[1],
            language: match[2],
            quality: match[3] as 'low' | 'medium' | 'high',
          });
        }
      }

      return voices;
    } catch (error) {
      console.warn('Could not fetch Piper voices:', getErrorMessage(error));
      // Return common default voices
      return [
        { name: 'en_US-lessac-medium', language: 'en_US', quality: 'medium' },
        { name: 'en_US-ryan-high', language: 'en_US', quality: 'high' },
        { name: 'en_GB-alan-medium', language: 'en_GB', quality: 'medium' },
      ];
    }
  }

  /**
   * Convert raw PCM to base64 (for WebSocket transmission)
   * @param audioBuffer PCM audio buffer
   * @returns Base64 encoded audio
   */
  toBase64(audioBuffer: Buffer): string {
    return audioBuffer.toString('base64');
  }

  /**
   * Get audio format info for client
   * @returns MIME type and sample rate
   */
  getAudioFormat(): { mimeType: string; sampleRate: number } {
    return {
      mimeType: `audio/pcm;rate=${this.sampleRate}`,
      sampleRate: this.sampleRate,
    };
  }
}

// Export singleton instance
let piperInstance: PiperClient | null = null;

export function getPiperClient(): PiperClient {
  if (!piperInstance) {
    piperInstance = new PiperClient();
  }
  return piperInstance;
}
