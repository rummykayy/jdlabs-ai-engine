# JDLabs AI Engine 🚀

Backend API service for the JDLabs AI-powered interview platform. Provides real-time voice and text interview capabilities using Google Gemini Live API or local AI stack (Ollama + Whisper + Piper).

## 🎯 Features

- **Dual AI Backend Support**: Switch between Gemini Live API (cloud) or local AI stack
- **Real-time WebSocket Communication**: Streaming audio and text responses
- **RESTful API**: Version-controlled endpoints (`/api/v1/...`)
- **Session Management**: Stateful interview sessions with Redis
- **OpenAPI Documentation**: Auto-generated TypeScript types for frontend
- **Docker Support**: Containerized deployment

## 🏗️ Architecture

```
┌──────────────────────────────────────┐
│         API Gateway                  │
│  (REST + WebSocket)                  │
└──────────────┬───────────────────────┘
               │
    ┌──────────┴──────────┐
    │                     │
┌───▼────┐        ┌───────▼────┐
│  ASR   │        │    LLM     │
│Whisper │        │Ollama/Gemini│
└───┬────┘        └───────┬────┘
    │                     │
    └──────────┬──────────┘
               │
        ┌──────▼─────┐
        │    TTS     │
        │   Piper    │
        └────────────┘
```

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- npm 9+
- Redis (for session management)
- Docker (optional, for local AI services)

### Installation

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit .env with your API keys
```

### Development

```bash
# Build TypeScript
npm run build

# Start server
npm start

# Or start with auto-reload
npm run dev
```

Server runs on `http://localhost:5000`

### Using Docker

```bash
# Build image
docker build -t jdlabs-ai-engine .

# Run container
docker run -p 5000:5000 --env-file .env jdlabs-ai-engine
```

## 🔧 Configuration

### Environment Variables

```bash
# AI Backend Selection
AI_BACKEND=gemini                    # Options: 'gemini' or 'local'

# Gemini Live API (if AI_BACKEND=gemini)
GEMINI_API_KEY=your_api_key
GEMINI_LIVE_MODEL=models/gemini-2.5-flash-native-audio-latest

# Local AI Services (if AI_BACKEND=local)
OLLAMA_URL=http://localhost:11434
WHISPER_URL=http://localhost:9000
PIPER_URL=http://localhost:10200

# Database
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_key

# Server
PORT=5000
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000

# Session Management
REDIS_URL=redis://localhost:6379
```

## 📡 API Endpoints

### REST API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/sessions` | Create new interview session |
| `DELETE` | `/api/v1/sessions/:id` | End interview session |
| `POST` | `/api/v1/interview/start` | Start interview with settings |
| `POST` | `/api/v1/interview/message` | Send text message |
| `GET` | `/health` | Health check endpoint |
| `GET` | `/openapi.json` | OpenAPI specification |

### WebSocket API

| Endpoint | Description |
|----------|-------------|
| `WS /api/v1/interview/stream` | Real-time audio/text streaming |

#### WebSocket Message Format

**Client → Server**:
```json
{
  "type": "audio-chunk",
  "sessionId": "sess_abc123",
  "data": "base64_encoded_audio",
  "encoding": "webm",
  "seq": 42
}
```

**Server → Client**:
```json
{
  "type": "audio",
  "sessionId": "sess_abc123",
  "audioData": {
    "data": "base64_pcm_audio",
    "mimeType": "audio/pcm;rate=24000"
  },
  "turnComplete": false
}
```

## 🧪 Testing

```bash
# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Run specific test file
npm test -- src/services/geminiLiveManager.test.ts
```

## 📚 Documentation

- **API Documentation**: See [docs/api.md](docs/api.md)
- **Architecture**: See [docs/architecture.md](docs/architecture.md)
- **WebSocket Protocol**: See [docs/websocket-api.md](docs/websocket-api.md)
- **OpenAPI Spec**: Available at `/openapi.json` when server is running

## 🔐 Security

- API key authentication for all endpoints
- Rate limiting (30 requests/minute for text, 200/minute for audio)
- CORS protection
- Input validation and sanitization
- Secure WebSocket connections

## 🚢 Deployment

### Production Build

```bash
npm run build
NODE_ENV=production npm start
```

### Docker Deployment

```bash
# Build production image
docker build -t jdlabs-ai-engine:latest .

# Push to registry
docker tag jdlabs-ai-engine:latest your-registry/jdlabs-ai-engine:latest
docker push your-registry/jdlabs-ai-engine:latest

# Deploy to your platform (Cloud Run, ECS, Kubernetes, etc.)
```

### Environment-Specific Configurations

- **Development**: Uses nodemon for hot reload
- **Production**: Optimized build, no dev dependencies
- **Docker**: Multi-stage build for minimal image size

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## 📝 License

MIT License - see LICENSE file for details

## 🆘 Support

- Create an issue for bugs or feature requests
- Check [docs/](docs/) for detailed documentation
- See main workspace README for multi-repo setup

---

**Part of the JDLabs AI Interview Platform**