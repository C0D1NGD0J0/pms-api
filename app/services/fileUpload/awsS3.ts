import fs from 'fs';
import path from 'path';
import Logger from 'bunyan';
import { Upload } from '@aws-sdk/lib-storage';
import { envVariables } from '@shared/config';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { CircuitBreaker, createLogger, retryAsync } from '@utils/index';
import { ResourceInfo, UploadedFile, UploadResult } from '@interfaces/index';
import {
  DeleteObjectsCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const PERMANENT_S3_ERRORS = new Set([
  'InvalidObjectState',
  'AccessDenied',
  'NoSuchBucket',
  'NoSuchKey',
]);

const isPermanentS3Error = (err: Error): boolean => {
  const code = (err as any).name ?? (err as any).Code ?? '';
  return PERMANENT_S3_ERRORS.has(code);
};

export class S3Service {
  private readonly s3: S3Client;
  private readonly log: Logger;
  private readonly breaker: CircuitBreaker;
  private readonly bucketName = envVariables.AWS.BUCKET_NAME;

  constructor() {
    this.log = createLogger('S3Storage');
    this.breaker = new CircuitBreaker({
      name: 's3',
      failureThreshold: 5,
      cooldownMs: 45_000,
      isFailure: (err) => !isPermanentS3Error(err),
      logger: this.log,
    });
    this.s3 = new S3Client({
      region: envVariables.AWS.REGION,
      credentials: {
        accessKeyId: envVariables.AWS.ACCESS_KEY,
        secretAccessKey: envVariables.AWS.SECRET_KEY,
      },
      requestHandler: new NodeHttpHandler({
        connectionTimeout: 10_000,
        requestTimeout: 30_000,
      }),
    });
  }

  /**
   * Builds a traceable, subdirectory-scoped S3 key.
   * Pattern: {resourceName}/{resourceId}/{timestamp}_{safeName}.{ext}
   *
   * Examples:
   *   maintenance/MRXYZ123/1748200000000_cracked-pipe.jpg
   *   lease/L2025-LMQ3/1748200000000_lease-agreement.pdf
   *   profile/uid123/1748200000000_avatar.png
   */
  private buildS3Key(file: UploadedFile, context: ResourceInfo): string {
    const originalName = file.originalFileName || file.fileName || 'file';
    const extFromName = path.extname(originalName).replace('.', '').toLowerCase();
    const ext = extFromName || file.mimeType?.split('/')[1]?.toLowerCase() || 'bin';
    const baseName = path.basename(originalName, path.extname(originalName));
    const safeName = baseName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
    return `${context.resourceName}/${safeName}|||${context.resourceId}|||_${Date.now()}.${ext}`;
  }

  async uploadFiles(files: UploadedFile[], context: ResourceInfo): Promise<UploadResult[]> {
    this.log.info(
      {
        fileCount: files.length,
        resourceId: context.resourceId,
        resourceName: context.resourceName,
      },
      `Starting S3 upload for ${files.length} files`
    );
    const results: UploadResult[] = [];

    for (const file of files) {
      try {
        this.log.debug(`Uploading file: ${file.fileName}`);
        const fileStream = fs.createReadStream(file.path);
        const s3Key = this.buildS3Key(file, context);

        const params = {
          Bucket: this.bucketName,
          Key: s3Key,
          Body: fileStream,
          ContentType: file.mimeType,
          Tagging: this.generateResourceTag(context.resourceId),
        };

        const upload = new Upload({
          client: this.s3,
          params,
        });

        upload.on('httpUploadProgress', (progress: { loaded?: number; total?: number }) => {
          const percentage =
            progress.total && progress.loaded
              ? Math.round((progress.loaded / progress.total) * 100)
              : 0;
          this.log.debug(`Upload progress for ${file.fileName}: ${percentage}%`);
        });

        const result = await upload.done();
        this.log.info(`Successfully uploaded ${file.fileName} to S3`);

        const rawMediatype = this.determineMediaType(file.mimeType);
        results.push({
          resourceId: context.resourceId,
          resourceName: context.resourceName,
          url: result.Location!,
          publicuid: context.resourceId,
          key: result.Key!,
          fieldName: file.fieldName.split('.')[0] || file.fieldName,
          filename: file.originalFileName || file.fileName,
          size: file.fileSize,
          mimeType: file.mimeType,
          mediatype: rawMediatype ?? 'document',
        });
      } catch (error) {
        // Log error but continue with other files
        this.log.error(`Error uploading ${file.fileName} to S3:`, error);
      }
    }

    return results;
  }

  async uploadBuffer(
    buffer: Buffer,
    s3Key: string,
    contentType: string,
    resourceId?: string
  ): Promise<{ url: string; key: string }> {
    try {
      this.log.debug(`Uploading buffer to S3: ${s3Key}`);

      const params = {
        Bucket: this.bucketName,
        Key: s3Key,
        Body: buffer,
        ContentType: contentType,
        ...(resourceId && { Tagging: this.generateResourceTag(resourceId) }),
      };

      const upload = new Upload({
        client: this.s3,
        params,
      });

      const result = await upload.done();
      this.log.info(`Successfully uploaded buffer to S3: ${s3Key}`);

      return {
        url: result.Location!,
        key: result.Key!,
      };
    } catch (error) {
      this.log.error('Error uploading buffer to S3:', error);
      throw new Error(
        `Failed to upload buffer: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async getSignedUrl(s3Key: string): Promise<string> {
    if (!s3Key) {
      throw new Error('S3 key is required');
    }

    this.log.debug(`Generating signed URL for ${s3Key}`);

    try {
      return await this.breaker.exec(() =>
        retryAsync(
          async () => {
            const command = new GetObjectCommand({
              Bucket: this.bucketName,
              Key: s3Key,
            });
            return getSignedUrl(this.s3, command, { expiresIn: 3600 });
          },
          {
            attempts: 2,
            backoff: 'fixed',
            delay: 300,
            retryOn: (err) => !isPermanentS3Error(err),
          }
        )
      );
    } catch (error) {
      this.log.error(`Error generating signed URL for ${s3Key}:`, error);
      throw new Error(
        `Failed to generate signed URL: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async getFileBuffer(s3Key: string): Promise<Buffer> {
    if (!s3Key) {
      throw new Error('S3 key is required');
    }

    try {
      const buffer = await this.breaker.exec(() =>
        retryAsync(
          async () => {
            const command = new GetObjectCommand({
              Bucket: this.bucketName,
              Key: s3Key,
            });

            const response = await this.s3.send(command);

            if (!response.Body) {
              throw new Error('Empty response body from S3');
            }

            const chunks: Uint8Array[] = [];
            for await (const chunk of response.Body as any) {
              chunks.push(chunk);
            }
            return Buffer.concat(chunks);
          },
          {
            attempts: 2,
            backoff: 'fixed',
            delay: 500,
            retryOn: (err) => !isPermanentS3Error(err),
          }
        )
      );

      this.log.info(`Downloaded file buffer from S3: ${s3Key}`, { size: buffer.length });
      return buffer;
    } catch (error: any) {
      this.log.error(`Error downloading file buffer from S3: ${s3Key}`, error);
      throw new Error(`Failed to download file from S3: ${error.message}`);
    }
  }

  async deleteFiles(s3Keys: string[]): Promise<boolean> {
    if (!s3Keys || s3Keys.length === 0) {
      return true;
    }
    try {
      this.log.info(`Deleting ${s3Keys.length} files from S3`);
      const objects = s3Keys.map((Key) => ({ Key }));
      const command = new DeleteObjectsCommand({
        Bucket: this.bucketName,
        Delete: {
          Objects: objects,
          Quiet: true, // set to true to receive only errors, not successful deletes
        },
      });
      const result = await this.s3.send(command);
      if (result.Errors && result.Errors.length > 0) {
        this.log.warn(`Failed to delete ${result.Errors.length} objects`);
        return false;
      }

      return true;
    } catch (error) {
      this.log.error('Error performing bulk delete:', error);
      return false;
    }
  }

  async deleteFile(s3Key: string) {
    const s3Params: { Bucket: string; Key: string } = {
      Bucket: this.bucketName,
      Key: s3Key,
    };

    return await this.s3.send(new DeleteObjectCommand(s3Params));
  }

  private generateResourceTag = (resourceId: string) => {
    return `resourceId=${resourceId}`;
  };

  private determineMediaType(mimetype?: string): 'image' | 'video' | 'document' | undefined {
    if (!mimetype) return undefined;

    if (mimetype.startsWith('image/')) return 'image';
    if (mimetype.startsWith('video/')) return 'video';
    if (
      mimetype === 'application/pdf' ||
      mimetype.startsWith('application/') ||
      mimetype.startsWith('text/') ||
      mimetype.includes('document')
    )
      return 'document';

    return undefined;
  }
}
