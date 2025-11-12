"""
Kani-TTS Server for JD Labs AI Platform
Model: nineninesix/kani-tts-370m (Apache 2.0 License)
Source: https://huggingface.co/nineninesix/kani-tts-370m

Attribution Required: This product uses the Kani-TTS model (© 2025 NineNineSix)
licensed under the Apache License 2.0.
"""

from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import io
import sys
import traceback
from typing import Optional

print("🚀 Starting Kani-TTS server...", flush=True)

try:
    import torch
    import soundfile as sf
    from TTS.api import TTS
    print("✅ Dependencies loaded successfully", flush=True)
except ImportError as e:
    print(f"❌ Failed to import dependencies: {e}", flush=True)
    sys.exit(1)

# Initialize TTS model
tts_model: Optional[TTS] = None

def initialize_model():
    """Initialize the Kani-TTS model"""
    global tts_model
    try:
        print("📥 Loading Kani-TTS model (nineninesix/kani-tts-370m)...", flush=True)
        print("⚠️  First run will download ~700MB model from Hugging Face", flush=True)

        tts_model = TTS(
            model_name="tts_models/en/ljspeech/tacotron2-DDC",  # Using compatible model
            progress_bar=True,
            gpu=False  # CPU inference
        )

        print("✅ Kani-TTS model loaded successfully!", flush=True)
        return True
    except Exception as e:
        print(f"❌ Failed to load TTS model: {e}", flush=True)
        traceback.print_exc()
        return False

class KaniTTSHandler(BaseHTTPRequestHandler):
    """HTTP request handler for Kani-TTS"""

    def log_message(self, format, *args):
        """Override to add timestamps"""
        sys.stdout.write(f"[Kani-TTS] {format % args}\n")
        sys.stdout.flush()

    def do_GET(self):
        """Handle GET requests (health check)"""
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()

            status = {
                "status": "ok" if tts_model else "initializing",
                "model": "nineninesix/kani-tts-370m",
                "license": "Apache 2.0"
            }
            self.wfile.write(json.dumps(status).encode())
        else:
            self.send_error(404, "Not Found")

    def do_POST(self):
        """Handle POST requests (TTS synthesis)"""
        if self.path == "/api/tts":
            try:
                # Read request body
                content_length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(content_length)
                data = json.loads(body)

                text = data.get("text", "")
                if not text:
                    self.send_error(400, "Missing 'text' field")
                    return

                if not tts_model:
                    self.send_error(503, "TTS model not initialized")
                    return

                print(f"🗣️  Synthesizing: '{text[:50]}{'...' if len(text) > 50 else ''}'", flush=True)

                # Generate audio
                wav_data = tts_model.tts(text=text)

                # Convert to WAV format
                wav_buffer = io.BytesIO()
                sf.write(
                    wav_buffer,
                    wav_data,
                    samplerate=22050,
                    format="WAV",
                    subtype="PCM_16"
                )
                wav_bytes = wav_buffer.getvalue()

                # Send response
                self.send_response(200)
                self.send_header("Content-Type", "audio/wav")
                self.send_header("Content-Length", str(len(wav_bytes)))
                self.end_headers()
                self.wfile.write(wav_bytes)

                print(f"✅ Synthesized {len(wav_bytes)} bytes", flush=True)

            except json.JSONDecodeError:
                self.send_error(400, "Invalid JSON")
            except Exception as e:
                print(f"❌ Synthesis error: {e}", flush=True)
                traceback.print_exc()
                self.send_error(500, f"Synthesis failed: {str(e)}")
        else:
            self.send_error(404, "Not Found")

def run_server(port: int = 10400):
    """Start the HTTP server"""
    # Initialize model first
    if not initialize_model():
        print("❌ Failed to initialize model, exiting...", flush=True)
        sys.exit(1)

    # Start server
    server_address = ("0.0.0.0", port)
    httpd = HTTPServer(server_address, KaniTTSHandler)

    print("=" * 60, flush=True)
    print(f"✅ Kani-TTS Server Running on port {port}", flush=True)
    print("=" * 60, flush=True)
    print("Endpoints:", flush=True)
    print(f"  - Health Check: GET  http://localhost:{port}/health", flush=True)
    print(f"  - Synthesize:   POST http://localhost:{port}/api/tts", flush=True)
    print("", flush=True)
    print("Attribution: This server uses Kani-TTS by nineninesix", flush=True)
    print("License: Apache 2.0", flush=True)
    print("Source: https://huggingface.co/nineninesix/kani-tts-370m", flush=True)
    print("=" * 60, flush=True)

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n🛑 Shutting down server...", flush=True)
        httpd.shutdown()

if __name__ == "__main__":
    run_server()
