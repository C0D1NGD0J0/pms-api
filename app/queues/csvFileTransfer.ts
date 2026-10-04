import os from 'os';
import fs from 'fs';
import path from 'path';
import { Job } from 'bull';
import crypto from 'crypto';
import { CsvJobData } from '@interfaces/index';
import { S3Service } from '@services/fileUpload/awsS3';

/**
 * CSV jobs are added by the API and processed by the worker, which run as separate services
 * with separate disks. The API stages the uploaded CSV in S3; the worker downloads it to a
 * temp file before the handler runs, so worker code keeps reading `csvFilePath` as before.
 */

/** API side: uploads the local CSV to S3, removes the local copy, and returns job data carrying the key. */
export const stageCsvInS3 = async (s3Service: S3Service, data: CsvJobData): Promise<CsvJobData> => {
  const buffer = await fs.promises.readFile(data.csvFilePath);
  const csvS3Key = `csv-imports/${Date.now()}_${crypto.randomBytes(4).toString('hex')}_${path.basename(data.csvFilePath)}`;
  await s3Service.uploadBuffer(buffer, csvS3Key, 'text/csv');
  await fs.promises.unlink(data.csvFilePath).catch(() => undefined);
  return { ...data, csvS3Key };
};

/**
 * Worker side: wraps a CSV job handler so it reads a local copy of the staged CSV.
 * The S3 copy is deleted once the job succeeds or has no retries left.
 */
export const withStagedCsv =
  (s3Service: S3Service, handler: (job: Job<CsvJobData>) => Promise<any>) =>
  async (job: Job<CsvJobData>): Promise<any> => {
    const { csvS3Key } = job.data;
    if (!csvS3Key) return handler(job);

    const localPath = path.join(os.tmpdir(), `csv_${job.id}_${path.basename(csvS3Key)}`);
    await fs.promises.writeFile(localPath, await s3Service.getFileBuffer(csvS3Key));
    job.data.csvFilePath = localPath;

    let succeeded = false;
    try {
      const result = await handler(job);
      succeeded = true;
      return result;
    } finally {
      await fs.promises.unlink(localPath).catch(() => undefined);
      const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      if (succeeded || isLastAttempt) await s3Service.deleteFiles([csvS3Key]);
    }
  };
