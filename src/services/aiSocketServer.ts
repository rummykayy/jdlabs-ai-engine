import WebSocket, { WebSocketServer, Data } from 'ws';
import { Server } from 'http';
import { GeminiService } from './geminiService.js';
import { validateAudioChunk, transcodeWithFFmpeg } from './audioUtils.js';
import { validateToken, parseAuthHeader } from './authService.js';
import { createAIManager, validateAIBackendConfig, getBackendInfo } from './aiServiceFactory.js';
import { AIManager } from '../types/localAI.js';
import {
    GeminiLiveWebSocket,
    WSClientMessage,
    WSServerResponse,
    GeminiLiveMessage
} from '../types/websocket.js';

// Constants for rate limiting
const RATE_LIMIT = {
    MAX_TEXT_REQUESTS: 30,    // Maximum text/control requests per window
    MAX_AUDIO_CHUNKS: 200,    // Maximum audio chunks per window (allow ~3 chunks/sec)
    WINDOW_MS: 60000,         // 1 minute window
    MAX_CHUNK_SIZE: 5 * 1024 * 1024 // 5MB
};

// Interview settings interface
interface InterviewSettings {
    mode: string;
    difficulty: string;
    position: string;
    jobDescription?: string;
    voicePreference?: string;
    model?: string;
}

// Interview session interface
interface InterviewSession {
    client: WebSocket;
    mode: string;
    needsAudio: boolean;
    settings?: InterviewSettings;
}

// Error codes and messages mapping
interface ErrorInfo {
    message: string;
    recoverable: boolean;
}

const ERROR_TYPES: Record<string, ErrorInfo> = {
    MODEL_NOT_FOUND: {
        message: 'The specified Gemini Live model is not available. Please check the model name.',
        recoverable: true
    },
    UNAUTHORIZED: {
        message: 'Invalid or expired OAuth token. Please refresh your authentication.',
        recoverable: false
    },
    FORBIDDEN: {
        message: 'Access denied. Please check your permissions and OAuth token scope.',
        recoverable: false
    },
    CONNECTION_ERROR: {
        message: 'Failed to connect to Gemini Live. Please try again.',
        recoverable: true
    },
    RATE_LIMIT_EXCEEDED: {
        message: 'Too many requests. Please wait before sending more.',
        recoverable: true
    },
    INVALID_AUDIO: {
        message: 'Invalid audio chunk format or size',
        recoverable: true
    },
    MESSAGE_PROCESSING_ERROR: {
        message: 'Failed to process message',
        recoverable: true
    }
};

export class AISocketServer {
    private readonly wss: WebSocketServer;
    private readonly gemini: GeminiService;
    private readonly aiManager: AIManager;
    private readonly activeSessions: Map<string, InterviewSession>;
    private readonly sessionLastActivity: Map<string, number>;
    private readonly rateLimits: Map<string, { textCount: number; audioCount: number; resetTime: number }>;

    constructor(server: Server) {
        // Validate AI backend configuration
        validateAIBackendConfig();
        const backendInfo = getBackendInfo();
        console.log('✅ AI Backend Configuration:', backendInfo);

        // Initialize managers
        this.gemini = new GeminiService();
        this.aiManager = createAIManager();

        // Initialize session tracking
        this.activeSessions = new Map();
        this.sessionLastActivity = new Map();
        this.rateLimits = new Map();

        // Initialize WebSocket server with interview endpoint
        const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',');

        this.wss = new WebSocketServer({
            server,
            path: '/ai/interview',
            verifyClient: ({ origin, req }, cb) => {
                // Allow connections without origin (e.g., from same origin) or check allowed origins
                if (origin && !allowedOrigins.includes(origin)) {
                    console.warn(`❌ WebSocket connection rejected: Origin "${origin}" not in allowed list:`, allowedOrigins);
                    cb(false, 403, 'Origin not allowed');
                    return;
                }

                try {
                    const authHeader = req.headers['authorization'];
                    const token = parseAuthHeader(authHeader);

                    if (token) {
                        const payload = validateToken(token);
                        if (!payload) {
                            cb(false, 401, 'Invalid authorization token');
                            return;
                        }
                        (req as any).user = payload;
                    }

                    cb(true);
                } catch (err) {
                    console.error('Error during WS verifyClient:', err);
                    cb(false, 500, 'Internal server error');
                }
            }
        });

        // Start listening for connections
        this.wss.on('connection', this.handleNewConnection);
        console.log('✅ AI WebSocket Server initialized');
    }

    private sendError(client: WebSocket, sessionId: string, code: string) {
        const error = ERROR_TYPES[code] || ERROR_TYPES.MESSAGE_PROCESSING_ERROR;
        client.send(JSON.stringify({
            type: 'error',
            sessionId,
            code,
            message: error.message,
            recoverable: error.recoverable
        }));
    }

    private checkRateLimit = (sessionId: string, messageType: 'audio' | 'text'): boolean => {
        const now = Date.now();
        const limit = this.rateLimits.get(sessionId);

        if (!limit || now > limit.resetTime) {
            this.rateLimits.set(sessionId, {
                textCount: messageType === 'text' ? 1 : 0,
                audioCount: messageType === 'audio' ? 1 : 0,
                resetTime: now + RATE_LIMIT.WINDOW_MS
            });
            return true;
        }

        if (messageType === 'audio') {
            if (limit.audioCount >= RATE_LIMIT.MAX_AUDIO_CHUNKS) {
                return false;
            }
            limit.audioCount++;
        } else {
            if (limit.textCount >= RATE_LIMIT.MAX_TEXT_REQUESTS) {
                return false;
            }
            limit.textCount++;
        }

        return true;
    }

    private buildSystemPrompt(settings: InterviewSettings): string {
        return `You are an expert AI interviewer conducting a ${settings.difficulty} level interview for a ${settings.position} position.

Your role:
1. Conduct a professional, comprehensive interview with 5-7 questions
2. Ask follow-up questions based on the candidate's responses
3. Adapt difficulty based on their answers
4. Evaluate technical skills, problem-solving, and communication
5. Keep each response concise (2-3 sentences max)
6. After each answer, provide a brief acknowledgment and ask your next question

${settings.jobDescription ? `Job Description: ${settings.jobDescription}` : ''}

Start by briefly introducing yourself as the AI interviewer and ask your first ${settings.difficulty} level question for the ${settings.position} role. Be professional but friendly.`;
    }

    private handleNewConnection = async (client: WebSocket) => {
        const sessionId = Math.random().toString(36).substring(7);
        console.log(`🟢 New client connected (${sessionId})`);

        try {
            // Initialize session
            this.activeSessions.set(sessionId, {
                client,
                mode: 'text',
                needsAudio: false,
                settings: undefined
            });
            this.sessionLastActivity.set(sessionId, Date.now());

            // Set up event handlers
            client.on('message', (message) => this.handleClientMessage(sessionId, client, message));
            client.on('close', () => this.handleClientDisconnect(sessionId));
            client.on('error', (error) => this.handleClientError(sessionId, error));
        } catch (error) {
            console.error('Error setting up client session:', error);
            client.close();
        }
    }

    private handleClientMessage = async (sessionId: string, client: WebSocket, message: Data) => {
        const start = Date.now();
        this.sessionLastActivity.set(sessionId, start);

        try {
            const data = JSON.parse(message.toString()) as WSClientMessage;
            console.log('📨 Received message:', { type: data.type, sessionId });

            // Determine rate limit type (audio-chunk vs everything else)
            const rateLimitType = data.type === 'audio-chunk' ? 'audio' : 'text';

            if (!this.checkRateLimit(sessionId, rateLimitType)) {
                this.sendError(client, sessionId, 'RATE_LIMIT_EXCEEDED');
                return;
            }

            const session = this.activeSessions.get(sessionId);
            if (!session) {
                throw new Error('Session not found');
            }

            switch (data.type) {
                case 'start_interview':
                    await this.handleStartInterview(sessionId, session, data.settings as InterviewSettings);
                    break;
                case 'text':
                    await this.handleTextMessage(sessionId, session, data);
                    break;
                case 'audio-chunk':
                    await this.handleAudioChunk(sessionId, session, data);
                    break;
                default:
                    throw new Error(`Unknown message type: ${data.type}`);
            }
        } catch (error) {
            console.error('Error processing message:', error);
            this.sendError(client, sessionId, 'MESSAGE_PROCESSING_ERROR');
        }
    }

    private async handleStartInterview(sessionId: string, session: InterviewSession, settings: InterviewSettings) {
        console.log('🚀 Starting new interview session:', {
            mode: settings.mode,
            difficulty: settings.difficulty,
            position: settings.position,
            jobDescription: settings.jobDescription,
            model: settings.model
        });

        // Update session settings
        session.mode = settings.mode;
        // Only Chat Interview should use TEXT mode, all others use AUDIO
        session.needsAudio = settings.mode !== 'Chat Interview';
        session.settings = settings;

        const systemPrompt = this.buildSystemPrompt(settings);

        try {
            // Connect to Gemini Live with proper settings
            await this.aiManager.connect(
                sessionId,
                {
                    model: settings.model,
                    voiceName: settings.voicePreference || 'Puck',
                    responseModalities: session.needsAudio ? ['AUDIO'] : ['TEXT']
                },
                msg => this.handleGeminiLiveMessage(sessionId, session.client, msg),
                error => {
                    const code = error.message.includes('404') ? 'MODEL_NOT_FOUND' :
                        error.message.includes('401') ? 'UNAUTHORIZED' :
                            error.message.includes('403') ? 'FORBIDDEN' : 'CONNECTION_ERROR';
                    this.sendError(session.client, sessionId, code);
                }
            );

            // Send initial system prompt using the correct API format
            await this.aiManager.sendText(sessionId, systemPrompt);

            // Notify client that interview is ready
            session.client.send(JSON.stringify({
                type: 'interview_ready',
                sessionId,
                message: 'Interview session initialized successfully'
            }));
        } catch (error) {
            console.error('Failed to initialize Gemini Live session:', error);
            this.sendError(session.client, sessionId, 'CONNECTION_ERROR');
        }
    }

    private async handleCompleteTurn(sessionId: string, session: InterviewSession) {
        console.log('✋ Completing turn for session:', sessionId);
        try {
            await this.aiManager.completeTurn(sessionId);
        } catch (error) {
            console.error('Failed to complete turn:', error);
            this.sendError(session.client, sessionId, 'MESSAGE_PROCESSING_ERROR');
        }
    }

    private async handleTextMessage(sessionId: string, session: InterviewSession, data: WSClientMessage) {
        console.log('💬 Processing text message:', { sessionId, contentLength: data.content?.length });

        if (!data.content) {
            this.sendError(session.client, sessionId, 'INVALID_MESSAGE');
            return;
        }

        try {
            // Send text to Gemini Live
            await this.aiManager.sendText(sessionId, data.content);
        } catch (error) {
            console.error('Failed to send text message:', error);
            this.sendError(session.client, sessionId, 'MESSAGE_PROCESSING_ERROR');
        }
    }

    private async handleAudioChunk(sessionId: string, session: InterviewSession, data: WSClientMessage) {
        if (!data.data || !data.encoding) {
            this.sendError(session.client, sessionId, 'INVALID_AUDIO');
            return;
        }

        console.log('🎤 Processing audio chunk:', {
            sessionId,
            seq: data.seq,
            encoding: data.encoding,
            sampleRate: data.sampleRate
        });

        if (!validateAudioChunk({
            data: typeof data.data === 'string' ? data.data : '',
            sampleRate: data.sampleRate
        }, {
            maxSizeBytes: RATE_LIMIT.MAX_CHUNK_SIZE
        })) {
            this.sendError(session.client, sessionId, 'INVALID_AUDIO');
            return;
        }

        try {
            // Get audio buffer (convert from base64 if needed)
            const audioBuffer = typeof data.data === 'string'
                ? Buffer.from(data.data, 'base64')
                : Buffer.from(data.data as ArrayBuffer);

            // Send to AI manager
            // Note: encoding should be 'webm', 'wav', etc.
            const encoding = data.encoding || 'webm';
            const turnComplete = data.turnComplete !== undefined ? data.turnComplete : false;

            await this.aiManager.sendAudio(sessionId, audioBuffer, encoding, turnComplete);

            console.log(`✅ [${sessionId}] Forwarded ${encoding} audio chunk to AI (${audioBuffer.length} bytes)`);
        } catch (error) {
            console.error('Failed to process audio:', error);
            this.sendError(session.client, sessionId, 'MESSAGE_PROCESSING_ERROR');
        }
    }

    private handleGeminiLiveMessage(sessionId: string, client: WebSocket, msg: any) {
        // Handle messages from the new Gemini Live API format
        if (msg.type === 'audio') {
            // Handle audio response - send in format expected by frontend
            client.send(JSON.stringify({
                type: 'audio',
                sessionId,
                content: '', // Keep for backwards compatibility
                audioData: {
                    data: msg.data, // base64-encoded PCM audio
                    mimeType: msg.mimeType // e.g., "audio/pcm;rate=24000"
                },
                turnComplete: msg.turnComplete
            }));
            console.log(`🔊 [${sessionId}] Forwarded audio chunk to client (${msg.mimeType})`);
        } else if (msg.type === 'text') {
            // Handle text response
            client.send(JSON.stringify({
                type: 'text',
                sessionId,
                content: msg.text,
                turnComplete: msg.turnComplete
            }));
        } else {
            // Log unknown message types for debugging
            console.log(`📨 [${sessionId}] Received unknown message type:`, msg.type);
        }
    }

    private handleClientDisconnect = (sessionId: string) => {
        console.log(`🔴 Client disconnected (${sessionId})`);

        // Clean up session resources
        this.activeSessions.delete(sessionId);
        this.sessionLastActivity.delete(sessionId);
        this.rateLimits.delete(sessionId);

        // Disconnect from Gemini Live
        this.aiManager.disconnect(sessionId);
    }

    private handleClientError = (sessionId: string, error: Error) => {
        console.error(`❌ Client error for session ${sessionId}:`, error);
        this.handleClientDisconnect(sessionId);
    }
}