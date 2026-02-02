import { env } from './config/env.js';
import app from './app.js';
import { createServer } from 'http';
import { setupSocket } from './socket/index.js';

console.log('🎬 Starting server initialization...');

const PORT = parseInt(env.PORT, 10);
const httpServer = createServer(app);

console.log('📡 Setting up Socket.IO...');
// Initialize Socket.IO
const io = setupSocket(httpServer);

// Attach io to express app to avoid circular dependencies in controllers
app.set('io', io);

console.log(`📡 Attempting to listen on port ${PORT} (host: 0.0.0.0)...`);
const server = httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📝 Environment: ${env.NODE_ENV}`);
  console.log('✅ Health check ready at /health');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('👋 SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    console.log('✅ Process terminated!');
  });
});
