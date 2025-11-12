import { GoogleGenerativeAI } from '@google/generative-ai';

interface GeminiResponse {
    text: string;
    audio?: Buffer;
    error?: {
        code: string;
        message: string;
        recoverable: boolean;
    };
}

export class GeminiService {
    private genAI: GoogleGenerativeAI;
    private model: string;
    private audioModel: string;

    constructor() {
        const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error('Missing Gemini API key');
        }

        this.genAI = new GoogleGenerativeAI(apiKey);
        this.model = process.env.GEMINI_MODEL || 'gemini-2.5-pro';
        this.audioModel = process.env.GEMINI_AUDIO_MODEL || 'gemini-2.5-flash-preview-native-audio';
    }

    async sendTextToGemini(_sessionId: string, text: string, _voicePreference?: string): Promise<GeminiResponse> {
        try {
            console.log(`📤 Sending text to Gemini (${_sessionId}):`, text.substring(0, 100) + '...');

            const model = this.genAI.getGenerativeModel({ model: this.model });
            const result = await model.generateContent(text);
            const response = await result.response;
            const responseText = response.text();

            if (!responseText) {
                throw new Error('Empty response from Gemini');
            }

            return { text: responseText };

        } catch (error) {
            console.error('❌ Gemini text processing error:', error);
            return {
                text: '',
                error: {
                    code: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
                    message: error instanceof Error ? error.message : String(error),
                    recoverable: true
                }
            };
        }
    }

    async sendAudioToGemini(_sessionId: string, audio: Buffer, _voicePreference?: string): Promise<GeminiResponse> {
        try {
            console.log(`🎤 Processing audio for Gemini (${_sessionId})`);

            const audioModel = this.genAI.getGenerativeModel({ model: this.audioModel });

            // Convert Buffer to base64 directly
            const base64Audio = Buffer.from(audio).toString('base64');

            const result = await audioModel.generateContent([
                {
                    inlineData: {
                        data: base64Audio,
                        mimeType: 'audio/wav'
                    }
                }
            ]);

            const transcription = result.response.text();
            if (!transcription) {
                throw new Error('Failed to transcribe audio');
            }

            return this.sendTextToGemini(_sessionId, transcription, _voicePreference);

        } catch (error) {
            console.error('❌ Gemini audio processing error:', error);
            return {
                text: '',
                error: {
                    code: error instanceof Error ? error.name : 'AUDIO_PROCESSING_ERROR',
                    message: error instanceof Error ? error.message : String(error),
                    recoverable: true
                }
            };
        }
    }

    // Placeholder for speech generation - kept for potential future use
    // @ts-ignore
    private async _generateSpeech(_text: string, _voice: string): Promise<Buffer> {
        // Implementation depends on which text-to-speech service you want to use
        throw new Error('Speech generation not implemented');
    }
}