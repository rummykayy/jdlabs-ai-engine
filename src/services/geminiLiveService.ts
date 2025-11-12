import WebSocket from 'ws';
import fetch from 'node-fetch';

// Error formatting utility
function formatError(err: unknown) {
    const errorInfo = {
        message: 'Unknown error occurred',
        timestamp: new Date().toISOString(),
        details: null as any
    };

    if (err instanceof Error) {
        errorInfo.message = err.message;
        errorInfo.details = {
            name: err.name,
            stack: err.stack
        };
    } else if (typeof err === 'string') {
        errorInfo.message = err;
    } else {
        errorInfo.details = err;
    }

    return errorInfo;
}

// Official Gemini Live WebSocket URL - DO NOT MODIFY
const GEMINI_WS_BASE_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

function getWebSocketURL(): string {
    // Try API key first (simpler auth method)
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (apiKey) {
        return `${GEMINI_WS_BASE_URL}?key=${apiKey}`;
    }

    // If no API key, we'll use OAuth token in headers
    return GEMINI_WS_BASE_URL;
}

async function getAccessToken(): Promise<string | null> {
    // 1️⃣ Prefer manual token from .env
    if (process.env.GOOGLE_OAUTH_TOKEN) {
        return process.env.GOOGLE_OAUTH_TOKEN;
    }

    // 2️⃣ Fallback to GCP Metadata server (for deployed environments)
    try {
        const metadataURL = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';
        const res = await fetch(metadataURL, { headers: { 'Metadata-Flavor': 'Google' } });
        if (!res.ok) throw new Error('Failed to retrieve Google metadata access token');
        const data: any = await res.json();
        const access_token = data.access_token;
        if (!access_token) throw new Error("No access_token field in metadata response");
        return access_token;
    } catch (err) {
        const error = err instanceof Error ? err : new Error('Unknown error occurred');
        console.error('Failed to get access token:', formatError(error));
        return null;
    }
}

export async function connectGeminiLive(sessionId: string): Promise<WebSocket> {
    try {
        console.log(`🎙️ [${sessionId}] Initializing Gemini Live connection...`);

        // Get WebSocket URL (with API key if available)
        const wsUrl = getWebSocketURL();
        const hasApiKey = wsUrl.includes('?key=');

        console.log(`🔗 [${sessionId}] Connecting to:`, hasApiKey
            ? wsUrl.replace(/key=[^&]+/, 'key=***REDACTED***')
            : wsUrl);
        console.log(`🔐 [${sessionId}] Auth method:`, hasApiKey ? 'API Key' : 'OAuth Token');

        // If using OAuth, get the token
        const token = hasApiKey ? null : await getAccessToken();
        if (!hasApiKey && token) {
            console.log(`🔑 [${sessionId}] OAuth token obtained, length:`, token.length);
        } else if (!hasApiKey && !token) {
            throw new Error('No authentication method available. Set GEMINI_API_KEY or GOOGLE_OAUTH_TOKEN in .env');
        }

        // Create WebSocket connection
        const wsOptions: any = {};
        if (token) {
            wsOptions.headers = {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            };
            console.log(`📝 [${sessionId}] Creating WebSocket with OAuth headers...`);
        } else {
            console.log(`📝 [${sessionId}] Creating WebSocket with API key in URL...`);
        }

        const ws = new WebSocket(wsUrl, wsOptions);

        ws.on('open', () => {
            console.log(`✅ [${sessionId}] Gemini Live WebSocket connection opened successfully`);
        });

        ws.on('error', (err) => {
            console.error(`❌ [${sessionId}] Gemini Live WebSocket error:`, err);
            console.log(`🔍 [${sessionId}] Error details:`, formatError(err));
        });

        ws.on('close', (code, reason) => {
            console.warn(`🔌 [${sessionId}] Gemini Live WebSocket closed`);
            console.warn(`📋 [${sessionId}] Close details:`, {
                code,
                reason: reason?.toString() || 'No reason provided',
                wasClean: code === 1000
            });
        });

        return ws;
    } catch (err) {
        const error = err instanceof Error ? err : new Error('Unknown error occurred');
        console.error(`❌ [${sessionId}] Error creating Gemini Live connection:`, formatError(error));
        throw new Error(`Failed to initialize audio connection: ${error.message}`);
    }
}
