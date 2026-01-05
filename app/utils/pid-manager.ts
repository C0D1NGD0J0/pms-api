import * as fs from 'fs';
import bunyan from 'bunyan';
import * as path from 'path';

export class PidManager {
  private readonly pidDir: string;
  private readonly pidFile: string;
  private readonly processName: string;
  private readonly log: bunyan;

  constructor(processName: 'api' | 'worker', log: bunyan) {
    this.processName = processName;
    this.log = log;
    this.pidDir = path.join(process.cwd(), '.pids');
    this.pidFile = path.join(this.pidDir, `${processName}.pid`);
  }

  /**
   * Check for existing PID file and prevent duplicate processes
   * Exits process if another instance is already running
   */
  check(): void {
    this.ensurePidDirectory();

    if (fs.existsSync(this.pidFile)) {
      const existingPid = this.readPidFile();

      if (this.isProcessRunning(existingPid)) {
        this.log.warn(
          `${this.processName.toUpperCase()} process already running with PID ${existingPid}. Exiting to prevent duplicate processes.`
        );
        process.exit(0);
      }

      // Process doesn't exist, stale PID file - safe to continue
      this.log.info(`Removing stale PID file for non-existent process ${existingPid}`);
      this.cleanup();
    }

    this.writePidFile();
    this.log.info(`${this.processName.toUpperCase()} process PID ${process.pid} registered`);
  }

  /**
   * Kill the process and clean up PID file
   * Sends SIGTERM first for graceful shutdown, then SIGKILL if needed
   */
  killProcess(): void {
    if (!fs.existsSync(this.pidFile)) {
      this.log.info('No PID file found, nothing to kill');
      return;
    }

    const pid = this.readPidFile();
    if (pid <= 0) {
      this.log.warn('Invalid PID in file, cleaning up');
      this.cleanup();
      return;
    }

    if (!this.isProcessRunning(pid)) {
      this.log.info(`Process ${pid} is not running, cleaning up stale PID file`);
      this.cleanup();
      return;
    }

    try {
      this.log.info(`Sending SIGTERM to process ${pid}...`);
      process.kill(pid, 'SIGTERM');

      // Wait a bit for graceful shutdown
      const maxWait = 5000; // 5 seconds
      const checkInterval = 100; // 100ms
      let waited = 0;

      const checkInterval_id = setInterval(() => {
        waited += checkInterval;

        if (!this.isProcessRunning(pid)) {
          clearInterval(checkInterval_id);
          this.log.info(`Process ${pid} terminated gracefully`);
          this.cleanup();
          return;
        }

        if (waited >= maxWait) {
          clearInterval(checkInterval_id);
          this.log.warn(`Process ${pid} did not terminate gracefully, sending SIGKILL...`);
          try {
            process.kill(pid, 'SIGKILL');
            this.log.info(`Process ${pid} force killed`);
          } catch (err: any) {
            if (err.code !== 'ESRCH') {
              this.log.error(`Failed to force kill process ${pid}:`, err);
            }
          }
          this.cleanup();
        }
      }, checkInterval);
    } catch (err: any) {
      if (err.code === 'ESRCH') {
        this.log.info(`Process ${pid} already terminated`);
        this.cleanup();
      } else {
        this.log.error(`Failed to kill process ${pid}:`, err);
        throw err;
      }
    }
  }

  /**
   * Clean up PID file on shutdown
   */
  cleanup(): void {
    if (fs.existsSync(this.pidFile)) {
      try {
        fs.unlinkSync(this.pidFile);
        this.log.info('PID file cleaned up');
      } catch (err) {
        this.log.warn('Failed to remove PID file:', err);
      }
    }
  }

  private ensurePidDirectory(): void {
    if (!fs.existsSync(this.pidDir)) {
      fs.mkdirSync(this.pidDir, { recursive: true });
    }
  }

  private readPidFile(): number {
    try {
      return parseInt(fs.readFileSync(this.pidFile, 'utf8').trim(), 10);
    } catch (err) {
      this.log.warn('Failed to read PID file:', err);
      return -1;
    }
  }

  private writePidFile(): void {
    try {
      fs.writeFileSync(this.pidFile, process.pid.toString());
    } catch (err) {
      this.log.error('Failed to write PID file:', err);
      throw err;
    }
  }

  private isProcessRunning(pid: number): boolean {
    if (pid <= 0) return false;

    try {
      // Signal 0 checks if process exists without actually sending a signal
      process.kill(pid, 0);
      return true;
    } catch (err: any) {
      // ESRCH means process doesn't exist
      if (err.code === 'ESRCH') {
        return false;
      }
      // EPERM means process exists but we don't have permission
      if (err.code === 'EPERM') {
        return true;
      }
      return false;
    }
  }
}
