import { spawn } from 'child_process';
import { unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

export interface AudioFormat {
    format: 'wav' | 'opus' | 'webm';
    sampleRate?: number;
    channels?: number;
}

export interface AudioChunkValidation {
    data: string;                // Base64 encoded audio
    sampleRate?: number;         // Sample rate in Hz
    channels?: number;           // Number of audio channels
}

export interface AudioChunk {
    data: string;                // Base64 encoded audio
    sampleRate?: number;         // Sample rate in Hz
    channels?: number;           // Number of audio channels
    encoding?: string;           // Audio format (wav, opus, webm)
    maxSizeBytes?: number;       // Maximum allowed size in bytes
}

export interface AudioValidationOptions {
    maxSizeBytes?: number;       // Maximum allowed size
    requiredFormat?: string;     // Required audio format
    minSampleRate?: number;      // Minimum required sample rate
    maxChannels?: number;        // Maximum allowed channels
}

/**
 * Validates an audio chunk against specified constraints
 */
export function validateAudioChunk(chunk: AudioChunkValidation, options: AudioValidationOptions = {}): boolean {
    const {
        maxSizeBytes = 5 * 1024 * 1024, // 5MB default
        requiredFormat,
        minSampleRate = 8000,
        maxChannels = 2
    } = options;

    // Check if data is provided and is a valid base64 string
    if (!chunk.data || typeof chunk.data !== 'string') {
        console.error('Invalid audio chunk: missing or invalid data');
        return false;
    }

    try {
        // Check size
        const buffer = Buffer.from(chunk.data, 'base64');
        if (maxSizeBytes && buffer.length > maxSizeBytes) {
            console.error(`Audio chunk too large: ${buffer.length} bytes`);
            return false;
        }

        // Check sample rate if provided
        if (chunk.sampleRate && chunk.sampleRate < minSampleRate) {
            console.error(`Sample rate too low: ${chunk.sampleRate}Hz`);
            return false;
        }

        // Check channels if provided
        if (chunk.channels && chunk.channels > maxChannels) {
            console.error(`Too many channels: ${chunk.channels}`);
            return false;
        }

        return true;
    } catch (error) {
        console.error('Error validating audio chunk:', error);
        return false;
    }
}

/**
 * Transcodes audio data using FFmpeg
 */
export async function transcodeWithFFmpeg(
    input: Buffer,
    inputFormat: string,
    output: AudioFormat
): Promise<Buffer> {
    const inPath = join(tmpdir(), `input-${Date.now()}.${inputFormat}`);
    const outPath = join(tmpdir(), `output-${Date.now()}.${output.format}`);

    try {
        // Write input buffer to temp file
        await writeFile(inPath, input);

        // Build FFmpeg command
        const args = [
            '-i', inPath,
            '-f', output.format,
            '-acodec', output.format === 'opus' ? 'libopus' : 'pcm_s16le',
            '-ar', String(output.sampleRate || 16000),
            '-ac', String(output.channels || 1),
            '-y', outPath
        ];

        // Run FFmpeg
        await new Promise<void>((resolve, reject) => {
            const ffmpeg = spawn('ffmpeg', args);
            let stderr = '';

            ffmpeg.stderr.on('data', data => {
                stderr += data.toString();
            });

            ffmpeg.on('close', code => {
                if (code !== 0) {
                    reject(new Error(`FFmpeg failed: ${stderr}`));
                } else {
                    resolve();
                }
            });

            ffmpeg.on('error', reject);
        });

        // Read output file
        const result = await readFile(outPath);
        return result;
    } finally {
        // Clean up temp files
        await Promise.all([
            unlink(inPath).catch(() => { }),
            unlink(outPath).catch(() => { })
        ]);
    }
}

// Helper: Write file with retries
async function writeFile(path: string, data: Buffer, retries = 3): Promise<void> {
    try {
        await import('fs/promises').then(fs => fs.writeFile(path, data));
    } catch (error) {
        if (retries > 0) {
            await new Promise(resolve => setTimeout(resolve, 100));
            return writeFile(path, data, retries - 1);
        }
        throw error;
    }
}

// Helper: Read file with retries
async function readFile(path: string, retries = 3): Promise<Buffer> {
    try {
        const fs = await import('fs/promises');
        return await fs.readFile(path);
    } catch (error) {
        if (retries > 0) {
            await new Promise(resolve => setTimeout(resolve, 100));
            return readFile(path, retries - 1);
        }
        throw error;
    }
}

/**
 * Convert WebM/Opus audio to WAV format (for Whisper compatibility)
 * @param webmBuffer WebM audio buffer
 * @param sampleRate Target sample rate (default: 16000 for Whisper)
 * @param channels Number of channels (default: 1 for mono)
 * @returns WAV audio buffer
 */
export async function convertWebMToWav(
    webmBuffer: Buffer,
    sampleRate: number = 16000,
    channels: number = 1
): Promise<Buffer> {
    const inPath = join(tmpdir(), `webm-${Date.now()}.webm`);
    const outPath = join(tmpdir(), `wav-${Date.now()}.wav`);

    try {
        // Write WebM buffer to temp file
        await writeFile(inPath, webmBuffer);

        // Build FFmpeg command for WebM to WAV conversion
        const args = [
            '-i', inPath,
            '-f', 'wav',
            '-acodec', 'pcm_s16le',
            '-ar', String(sampleRate),
            '-ac', String(channels),
            '-y', outPath
        ];

        // Run FFmpeg
        await new Promise<void>((resolve, reject) => {
            const ffmpeg = spawn('ffmpeg', args);
            let stderr = '';

            ffmpeg.stderr.on('data', data => {
                stderr += data.toString();
            });

            ffmpeg.on('close', code => {
                if (code !== 0) {
                    reject(new Error(`FFmpeg WebM to WAV conversion failed: ${stderr}`));
                } else {
                    resolve();
                }
            });

            ffmpeg.on('error', reject);
        });

        // Read WAV output
        const wavBuffer = await readFile(outPath);
        return wavBuffer;
    } finally {
        // Clean up temp files
        await Promise.all([
            unlink(inPath).catch(() => { }),
            unlink(outPath).catch(() => { })
        ]);
    }
}

/**
 * Convert Piper raw PCM to frontend-compatible PCM format
 * @param pcmBuffer Raw PCM buffer from Piper
 * @param sourceSampleRate Source sample rate (default: 22050)
 * @param targetSampleRate Target sample rate (default: 24000)
 * @returns Converted PCM buffer
 */
export async function convertPiperPCM(
    pcmBuffer: Buffer,
    sourceSampleRate: number = 22050,
    targetSampleRate: number = 24000
): Promise<Buffer> {
    // If sample rates match, return as-is
    if (sourceSampleRate === targetSampleRate) {
        return pcmBuffer;
    }

    const inPath = join(tmpdir(), `pcm-in-${Date.now()}.raw`);
    const outPath = join(tmpdir(), `pcm-out-${Date.now()}.raw`);

    try {
        // Write PCM buffer to temp file
        await writeFile(inPath, pcmBuffer);

        // Build FFmpeg command for PCM resampling
        const args = [
            '-f', 's16le',
            '-ar', String(sourceSampleRate),
            '-ac', '1',
            '-i', inPath,
            '-f', 's16le',
            '-ar', String(targetSampleRate),
            '-ac', '1',
            '-y', outPath
        ];

        // Run FFmpeg
        await new Promise<void>((resolve, reject) => {
            const ffmpeg = spawn('ffmpeg', args);
            let stderr = '';

            ffmpeg.stderr.on('data', data => {
                stderr += data.toString();
            });

            ffmpeg.on('close', code => {
                if (code !== 0) {
                    reject(new Error(`FFmpeg PCM conversion failed: ${stderr}`));
                } else {
                    resolve();
                }
            });

            ffmpeg.on('error', reject);
        });

        // Read converted PCM output
        const convertedBuffer = await readFile(outPath);
        return convertedBuffer;
    } finally {
        // Clean up temp files
        await Promise.all([
            unlink(inPath).catch(() => { }),
            unlink(outPath).catch(() => { })
        ]);
    }
}

/**
 * Check if FFmpeg is available
 * @returns true if FFmpeg is installed and accessible
 */
export async function checkFFmpegAvailable(): Promise<boolean> {
    try {
        await new Promise<void>((resolve, reject) => {
            const ffmpeg = spawn('ffmpeg', ['-version']);

            ffmpeg.on('close', code => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error('FFmpeg not available'));
                }
            });

            ffmpeg.on('error', reject);
        });
        return true;
    } catch (error) {
        console.error('FFmpeg availability check failed:', error);
        return false;
    }
}