import dotenv from 'dotenv';
import express from 'express';
import { createServer } from 'http';
import { AISocketServer } from './services/aiSocketServer.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

// Add CORS and security headers
app.use((req, res, next) => {
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',');
  const origin = req.headers.origin;

  // Allow only specified origins
  if (origin && allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }

  // Security headers
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Sec-WebSocket-Protocol');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.header('X-Content-Type-Options', 'nosniff');
  res.header('X-Frame-Options', 'SAMEORIGIN');
  res.header('X-XSS-Protection', '1; mode=block');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }

  next();
});

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Serve static files from dist/client directory in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static('dist/client'));
}

// Create HTTP Server
const server = createServer(app);

// Initialize WebSocket server for AI interview sessions
new AISocketServer(server);

server.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
  console.log(`📡 WebSocket server ready for AI interview connections`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
  });
});
