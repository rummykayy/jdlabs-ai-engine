/**
 * Local AI Manager
 * Orchestrates Whisper (STT) + Ollama (LLM) + TTS (Kani-TTS) pipeline
 * Implements the same interface as GeminiLiveManager for easy swapping
 */

import {
  AIManager,
  AIResponseMessage,
  LocalAISession,
  LocalAISettings,
  LocalAIConfig,
  LocalAIError,
  OllamaMessage,
} from '../types/localAI.js';
import { WhisperClient, getWhisperClient } from './aiClients/whisperClient.js';
import { OllamaClient, getOllamaClient } from './aiClients/ollamaClient.js';
import { TtsService, getTtsService } from './ttsService.js';

export class LocalAiManager implements AIManager {
  private static instance: LocalAiManager | null = null;

  private whisper: WhisperClient;
  private ollama: OllamaClient;
  private tts: TtsService;

  private sessions: Map<string, LocalAISession>;
  private config: LocalAIConfig;
  private audioBufferTimeouts: Map<string, NodeJS.Timeout>;

  private constructor() {
    this.whisper = getWhisperClient();
    this.ollama = getOllamaClient();
    this.tts = getTtsService();

    this.sessions = new Map();
    this.audioBufferTimeouts = new Map();

    this.config = {
      ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
      whisperUrl: process.env.WHISPER_URL || 'http://localhost:9000',
      ttsEngine: process.env.TTS_ENGINE || 'kani',
      defaultModel: process.env.OLLAMA_MODEL || 'gemma2:2b-instruct-q4',
      maxConversationLength: 20, // Keep last 20 messages
      audioBufferTimeout: 1500, // 1.5 seconds of silence before processing
      healthCheckInterval: 60000, // Check service health every minute
    };

    console.log('✅ LocalAiManager initialized with config:', this.config);
  }

  public static getInstance(): LocalAiManager {
    if (!LocalAiManager.instance) {
      LocalAiManager.instance = new LocalAiManager();
    }
    return LocalAiManager.instance;
  }

  /**
   * Connect and initialize a new session
   */
  async connect(
    sessionId: string,
    settings: any,
    onMessage: (data: AIResponseMessage) => void,
    onError: (error: Error) => void
  ): Promise<void> {
    try {
      console.log(`[LocalAI] Connecting session ${sessionId}`, settings);

      // Check service health
      const healthy = await this.checkHealth();
      if (!healthy.overall) {
        throw new LocalAIError(
          'One or more AI services are unavailable',
          'general',
          'SERVICE_UNAVAILABLE'
        );
      }

      // Extract settings
      const localSettings: LocalAISettings = {
        model: settings.model || this.config.defaultModel,
        voice: settings.voicePreference || 'default',
        temperature: 0.7,
        maxTokens: 2048,
        systemPrompt: this.buildSystemPrompt(settings),
        position: settings.position,
        difficulty: settings.difficulty,
        mode: settings.mode,
      };

      // Initialize conversation with system prompt
      const conversationHistory: OllamaMessage[] = [
        {
          role: 'system',
          content: localSettings.systemPrompt || 'You are a helpful AI assistant.',
        },
      ];

      // Create session
      const session: LocalAISession = {
        sessionId,
        conversationHistory,
        audioBuffer: [],
        settings: localSettings,
        status: 'idle',
        lastActivity: new Date(),
        onMessage,
        onError,
      };

      this.sessions.set(sessionId, session);

      // Send connection success
      onMessage({
        type: 'status',
        sessionId,
        data: { status: 'connected', backend: 'local' },
      });

      console.log(`✅ [LocalAI] Session ${sessionId} connected`);
    } catch (error) {
      console.error(`❌ [LocalAI] Connection failed for ${sessionId}:`, error);
      onError(error as Error);
      throw error;
    }
  }

  /**
   * Process audio chunk (buffer until turn complete)
   */
  async sendAudio(
    sessionId: string,
    audioBuffer: Buffer,
    _encoding: string,
    turnComplete: boolean
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new LocalAIError('Session not found', 'general', 'SESSION_NOT_FOUND');
    }

    try {
      session.status = 'listening';
      session.lastActivity = new Date();

      // Buffer audio chunk
      session.audioBuffer.push(audioBuffer);

      // Reduced logging - only log every 20th chunk
      if (session.audioBuffer.length === 1 || session.audioBuffer.length % 20 === 0) {
        console.log(
          `[LocalAI] ${sessionId} - Buffered ${session.audioBuffer.length} audio chunks (latest: ${audioBuffer.length} bytes)`
        );
      }

      // If turn complete, process immediately
      if (turnComplete) {
        await this.processAudioBuffer(sessionId);
      } else {
        // Otherwise, set timeout to process after silence
        this.resetAudioBufferTimeout(sessionId);
      }
    } catch (error) {
      console.error(`❌ [LocalAI] Audio processing error for ${sessionId}:`, error);
      session.status = 'error';
      throw error;
    }
  }

  /**
   * Process text message
   */
  async sendText(sessionId: string, text: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new LocalAIError('Session not found', 'general', 'SESSION_NOT_FOUND');
    }

    try {
      console.log(`[LocalAI] ${sessionId} - Processing text: "${text}"`);

      session.status = 'processing';
      session.lastActivity = new Date();

      // Add user message to history
      session.conversationHistory.push({
        role: 'user',
        content: text,
      });

      // Get response from Ollama
      const response = await this.ollama.chat(session.conversationHistory, {
        temperature: session.settings.temperature,
        num_predict: session.settings.maxTokens,
      });

      const assistantMessage = response.message.content;

      // Add assistant response to history
      session.conversationHistory.push({
        role: 'assistant',
        content: assistantMessage,
      });

      // Trim conversation history if too long
      this.trimConversationHistory(session);

      // Synthesize response to audio using TTS service
      session.status = 'speaking';
      const audioResponse = await this.tts.synthesize(assistantMessage);

      // Convert to base64 for WebSocket transmission
      const base64Audio = audioResponse.audio.toString('base64');
      const audioFormat = {
        encoding: 'base64',
        sampleRate: audioResponse.sample_rate,
        channels: 1,
        mimeType: 'audio/wav',
      };

      // Send response (this callback is passed from aiSocketServer)
      const onMessage = this.getSessionCallback(sessionId);
      if (onMessage) {
        // Send text response
        onMessage({
          type: 'text',
          sessionId,
          content: assistantMessage,
          turnComplete: false,
        });

        // Send audio response
        onMessage({
          type: 'audio',
          sessionId,
          audioData: {
            data: base64Audio,
            mimeType: audioFormat.mimeType,
          },
          turnComplete: true,
        });
      }

      session.status = 'idle';
      console.log(`✅ [LocalAI] ${sessionId} - Response sent`);
    } catch (error) {
      console.error(`❌ [LocalAI] Text processing error for ${sessionId}:`, error);
      session.status = 'error';
      throw error;
    }
  }

  /**
   * Signal turn complete (process buffered audio)
   */
  async completeTurn(sessionId: string): Promise<void> {
    await this.processAudioBuffer(sessionId);
  }

  /**
   * Disconnect session
   */
  disconnect(sessionId: string): void {
    console.log(`[LocalAI] Disconnecting session ${sessionId}`);

    // Clear audio buffer timeout
    const timeout = this.audioBufferTimeouts.get(sessionId);
    if (timeout) {
      clearTimeout(timeout);
      this.audioBufferTimeouts.delete(sessionId);
    }

    // Remove session
    this.sessions.delete(sessionId);
    console.log(`✅ [LocalAI] Session ${sessionId} disconnected`);
  }

  /**
   * Get session status
   */
  getStatus(sessionId: string): 'connected' | 'reconnecting' | 'disconnected' {
    return this.sessions.has(sessionId) ? 'connected' : 'disconnected';
  }

  // ============================================
  // Private Helper Methods
  // ============================================

  /**
   * Process buffered audio chunks
   */
  private async processAudioBuffer(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || session.audioBuffer.length === 0) {
      return;
    }

    try {
      console.log(`[LocalAI] ${sessionId} - Processing ${session.audioBuffer.length} audio chunks`);

      session.status = 'processing';

      // Clear timeout
      const timeout = this.audioBufferTimeouts.get(sessionId);
      if (timeout) {
        clearTimeout(timeout);
        this.audioBufferTimeouts.delete(sessionId);
      }

      // Combine all audio chunks
      const combinedAudio = Buffer.concat(session.audioBuffer);
      session.audioBuffer = []; // Clear buffer

      // Transcribe with Whisper
      const transcription = await this.whisper.transcribeWithRetry(combinedAudio, {
        language: 'en',
        task: 'transcribe',
      });

      const transcribedText = transcription.text.trim();

      if (!transcribedText) {
        console.log(`[LocalAI] ${sessionId} - Empty transcription, ignoring`);
        session.status = 'idle';
        return;
      }

      console.log(`[LocalAI] ${sessionId} - Transcribed: "${transcribedText}"`);

      // Process as text message
      await this.sendText(sessionId, transcribedText);
    } catch (error) {
      console.error(`❌ [LocalAI] Audio buffer processing error for ${sessionId}:`, error);
      session.status = 'error';
      session.audioBuffer = []; // Clear buffer on error
      throw error;
    }
  }

  /**
   * Reset audio buffer timeout
   */
  private resetAudioBufferTimeout(sessionId: string): void {
    // Clear existing timeout
    const existingTimeout = this.audioBufferTimeouts.get(sessionId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Set new timeout
    const timeout = setTimeout(() => {
      console.log(`[LocalAI] ${sessionId} - Audio buffer timeout, processing...`);
      this.processAudioBuffer(sessionId).catch((error) => {
        console.error(`❌ [LocalAI] Timeout processing error:`, error);
      });
    }, this.config.audioBufferTimeout);

    this.audioBufferTimeouts.set(sessionId, timeout);
  }

  /**
   * Build system prompt based on interview settings
   */
  private buildSystemPrompt(settings: any): string {
    const mode = settings.mode || 'Audio Interview';
    const position = settings.position || 'Software Engineer';
    const difficulty = settings.difficulty || 'Medium';

    return `You are an experienced technical interviewer conducting a ${difficulty.toLowerCase()} difficulty ${mode.toLowerCase()} for a ${position} position.

Your role:
- Ask relevant technical questions appropriate for the ${position} role
- Evaluate the candidate's responses
- Provide constructive feedback when appropriate
- Be professional, encouraging, and thorough
- Adapt your questions based on the candidate's answers
- Keep responses concise and conversational

Interview difficulty: ${difficulty}
Target position: ${position}
Interview mode: ${mode}

Begin the interview with a brief introduction and your first question.`;
  }

  /**
   * Trim conversation history to prevent context overflow
   */
  private trimConversationHistory(session: LocalAISession): void {
    const maxLength = this.config.maxConversationLength;

    if (session.conversationHistory.length > maxLength) {
      // Keep system prompt (first message) and most recent messages
      const systemPrompt = session.conversationHistory[0] ?? { role: 'system' as const, content: 'You are a helpful AI assistant.' };
      const recentMessages = session.conversationHistory.slice(-(maxLength - 1));

      session.conversationHistory = [systemPrompt, ...recentMessages];

      console.log(`[LocalAI] ${session.sessionId} - Trimmed conversation history to ${maxLength} messages`);
    }
  }

  /**
   * Get session callback (stored when session is created)
   */
  private getSessionCallback(sessionId: string): ((data: AIResponseMessage) => void) | null {
    const session = this.sessions.get(sessionId);
    return session?.onMessage || null;
  }

  /**
   * Check health of all services
   */
  private async checkHealth(): Promise<{ overall: boolean; services: any[] }> {
    const checks = await Promise.allSettled([
      this.ollama.healthCheck(),
      this.whisper.healthCheck(),
      this.tts.healthCheck(),
    ]);

    const services = [
      { name: 'ollama', healthy: checks[0].status === 'fulfilled' && checks[0].value },
      { name: 'whisper', healthy: checks[1].status === 'fulfilled' && checks[1].value },
      { name: 'tts', healthy: checks[2].status === 'fulfilled' && checks[2].value },
    ];

    const overall = services.every((s) => s.healthy);

    if (!overall) {
      const unhealthyServices = services.filter(s => !s.healthy).map(s => s.name);
      console.warn(`⚠️  [LocalAI] Service health check failed. Unhealthy services: ${unhealthyServices.join(', ')}`);
      console.warn(`   Details:`, services);
    } else {
      console.log('✅ [LocalAI] All services healthy');
    }

    return { overall, services };
  }

  /**
   * Get session info (for debugging)
   */
  public getSessionInfo(sessionId: string): LocalAISession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get all active sessions
   */
  public getActiveSessions(): string[] {
    return Array.from(this.sessions.keys());
  }
}

// Export singleton getter
export function getLocalAiManager(): LocalAiManager {
  return LocalAiManager.getInstance();
}
