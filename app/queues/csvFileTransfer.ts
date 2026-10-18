import os from 'os';
import fs from 'fs';
import path from 'path';
import { Job } from 'bull';
import { CsvJobData } from '@interfaces/index';

/**
 * CSV jobs are added by the API and processed by the worker, which run as separate services
 * with separate disks. The API puts the uploaded file's bytes in the job itself (Redis, which
 * jobs already need), and the worker writes them to a temp file before the handler runs, so
 * worker code keeps reading `csvFilePath`. Uploads are capped at 10MB (diskStorage csv_file).
 */

/** API side: moves the uploaded CSV into the job data and removes the local copy. */
export const attachCsvToJob = async (data: CsvJobData): Promise<CsvJobData> => {
  const buffer = await fs.promises.readFile(data.csvFilePath);
  await fs.promises.unlink(data.csvFilePath).catch(() => undefined);
  // base64 keeps the exact bytes, so non-UTF-8 exports (e.g. Excel's Windows-1252) survive
  return { ...data, csvContentBase64: buffer.toString('base64') };
};

/** Worker side: wraps a CSV job handler so it reads a temp copy of the CSV carried in the job. */
export const withCsvFile =
  (handler: (job: Job<CsvJobData>) => Promise<any>) =>
  async (job: Job<CsvJobData>): Promise<any> => {
    const { csvContentBase64 } = job.data;
    if (!csvContentBase64) return handler(job);

    const localPath = path.join(
      os.tmpdir(),
      `csv_${job.id}_${path.basename(job.data.csvFilePath)}`
    );
    await fs.promises.writeFile(localPath, Buffer.from(csvContentBase64, 'base64'));
    job.data.csvFilePath = localPath;

    try {
      return await handler(job);
    } finally {
      await fs.promises.unlink(localPath).catch(() => undefined);
    }
  };
