/**
 * Ollama Client - Large Language Model Service
 * Handles text generation and chat conversations using Ollama
 */

import fetch from 'node-fetch';
import {
  OllamaChatRequest,
  OllamaChatResponse,
  OllamaMessage,
  OllamaOptions,
  OllamaStreamChunk,
  OllamaModelInfo,
  OllamaError,
} from '../../types/localAI.js';
import {
  getErrorMessage,
  isFetchError,
  isTimeoutError,
} from '../../utils/errorHelpers.js';

export class OllamaClient {
  private baseUrl: string;
  private model: string;
  private defaultOptions: OllamaOptions;

  constructor(
    baseUrl: string = process.env.OLLAMA_URL || 'http://localhost:11434',
    model: string = process.env.OLLAMA_MODEL || 'gemma2:2b-instruct-q4',
    defaultOptions: OllamaOptions = {}
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.model = model;
    this.defaultOptions = {
      temperature: parseFloat(process.env.OLLAMA_TEMPERATURE || '0.7'),
      num_predict: parseInt(process.env.OLLAMA_MAX_TOKENS || '2048'),
      ...defaultOptions,
    };
  }

  /**
   * Send a chat completion request (non-streaming)
   * @param messages Conversation history
   * @param options Generation options
   * @returns Complete response from the model
   */
  async chat(
    messages: OllamaMessage[],
    options: OllamaOptions = {}
  ): Promise<OllamaChatResponse> {
    try {
      const request: OllamaChatRequest = {
        model: this.model,
        messages,
        stream: false,
        options: { ...this.defaultOptions, ...options },
      };

      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new OllamaError(
          `Ollama API error: ${response.status} ${response.statusText} - ${errorText}`,
          `HTTP_${response.status}`
        );
      }

      const result = await response.json();
      return result as OllamaChatResponse;
    } catch (error) {
      if (error instanceof OllamaError) {
        throw error;
      }

      if (isFetchError(error)) {
        throw new OllamaError(
          `Failed to connect to Ollama service at ${this.baseUrl}. Is it running?`,
          'CONNECTION_ERROR'
        );
      }

      if (isTimeoutError(error)) {
        throw new OllamaError('Ollama generation timed out', 'TIMEOUT');
      }

      throw new OllamaError(`Ollama chat failed: ${getErrorMessage(error)}`, 'UNKNOWN_ERROR');
    }
  }

  /**
   * Stream chat completion (yields tokens as they're generated)
   * @param messages Conversation history
   * @param onChunk Callback for each token chunk
   * @param options Generation options
   */
  async chatStream(
    messages: OllamaMessage[],
    onChunk: (chunk: string, done: boolean) => void,
    options: OllamaOptions = {}
  ): Promise<void> {
    try {
      const request: OllamaChatRequest = {
        model: this.model,
        messages,
        stream: true,
        options: { ...this.defaultOptions, ...options },
      };

      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new OllamaError(
          `Ollama API error: ${response.status} ${response.statusText} - ${errorText}`,
          `HTTP_${response.status}`
        );
      }

      // Process streaming response
      const reader = response.body;
      if (!reader) {
        throw new OllamaError('No response body', 'NO_BODY');
      }

      let buffer = '';

      for await (const chunk of reader) {
        buffer += chunk.toString();
        const lines = buffer.split('\n');

        // Process complete lines
        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i]?.trim();
          if (line) {
            try {
              const data: OllamaStreamChunk = JSON.parse(line);
              onChunk(data.message.content, data.done);

              if (data.done) {
                return;
              }
            } catch (parseError) {
              console.warn('Failed to parse Ollama stream chunk:', line);
            }
          }
        }

        // Keep incomplete line in buffer
        buffer = lines[lines.length - 1] ?? '';
      }

      // Process any remaining data
      if (buffer.trim()) {
        try {
          const data: OllamaStreamChunk = JSON.parse(buffer);
          onChunk(data.message.content, data.done);
        } catch (parseError) {
          console.warn('Failed to parse final Ollama chunk:', buffer);
        }
      }
    } catch (error) {
      if (error instanceof OllamaError) {
        throw error;
      }

      if (isFetchError(error)) {
        throw new OllamaError(
          `Failed to connect to Ollama service at ${this.baseUrl}`,
          'CONNECTION_ERROR'
        );
      }

      throw new OllamaError(`Ollama stream failed: ${getErrorMessage(error)}`, 'UNKNOWN_ERROR');
    }
  }

  /**
   * Generate a simple text completion (non-chat)
   * @param prompt Input prompt
   * @param options Generation options
   * @returns Generated text
   */
  async generate(prompt: string, options: OllamaOptions = {}): Promise<string> {
    try {
      const request = {
        model: this.model,
        prompt,
        stream: false,
        options: { ...this.defaultOptions, ...options },
      };

      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new OllamaError(
          `Ollama API error: ${response.status} ${response.statusText} - ${errorText}`,
          `HTTP_${response.status}`
        );
      }

      const result: any = await response.json();
      return result.response || '';
    } catch (error) {
      if (error instanceof OllamaError) {
        throw error;
      }

      throw new OllamaError(`Ollama generation failed: ${getErrorMessage(error)}`, 'UNKNOWN_ERROR');
    }
  }

  /**
   * Check if Ollama service is healthy
   * @returns true if service is reachable and healthy
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
      });
      return response.ok;
    } catch (error) {
      console.error('Ollama health check failed:', getErrorMessage(error));
      return false;
    }
  }

  /**
   * List available models
   * @returns Array of model information
   */
  async listModels(): Promise<OllamaModelInfo[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
      });

      if (!response.ok) {
        throw new OllamaError('Failed to fetch models', 'LIST_MODELS_ERROR');
      }

      const data: any = await response.json();
      return data.models || [];
    } catch (error) {
      console.warn('Could not fetch Ollama models:', getErrorMessage(error));
      return [];
    }
  }

  /**
   * Pull a model from Ollama registry
   * @param modelName Name of the model to pull
   * @param onProgress Optional progress callback
   */
  async pullModel(
    modelName: string,
    onProgress?: (status: string, progress: number) => void
  ): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/api/pull`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: modelName }),
      });

      if (!response.ok) {
        throw new OllamaError('Failed to pull model', 'PULL_MODEL_ERROR');
      }

      // Process streaming progress updates
      const reader = response.body;
      if (!reader) {
        throw new OllamaError('No response body', 'NO_BODY');
      }

      let buffer = '';

      for await (const chunk of reader) {
        buffer += chunk.toString();
        const lines = buffer.split('\n');

        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i]?.trim();
          if (line && onProgress) {
            try {
              const data: any = JSON.parse(line);
              const progress = data.completed && data.total
                ? (data.completed / data.total) * 100
                : 0;
              onProgress(data.status, progress);
            } catch (parseError) {
              // Ignore parse errors in progress updates
            }
          }
        }

        buffer = lines[lines.length - 1] ?? '';
      }
    } catch (error) {
      throw new OllamaError(`Failed to pull model: ${getErrorMessage(error)}`, 'PULL_MODEL_ERROR');
    }
  }

  /**
   * Check if a specific model is available
   * @param modelName Name of the model
   * @returns true if model exists locally
   */
  async hasModel(modelName: string): Promise<boolean> {
    try {
      const models = await this.listModels();
      return models.some((m) => m.name === modelName || m.name.startsWith(modelName + ':'));
    } catch (error) {
      return false;
    }
  }
}

// Export singleton instance
let ollamaInstance: OllamaClient | null = null;

export function getOllamaClient(): OllamaClient {
  if (!ollamaInstance) {
    ollamaInstance = new OllamaClient();
  }
  return ollamaInstance;
}
