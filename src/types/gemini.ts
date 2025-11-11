export interface GeminiResponseContent {
    text: string;
    audio?: Buffer;
    error?: {
        code: string;
        message: string;
        recoverable: boolean;
    };
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

export interface GeminiError extends Error {
    status?: number;
    statusText?: string;
    errorDetails?: any[];
}