import WebSocket from 'ws';

// Gemini Multimodal Live API message types
interface GeminiSetupMessage {
    setup: {
        model: string;
        generation_config?: {
            response_modalities?: string[];
            speech_config?: {
                voice_config?: {
                    prebuilt_voice_config?: {
                        voice_name?: string;
                    }
                }
            }
        }
    }
}

interface GeminiClientContent {
    client_content: {
        turns: Array<{
            role: 'user';
            parts: Array<{
                text?: string;
                inline_data?: {
                    mime_type: string;
                    data: string;
                }
            }>;
        }>;
        turn_complete: boolean;
    }
}

interface GeminiServerContent {
    serverContent?: {
        modelTurn?: {
            parts?: Array<{
                text?: string;
                inlineData?: {
                    mimeType: string;
                    data: string;
                }
            }>;
        };
        turnComplete?: boolean;
    };
    setupComplete?: boolean;
}

export interface GeminiLiveWebSocket extends WebSocket {
    readyState: WebSocket['readyState'];
}

export class GeminiLiveManager {
    private static instance: GeminiLiveManager;
    private readonly connections: Map<string, GeminiLiveWebSocket>;
    private readonly connectionStatuses: Map<string, {
        status: 'connected' | 'reconnecting' | 'disconnected';
        lastHeartbeat: number;
        reconnectAttempts: number;
        setupComplete: boolean;
    }>;

    private constructor() {
        this.connections = new Map();
        this.connectionStatuses = new Map();
    }

    public static getInstance(): GeminiLiveManager {
        if (!GeminiLiveManager.instance) {
            GeminiLiveManager.instance = new GeminiLiveManager();
        }
        return GeminiLiveManager.instance;
    }

    /**
     * Send audio data to Gemini Live API (PCM format - legacy)
     */
    public async sendAudio(sessionId: string, audioBuffer: Buffer): Promise<void> {
        const ws = this.connections.get(sessionId);
        const status = this.connectionStatuses.get(sessionId);

        if (!ws || ws.readyState !== WebSocket.OPEN) {
            throw new Error('No active connection for session');
        }

        if (!status?.setupComplete) {
            console.warn(`⚠️ [${sessionId}] Setup not complete, queuing audio...`);
            // Wait a bit for setup to complete
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        const message: GeminiClientContent = {
            client_content: {
                turns: [{
                    role: 'user',
                    parts: [{
                        inline_data: {
                            mime_type: 'audio/pcm',
                            data: audioBuffer.toString('base64')
                        }
                    }]
                }],
                turn_complete: true
            }
        };

        ws.send(JSON.stringify(message));
        console.log(`🎤 [${sessionId}] Sent audio chunk (${audioBuffer.length} bytes)`);
    }

    /**
     * Send audio data directly to Gemini Live API with specified MIME type
     * Supports: audio/wav, audio/mp3, audio/aac, audio/ogg, audio/flac, audio/webm
     */
    public async sendAudioDirect(sessionId: string, base64Audio: string, mimeType: string, turnComplete: boolean = false): Promise<void> {
        const ws = this.connections.get(sessionId);
        const status = this.connectionStatuses.get(sessionId);

        if (!ws || ws.readyState !== WebSocket.OPEN) {
            throw new Error('No active connection for session');
        }

        if (!status?.setupComplete) {
            console.warn(`⚠️ [${sessionId}] Setup not complete, waiting...`);
            // Wait a bit for setup to complete
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        const message: GeminiClientContent = {
            client_content: {
                turns: [{
                    role: 'user',
                    parts: [{
                        inline_data: {
                            mime_type: mimeType,
                            data: base64Audio
                        }
                    }]
                }],
                turn_complete: turnComplete // Allow caller to specify when turn is complete
            }
        };

        ws.send(JSON.stringify(message));
        console.log(`🎤 [${sessionId}] Sent ${mimeType} audio chunk (${base64Audio.length} chars base64)`);
    }

    /**
     * Send text message to Gemini Live API
     */
    public async sendText(sessionId: string, text: string): Promise<void> {
        const ws = this.connections.get(sessionId);
        const status = this.connectionStatuses.get(sessionId);

        if (!ws || ws.readyState !== WebSocket.OPEN) {
            throw new Error('No active connection for session');
        }

        if (!status?.setupComplete) {
            console.warn(`⚠️ [${sessionId}] Setup not complete, waiting...`);
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        const message: GeminiClientContent = {
            client_content: {
                turns: [{
                    role: 'user',
                    parts: [{
                        text: text
                    }]
                }],
                turn_complete: true
            }
        };

        ws.send(JSON.stringify(message));
        console.log(`💬 [${sessionId}] Sent text message`);
    }

    private setupWebSocketHandlers(
        ws: GeminiLiveWebSocket,
        sessionId: string,
        onMessage: (msg: any) => void,
        onError: (error: Error) => void,
        onSetupComplete?: () => void
    ) {
        ws.on('message', (data: WebSocket.Data) => {
            try {
                const msg = JSON.parse(data.toString()) as GeminiServerContent;

                // Check for setup completion
                if (msg.setupComplete) {
                    console.log(`✅ [${sessionId}] Setup completed`);
                    const status = this.connectionStatuses.get(sessionId);
                    if (status) {
                        this.connectionStatuses.set(sessionId, {
                            ...status,
                            setupComplete: true
                        });
                    // Call the setup complete callback
                    if (onSetupComplete) {
                        onSetupComplete();
                    }
                    }
                    return;
                }

                // Process server content
                if (msg.serverContent?.modelTurn?.parts) {
                    for (const part of msg.serverContent.modelTurn.parts) {
                        if (part.text) {
                            console.log(`📝 [${sessionId}] Received text:`, part.text.substring(0, 50));
                            onMessage({
                                type: 'text',
                                text: part.text,
                                turnComplete: msg.serverContent.turnComplete
                            });
                        } else if (part.inlineData) {
                            console.log(`🔊 [${sessionId}] Received audio (${part.inlineData.mimeType})`);
                            onMessage({
                                type: 'audio',
                                mimeType: part.inlineData.mimeType,
                                data: part.inlineData.data,
                                turnComplete: msg.serverContent.turnComplete
                            });
                        }
                    }
                } else {
                    // Log unknown message types for debugging
                    console.log(`📨 [${sessionId}] Received message:`, JSON.stringify(msg).substring(0, 100));
                }
            } catch (err) {
                console.error(`❌ [${sessionId}] Error parsing message:`, err);
                onError(new Error('Failed to process AI response'));
            }
        });

        ws.on('error', (error: Error) => {
            console.error(`❌ [${sessionId}] Gemini Live error:`, error.message);
            onError(error);
        });

        ws.on('close', (code: number, reason: Buffer) => {
            console.log(`🔌 [${sessionId}] Connection closed: ${code} ${reason.toString()}`);
            this.connectionStatuses.delete(sessionId);
            this.connections.delete(sessionId);
        });
    }

    /**
     * Connect to Gemini Multimodal Live API
     */
    public async connect(
        sessionId: string,
        settings: {
            model?: string;
            voiceName?: string;
            responseModalities?: string[];
        },
        onMessage: (msg: any) => void,
        onError: (error: Error) => void,
        onSetupComplete?: () => void
    ): Promise<GeminiLiveWebSocket> {
        // Check if already connected
        const existing = this.connections.get(sessionId);
        if (existing && existing.readyState === WebSocket.OPEN) {
            console.log(`♻️ [${sessionId}] Reusing existing connection`);
            return existing;
        }

        try {
            console.log(`🎙️ [${sessionId}] Initializing Gemini Live connection...`);

            const GEMINI_WS_BASE_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
            const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

            if (!apiKey) {
                throw new Error('GEMINI_API_KEY not found in environment variables');
            }

            const wsUrl = `${GEMINI_WS_BASE_URL}?key=${apiKey}`;
            console.log(`🔗 [${sessionId}] Connecting to Gemini Live API...`);

            const ws = new WebSocket(wsUrl) as GeminiLiveWebSocket;

            this.setupWebSocketHandlers(ws, sessionId, onMessage, onError, onSetupComplete);

            // Wait for connection to open
            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Connection timeout after 10 seconds'));
                }, 10000);

                ws.once('open', () => {
                    clearTimeout(timeout);
                    console.log(`✅ [${sessionId}] WebSocket connection opened`);

                    // Initialize connection status
                    this.connectionStatuses.set(sessionId, {
                        status: 'connected',
                        lastHeartbeat: Date.now(),
                        reconnectAttempts: 0,
                        setupComplete: false
                    });

                    // Send setup message immediately after connection
                    // Use models/gemini-2.0-flash-exp or models/gemini-2.5-flash-native-audio-latest (valid models as of Nov 2024)
                    const modelName = settings.model && settings.model.startsWith('models/')
                        ? settings.model
                        : process.env.GEMINI_LIVE_MODEL || 'models/gemini-2.5-flash-native-audio-latest';

                    const responseModalities = settings.responseModalities || ['AUDIO'];
                    const isAudioMode = responseModalities.includes('AUDIO');

                    // Build generation config - only include speech_config for AUDIO mode
                    const generationConfig: any = {
                        response_modalities: responseModalities
                    };

                    if (isAudioMode) {
                        generationConfig.speech_config = {
                            voice_config: {
                                prebuilt_voice_config: {
                                    voice_name: settings.voiceName || 'Puck'
                                }
                            }
                        };
                    }

                    const setupMessage = {
                        setup: {
                            model: modelName,
                            generation_config: generationConfig
                        }
                    };

                    try {
                        ws.send(JSON.stringify(setupMessage));
                        const logConfig: any = {
                            model: setupMessage.setup.model,
                            modalities: responseModalities
                        };
                        if (isAudioMode) {
                            logConfig.voice = generationConfig.speech_config?.voice_config?.prebuilt_voice_config?.voice_name;
                        }
                        console.log(`📝 [${sessionId}] Sent setup configuration:`, logConfig);
                    } catch (error) {
                        console.error(`❌ [${sessionId}] Failed to send setup:`, error);
                        reject(error);
                        return;
                    }

                    resolve();
                });

                ws.once('error', (error) => {
                    clearTimeout(timeout);
                    console.error(`❌ [${sessionId}] Connection error:`, error);
                    reject(error);
                });
            });

            this.connections.set(sessionId, ws);
            return ws;

        } catch (error) {
            console.error(`❌ [${sessionId}] Failed to connect:`, error);
            throw new Error('Failed to initialize Gemini Live connection');
        }
    }

    /**
     * Disconnect and cleanup session
     */
    public disconnect(sessionId: string): void {
        const ws = this.connections.get(sessionId);
        if (ws) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.close(1000, 'Client disconnect');
            }
            this.connections.delete(sessionId);
        }
        this.connectionStatuses.delete(sessionId);
        console.log(`🔌 [${sessionId}] Disconnected and cleaned up`);
    }

    /**
     * Get connection status
     */
    public getStatus(sessionId: string): 'connected' | 'reconnecting' | 'disconnected' {
        return this.connectionStatuses.get(sessionId)?.status || 'disconnected';
    }

    /**
     * Check if setup is complete
     */
    public isSetupComplete(sessionId: string): boolean {
        return this.connectionStatuses.get(sessionId)?.setupComplete || false;
    }
    /**
     * Send turn complete signal to Gemini Live API without audio
     * This tells Gemini that the user has finished speaking
     */
    public async completeTurn(sessionId: string): Promise<void> {
        const ws = this.connections.get(sessionId);
        const status = this.connectionStatuses.get(sessionId);

        if (!ws || ws.readyState !== WebSocket.OPEN) {
            throw new Error("No active connection for session");
        }

        if (!status?.setupComplete) {
            console.warn(`⚠️ [${sessionId}] Setup not complete, waiting...`);
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        const message: GeminiClientContent = {
            client_content: {
                turns: [],
                turn_complete: true
            }
        };

        ws.send(JSON.stringify(message));
        console.log(`✋ [${sessionId}] Sent turn complete signal`);
    }


}

