import WebSocket from 'ws';

export interface GeminiLiveWebSocket extends WebSocket {
    readyState: WebSocket['readyState'];
}

export interface GeminiLiveMessage {
    type: 'text' | 'audio' | 'ping' | 'pong' | 'error';
    text?: string;
    data?: {
        text?: string;
        audio?: {
            base64: string;
            format: 'wav' | 'opus';
            sampleRate?: number;
        };
        error?: {
            code: string;
            message: string;
        };
    };
    mime_type?: string;
    generation_config?: {
        temperature?: number;
        candidate_count?: number;
        stop_sequences?: string[];
    };
    sessionId?: string;
    seq?: number;
    timestamp?: number;
}

export interface GeminiLiveConfig {
    mode: string;
    difficulty: string;
    position: string;
    jobDescription?: string;
    voicePreference?: string;
    model?: string;
    language?: string;
}

export interface WSClientMessage {
    type: string;
    sessionId: string;
    text?: string;
    content?: string;
    audioData?: string;
    encoding?: string;
    sampleRate?: number;
    settings?: GeminiLiveConfig;
    data?: string | ArrayBuffer;
    seq?: number;
    turnComplete?: boolean;
}

export interface WSServerResponse {
    type: string;
    sessionId: string;
    content?: string;
    error?: {
        code: string;
        message: string;
        recoverable: boolean;
    };
}