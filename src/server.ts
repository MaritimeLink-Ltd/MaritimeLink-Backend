import { env } from './config/env.js';
import app from './app.js';
import { createServer } from 'http';
import { setupSocket } from './socket/index.js';

import { prisma } from './config/prisma.js';

console.log('🎬 Starting server initialization...');

const PORT = parseInt(env.PORT, 10);
const httpServer = createServer(app);

console.log('📡 Setting up Socket.IO...');
// Initialize Socket.IO
const io = setupSocket(httpServer);

// Attach io to express app to avoid circular dependencies in controllers
app.set('io', io);

console.log(`📡 Attempting to listen on port ${PORT}...`);

// Database connection test
prisma
  .$connect()
  .then(() => console.log('🗄️  Database connected successfully'))
  .catch((err: Error) =>
    console.error('❌ Database connection failed:', err.message),
  );

const server = httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📝 Environment: ${env.NODE_ENV}`);
  console.log(`🔗 URL: http://localhost:${PORT}`);
  console.log('✅ Health checks ready at / and /health');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('👋 SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    console.log('✅ Process terminated!');
  });
});
