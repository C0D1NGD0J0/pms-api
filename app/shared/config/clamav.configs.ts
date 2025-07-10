import Logger from 'bunyan';
import NodeClam from 'clamscan';
import { createLogger } from '@utils/index';
import { envVariables } from '@shared/config';

interface ScanResult {
  /** Indicates if the scanned item contains viruses */
  isInfected: boolean;
  /** List of detected viruses */
  viruses: string[];
}

export class ClamScannerService {
  private clamscan: NodeClam | null = null;
  private isInitialized: boolean = false;
  private readonly options: Record<string, any>;
  private readonly log: Logger;

  constructor() {
    this.log = createLogger('ClamAVScannerService');

    // Environment-specific configurations
    const devConfig = {
      clamdscan: {
        socket: envVariables.CLAMAV.SOCKET,
        timeout: 120000,
        path: '/usr/local/bin/clamdscan',
      },
      preference: 'clamdscan',
    };

    const prodConfig = {
      clamdscan: {
        host: envVariables.CLAMAV.HOST,
        port: envVariables.CLAMAV.PORT,
        timeout: 120000,
      },
      preference: 'clamdscan',
    };

    const envConfig = envVariables.SERVER.ENV !== 'dev' ? prodConfig : devConfig;

    this.options = {
      removeInfected: false,
      quarantineInfected: false,
      scanLog: 'logs/clamav_scan.log',
      debugMode: envVariables.SERVER.ENV === 'dev',
      scanRecursively: true,
      maxFileSize: 26214400, // 25MB
      ...envConfig,
    };

    new NodeClam()
      .init(this.options)
      .then((clam) => {
        this.clamscan = clam;
        this.isInitialized = true;
        this.log.info('ClamAV scanner initialized successfully');
      })
      .catch((err: any) => {
        this.isInitialized = false;

        if (err.message?.includes('virus database') || err.message?.includes('freshclam')) {
          this.log.error(
            'ClamAV Error: Database is outdated or missing. Run "freshclam" on the server.'
          );
          throw new Error('ClamAV database requires update. Please run freshclam.');
        } else if (
          err.code === 'ECONNREFUSED' ||
          err.code === 'ENOENT' ||
          err.message?.includes('socket')
        ) {
          this.log.error(
            `ClamAV Error: Could not connect to clamd daemon at socket  ${this.options}`
          );
          throw new Error(`ClamAV daemon connection failed at  ${this.options}`);
        } else {
          this.log.error('ClamAV initialization failed:', err);
          throw new Error(`ClamAV scanner failed to initialize: ${err.message}`);
        }
      });
  }

  isReady(): boolean {
    return this.isInitialized && this.clamscan !== null;
  }

  async scanFile(filePath: string): Promise<ScanResult> {
    if (!this.isReady() || !this.clamscan) {
      this.log.error('Scan attempt failed: ClamAV scanner not initialized');
      throw new Error('ClamAV scanner is not initialized');
    }

    if (!filePath) {
      this.log.error('Scan attempt failed: No file path provided');
      throw new Error('No file path provided');
    }

    try {
      const result = await this.clamscan.scanFile(filePath);
      if (result.isInfected) {
        this.log.warn(`Virus detected in ${filePath}: ${result.viruses.join(', ')}`);
      }

      return result;
    } catch (error: any) {
      this.log.error(`Error scanning file ${filePath}:`, error);
      if (error.code === 'ENOENT') {
        throw new Error(`File not found at path: ${filePath}`);
      }
      throw new Error(`Failed to scan file: ${error.message}`);
    }
  }
}
