import os from 'os';
import fs from 'fs';
import path from 'path';
import { attachCsvToJob, withCsvFile } from '@queues/csvFileTransfer';

const CSV = 'name,email\nJane,jane@example.com\n';
const CSV_BASE64 = Buffer.from(CSV).toString('base64');

const makeJob = (data: Record<string, any>) => ({ id: 42, data });

describe('attachCsvToJob (API side)', () => {
  it('moves the uploaded CSV into the job data and removes the local copy', async () => {
    const localPath = path.join(os.tmpdir(), `upload_${Date.now()}.csv`);
    fs.writeFileSync(localPath, CSV);

    const data = await attachCsvToJob({
      csvFilePath: localPath,
      userId: 'u1',
      clientInfo: { cuid: 'C1' },
    } as any);

    expect(data.csvContentBase64).toBe(CSV_BASE64);
    expect(fs.existsSync(localPath)).toBe(false);
  });

  it('keeps non-UTF-8 bytes intact (e.g. Windows-1252 exports from Excel)', async () => {
    const latin1 = Buffer.from([0x43, 0x61, 0x66, 0xe9, 0x0a]); // "Café\n" in Windows-1252
    const localPath = path.join(os.tmpdir(), `latin1_${Date.now()}.csv`);
    fs.writeFileSync(localPath, latin1);

    const data = await attachCsvToJob({ csvFilePath: localPath } as any);

    expect(Buffer.from(data.csvContentBase64!, 'base64')).toEqual(latin1);
  });
});

describe('withCsvFile (worker side)', () => {
  it('gives the handler a temp copy of the CSV, then removes it', async () => {
    let seenPath = '';
    let seenContents = '';
    const handler = jest.fn(async (job: any) => {
      seenPath = job.data.csvFilePath;
      seenContents = fs.readFileSync(seenPath, 'utf8');
      return 'done';
    });
    const job = makeJob({ csvFilePath: '/api-disk/uploads/x.csv', csvContentBase64: CSV_BASE64 });

    const result = await withCsvFile(handler)(job as any);

    expect(result).toBe('done');
    expect(seenPath).not.toBe('/api-disk/uploads/x.csv');
    expect(seenContents).toBe(CSV);
    expect(fs.existsSync(seenPath)).toBe(false);
  });

  it('removes the temp copy even when the handler fails', async () => {
    let seenPath = '';
    const handler = jest.fn(async (job: any) => {
      seenPath = job.data.csvFilePath;
      throw new Error('boom');
    });
    const job = makeJob({ csvFilePath: 'x.csv', csvContentBase64: CSV_BASE64 });

    await expect(withCsvFile(handler)(job as any)).rejects.toThrow('boom');

    expect(fs.existsSync(seenPath)).toBe(false);
  });

  it('runs the handler unchanged for jobs without CSV content', async () => {
    const handler = jest.fn().mockResolvedValue('ok');
    const job = makeJob({ csvFilePath: '/local/x.csv' });

    await withCsvFile(handler)(job as any);

    expect(handler).toHaveBeenCalledWith(job);
  });
});
