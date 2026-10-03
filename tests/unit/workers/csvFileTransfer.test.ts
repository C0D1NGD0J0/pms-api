import os from 'os';
import fs from 'fs';
import path from 'path';
import { withStagedCsv, stageCsvInS3 } from '@queues/csvFileTransfer';

const CSV = 'name,email\nJane,jane@example.com\n';

const makeS3 = () => ({
  uploadBuffer: jest.fn().mockResolvedValue({ url: 'u', key: 'k' }),
  getFileBuffer: jest.fn().mockResolvedValue(Buffer.from(CSV)),
  deleteFiles: jest.fn().mockResolvedValue(true),
});

const makeJob = (data: Record<string, any>, attemptsMade = 0, attempts = 1) => ({
  id: 42,
  data,
  attemptsMade,
  opts: { attempts },
});

describe('stageCsvInS3 (API side)', () => {
  it('uploads the CSV to S3, removes the local copy, and adds the key to the job data', async () => {
    const s3 = makeS3();
    const localPath = path.join(os.tmpdir(), `upload_${Date.now()}.csv`);
    fs.writeFileSync(localPath, CSV);

    const data = await stageCsvInS3(
      s3 as any,
      {
        csvFilePath: localPath,
        userId: 'u1',
        clientInfo: { cuid: 'C1' },
      } as any
    );

    expect(s3.uploadBuffer).toHaveBeenCalledWith(
      Buffer.from(CSV),
      expect.stringMatching(/^csv-imports\/\d+_upload_\d+\.csv$/),
      'text/csv'
    );
    expect(data.csvS3Key).toBe(s3.uploadBuffer.mock.calls[0][1]);
    expect(fs.existsSync(localPath)).toBe(false);
  });
});

describe('withStagedCsv (worker side)', () => {
  it('gives the handler a local copy of the CSV, then cleans up both copies', async () => {
    const s3 = makeS3();
    let seenPath = '';
    let seenContents = '';
    const handler = jest.fn(async (job: any) => {
      seenPath = job.data.csvFilePath;
      seenContents = fs.readFileSync(seenPath, 'utf8');
      return 'done';
    });

    const result = await withStagedCsv(
      s3 as any,
      handler
    )(makeJob({ csvFilePath: '/api-disk/uploads/x.csv', csvS3Key: 'csv-imports/1_x.csv' }) as any);

    expect(result).toBe('done');
    expect(seenPath).not.toBe('/api-disk/uploads/x.csv');
    expect(seenContents).toBe(CSV);
    expect(fs.existsSync(seenPath)).toBe(false);
    expect(s3.deleteFiles).toHaveBeenCalledWith(['csv-imports/1_x.csv']);
  });

  it('keeps the S3 copy when the job fails but will be retried', async () => {
    const s3 = makeS3();
    const handler = jest.fn().mockRejectedValue(new Error('boom'));

    await expect(
      withStagedCsv(
        s3 as any,
        handler
      )(makeJob({ csvFilePath: 'x', csvS3Key: 'csv-imports/1_x.csv' }, 0, 3) as any)
    ).rejects.toThrow('boom');

    expect(s3.deleteFiles).not.toHaveBeenCalled();
  });

  it('deletes the S3 copy after the last failed attempt', async () => {
    const s3 = makeS3();
    const handler = jest.fn().mockRejectedValue(new Error('boom'));

    await expect(
      withStagedCsv(
        s3 as any,
        handler
      )(makeJob({ csvFilePath: 'x', csvS3Key: 'csv-imports/1_x.csv' }, 2, 3) as any)
    ).rejects.toThrow('boom');

    expect(s3.deleteFiles).toHaveBeenCalledWith(['csv-imports/1_x.csv']);
  });

  it('runs the handler unchanged for jobs without a staged CSV', async () => {
    const s3 = makeS3();
    const handler = jest.fn().mockResolvedValue('ok');
    const job = makeJob({ csvFilePath: '/local/x.csv' });

    await withStagedCsv(s3 as any, handler)(job as any);

    expect(handler).toHaveBeenCalledWith(job);
    expect(s3.getFileBuffer).not.toHaveBeenCalled();
  });
});
