export interface ICronJob {
  handler: () => Promise<void>; // Handler function to execute, that must be bound to service instance
  description: string;
  timezone?: string;
  schedule: string; // Cron expression (e.g., '0 2 * * *' for 2 AM daily) (minute hour day month day-of-week)
  enabled: boolean; // if cron job can be enabled/disabled via config/admin api
  timeout?: number; // Max execution time before timeout (5000ms default)
  service: string; // Service that owns this cron job
  name: string; // Unique job name (e.g., 'lease:auto-renewal')
}

/**
 * Cron Job Execution Log
 * Track cron job runs for monitoring
 */
export interface ICronExecutionLog {
  status: 'running' | 'completed' | 'failed';
  completedAt?: Date;
  duration?: number;
  attempts: number;
  jobName: string;
  startedAt: Date;
  error?: string;
}

/**
 * Interface for services that provide cron jobs
 */
export interface ICronProvider {
  getCronJobs(): ICronJob[]; // Return array of cron jobs this service wants to register
}
