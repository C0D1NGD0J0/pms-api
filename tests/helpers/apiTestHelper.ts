import { Server } from 'http';
import express, { Application } from 'express';

/**
 * Manages a test Express application with proper lifecycle management
 * to prevent open handles in Jest tests
 */
export class ApiTestHelper {
  private app: Application | null = null;
  private server: Server | null = null;

  /**
   * Creates and starts a test Express application
   * @param setupRoutes - Function to setup routes and middleware on the app
   * @returns The Express application instance
   */
  createApp(setupRoutes: (app: Application) => void): Application {
    this.app = express();
    this.app.use(express.json());

    // Allow custom setup
    setupRoutes(this.app);

    return this.app;
  }

  /**
   * Starts the Express server on a random available port
   * @returns Promise that resolves when server is listening
   */
  async startServer(): Promise<void> {
    if (!this.app) {
      throw new Error('App not created. Call createApp() first.');
    }

    return new Promise((resolve) => {
      this.server = this.app!.listen(0, () => {
        resolve();
      });
    });
  }

  /**
   * Closes the server and cleans up resources
   * @returns Promise that resolves when server is closed
   */
  async closeServer(): Promise<void> {
    if (this.server) {
      return new Promise((resolve, reject) => {
        this.server!.close((err) => {
          if (err) {
            reject(err);
          } else {
            this.server = null;
            this.app = null;
            resolve();
          }
        });
      });
    }
  }

  /**
   * Gets the Express app instance
   */
  getApp(): Application {
    if (!this.app) {
      throw new Error('App not created. Call createApp() first.');
    }
    return this.app;
  }

  /**
   * Gets the server instance
   */
  getServer(): Server | null {
    return this.server;
  }
}

/**
 * Creates a simple test helper for API route tests
 * Usage:
 *
 * ```ts
 * const helper = createApiTestHelper();
 *
 * beforeAll(() => {
 *   helper.createApp((app) => {
 *     // Setup routes and middleware
 *     app.use(middleware);
 *     app.get('/test', handler);
 *   });
 * });
 *
 * it('should work', async () => {
 *   const response = await request(helper.getApp()).get('/test');
 *   expect(response.status).toBe(200);
 * });
 * ```
 */
export const createApiTestHelper = (): ApiTestHelper => {
  return new ApiTestHelper();
};
