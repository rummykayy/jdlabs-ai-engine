/**
 * Type definitions for Local AI Stack
 * (Ollama + Whisper + TTS)
 */

// ============================================
// Whisper Types (Speech-to-Text)
// ============================================

export interface WhisperTranscriptionRequest {
  audio_file: Buffer;
  task?: 'transcribe' | 'translate';
  language?: string;
  initial_prompt?: string;
  vad_filter?: boolean;
  word_timestamps?: boolean;
}

export interface WhisperTranscriptionResponse {
  text: string;
  language?: string;
  segments?: WhisperSegment[];
}

export interface WhisperSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  confidence?: number;
  words?: WhisperWord[];
}

export interface WhisperWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
}

// ============================================
// Ollama Types (LLM)
// ============================================

export interface OllamaChatRequest {
  model: string;
  messages: OllamaMessage[];
  stream?: boolean;
  options?: OllamaOptions;
}

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OllamaOptions {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  num_predict?: number;
  stop?: string[];
  seed?: number;
}

export interface OllamaChatResponse {
  model: string;
  message: OllamaMessage;
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

export interface OllamaStreamChunk {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
  };
  done: boolean;
}

export interface OllamaModelInfo {
  name: string;
  size: number;
  digest: string;
  modified_at: string;
}

// ============================================
// TTS Types (Text-to-Speech) - Legacy for backwards compatibility
// ============================================

// Note: Piper types kept for legacy support only
// New code should use TtsService from ttsService.ts
export interface PiperSynthesisRequest {
  text: string;
  voice?: string;
  speaker?: number;
  length_scale?: number;
  noise_scale?: number;
  noise_w?: number;
}

export interface PiperSynthesisResponse {
  audio: Buffer;
  sample_rate: number;
  duration?: number;
}

export interface PiperVoice {
  name: string;
  language: string;
  quality: 'low' | 'medium' | 'high';
  speakers?: number;
}

// ============================================
// Local AI Manager Types
// ============================================

export interface LocalAISession {
  sessionId: string;
  conversationHistory: OllamaMessage[];
  audioBuffer: Buffer[];
  settings: LocalAISettings;
  status: 'idle' | 'listening' | 'processing' | 'speaking' | 'error';
  lastActivity: Date;
  onMessage?: (data: AIResponseMessage) => void;
  onError?: (error: Error) => void;
}

export interface LocalAISettings {
  model: string;
  voice: string;
  temperature: number;
  maxTokens: number;
  systemPrompt?: string;
  position?: string;
  difficulty?: string;
  mode?: string;
}

export interface AudioChunk {
  data: Buffer;
  encoding: string;
  sampleRate: number;
  seq: number;
}

// ============================================
// AI Manager Interface (shared between Gemini & Local)
// ============================================

export interface AIManager {
  connect(
    sessionId: string,
    settings: any,
    onMessage: (data: AIResponseMessage) => void,
    onError: (error: Error) => void
  ): Promise<void>;

  sendAudio(
    sessionId: string,
    audioBuffer: Buffer,
    encoding: string,
    turnComplete: boolean
  ): Promise<void>;

  sendText(
    sessionId: string,
    text: string
  ): Promise<void>;

  completeTurn(sessionId: string): Promise<void>;

  disconnect(sessionId: string): void;

  getStatus(sessionId: string): 'connected' | 'reconnecting' | 'disconnected';
}

export interface AIResponseMessage {
  type: 'audio' | 'text' | 'error' | 'status';
  sessionId: string;
  data?: any;
  audioData?: {
    data: string; // base64
    mimeType: string;
  };
  content?: string;
  turnComplete?: boolean;
  error?: string;
}

// ============================================
// Service Health Types
// ============================================

export interface ServiceHealth {
  service: 'ollama' | 'whisper' | 'piper';
  status: 'healthy' | 'unhealthy' | 'unknown';
  latency?: number;
  lastCheck: Date;
  error?: string;
}

export interface LocalAIHealthCheck {
  overall: 'healthy' | 'degraded' | 'unhealthy';
  services: ServiceHealth[];
  timestamp: Date;
}

// ============================================
// Configuration Types
// ============================================

export interface LocalAIConfig {
  ollamaUrl: string;
  whisperUrl: string;
  ttsEngine: string;
  defaultModel: string;
  maxConversationLength: number;
  audioBufferTimeout: number;
  healthCheckInterval: number;
}

// ============================================
// Error Types
// ============================================

export class LocalAIError extends Error {
  constructor(
    message: string,
    public service: 'ollama' | 'whisper' | 'piper' | 'general',
    public code?: string
  ) {
    super(message);
    this.name = 'LocalAIError';
  }
}

export class WhisperError extends LocalAIError {
  constructor(message: string, code?: string) {
    super(message, 'whisper', code);
    this.name = 'WhisperError';
  }
}

export class OllamaError extends LocalAIError {
  constructor(message: string, code?: string) {
    super(message, 'ollama', code);
    this.name = 'OllamaError';
  }
}

export class PiperError extends LocalAIError {
  constructor(message: string, code?: string) {
    super(message, 'piper', code);
    this.name = 'PiperError';
  }
}
