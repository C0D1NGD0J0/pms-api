/**
 * Interface for services that need cleanup during application shutdown
 */
export interface IDisposable {
  /**
   * Cleanup method called during service shutdown
   * Should remove event listeners, close connections, clear timers, etc.
   */
  destroy(): Promise<void> | void;
}

/**
 * Interface for services with health check capabilities
 */
export interface IHealthCheckable {
  /**
   * Check if the service is healthy and ready to serve requests
   */
  isHealthy(): Promise<boolean> | boolean;
}

/**
 * Combined interface for well-behaved services
 */
export interface IService extends IHealthCheckable, IDisposable {}