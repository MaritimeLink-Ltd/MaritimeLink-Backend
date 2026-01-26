import { env } from './config/env.js';
import app from './app.js';
import { createServer } from 'http';
import { setupSocket } from './socket/index.js';

const PORT = parseInt(env.PORT, 10);
const httpServer = createServer(app);

// Initialize Socket.IO
const io = setupSocket(httpServer);

// Attach io to express app to avoid circular dependencies in controllers
app.set('io', io);

const server = httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📝 Environment: ${env.NODE_ENV}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('👋 SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    console.log('✅ Process terminated!');
  });
});
