import { GoogleGenAI } from '@google/genai';
import { GoogleGenerativeAI } from '@google/generative-ai';

interface CustomWebSocketConfig {
    create: (url: string) => WebSocket;
}

interface GenerativeAIConfig {
    webSocket?: CustomWebSocketConfig;
}

// Augment the GoogleGenerativeAI type
declare module '@google/generative-ai' {
    interface GoogleGenerativeAI {
        config?: GenerativeAIConfig;
    }
}

const ORIGIN = 'http://localhost:3000';
const API_BASE = 'generativelanguage.googleapis.com';

// Common configuration for API settings
export const API_CONFIG = {
    headers: {
        'Referer': ORIGIN,
        'Origin': ORIGIN,
        'Host': API_BASE
    },
    origin: ORIGIN
};

// Factory function for GoogleGenAI instances
export const createGenAI = () => {
    // Custom WebSocket URL handler
    const createWebSocketUrl = (_path: string) => {
        const url = new URL('wss://generativelanguage.googleapis.com/v1/live:connect');
        url.searchParams.set('model', 'gemini-2.5-flash-native-audio-latest');
        url.searchParams.set('origin', encodeURIComponent(ORIGIN));
        return url.toString();
    };

    // @ts-ignore - Custom configuration for WebSocket support
    const config = {
        apiKey: process.env.API_KEY,
        options: {
            headers: API_CONFIG.headers,
            webSocket: {
                // Override WebSocket creation
                create: (url: string) => {
                    const wsUrl = url.includes('/ws/') ? createWebSocketUrl(new URL(url).pathname) : url;
                    const ws = new WebSocket(wsUrl);
                    ws.addEventListener('open', () => {
                        // Set WebSocket headers
                        if (ws.url.includes(API_BASE)) {
                            // @ts-ignore - Custom header injection
                            ws._headers = {
                                ...API_CONFIG.headers,
                                'Sec-WebSocket-Protocol': 'gemini-api',
                                'Authorization': `Bearer ${process.env.GOOGLE_OAUTH_TOKEN}`
                            };
                        }
                    });
                    return ws;
                }
            },
            fetch: (url: string, init: RequestInit) => {
                // Handle regular HTTP requests
                const headers = {
                    ...init.headers,
                    ...API_CONFIG.headers
                };
                return fetch(url, { ...init, headers });
            }
        }
    };

    return new GoogleGenAI(config);
};

// Factory function for GoogleGenerativeAI instances
export const createGenerativeAI = () => {
    const apiKey = process.env.GOOGLE_API_KEY || process.env.API_KEY || '';

    // @ts-ignore - Custom configuration
    const genAI = new GoogleGenerativeAI(apiKey, {
        webSocket: {
            create: (_url: string) => {
                const wsUrl = new URL('wss://generativelanguage.googleapis.com/v1/live:connect');
                wsUrl.searchParams.set('model', 'gemini-2.5-flash-native-audio-latest');
                wsUrl.searchParams.set('origin', encodeURIComponent(ORIGIN));

                const ws = new WebSocket(wsUrl.toString());
                ws.addEventListener('open', () => {
                    // @ts-ignore - Custom header injection
                    ws._headers = {
                        ...API_CONFIG.headers,
                        'Sec-WebSocket-Protocol': 'gemini-api',
                        'Authorization': `Bearer ${process.env.GOOGLE_OAUTH_TOKEN}`
                    };
                });
                return ws;
            }
        }
    }); return genAI;
};