import { container } from '@di/index';
import { getServerInstance } from '@root/server';

export default async (): Promise<void> => {
  console.log('🔧 Setting up test environment...');

  try {
    // Set test environment variables
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-jwt-secret';
    process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret';
    process.env.JWT_EXPIRATION_TIME = '15m';
    process.env.JWT_REFRESH_EXPIRATION_TIME = '7d';
    process.env.FRONTEND_URL = 'http://localhost:3000';

    // Initialize the server instance which will set up the database and Redis
    // The DatabaseService already handles test environment detection and uses memory servers
    const { appInstance } = getServerInstance();
    
    // Database and Redis connections are automatically handled by the existing services
    // when NODE_ENV=test is detected
    
    // Store app instance globally for tests
    (global as any).__APP_INSTANCE__ = appInstance;
    (global as any).__CONTAINER__ = container;

    console.log('✅ Test environment setup completed');
  } catch (error) {
    console.error('❌ Test environment setup failed:', error);
    throw error;
  }
};