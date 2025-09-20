import fs from 'fs';
import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { Upload } from '@aws-sdk/lib-storage';
import { envVariables } from '@shared/config';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ResourceInfo, UploadedFile, UploadResult } from '@interfaces/index';
import {
  DeleteObjectsCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

export class S3Service {
  private readonly s3: S3Client;
  private readonly log: Logger;
  private readonly bucketName = envVariables.AWS.BUCKET_NAME;

  constructor() {
    this.log = createLogger('S3Storage');
    this.s3 = new S3Client({
      region: envVariables.AWS.REGION,
      credentials: {
        accessKeyId: envVariables.AWS.ACCESS_KEY,
        secretAccessKey: envVariables.AWS.SECRET_KEY,
      },
    });
  }

  async uploadFiles(files: UploadedFile[], context: ResourceInfo): Promise<UploadResult[]> {
    this.log.info(`Uploading ${files.length} files to S3 for resource ${context.resourceId}`);
    const results: UploadResult[] = [];

    for (const file of files) {
      try {
        this.log.debug(`Uploading file: ${file.fileName}`);
        const fileStream = fs.createReadStream(file.path);
        const s3Key = `${context.resourceName}_${file.originalFileName || file.fileName}`;

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

        upload.on('httpUploadProgress', (progress) => {
          const percentage =
            progress.total && progress.loaded
              ? Math.round((progress.loaded / progress.total) * 100)
              : 0;
          this.log.debug(`Upload progress for ${file.fileName}: ${percentage}%`);
        });

        const result = await upload.done();
        this.log.info(`Successfully uploaded ${file.fileName} to S3`);

        results.push({
          resourceId: context.resourceId,
          resourceName: context.resourceName,
          url: result.Location!,
          publicuid: context.resourceId,
          key: result.Key!,
          fieldName: file.fieldName.split('.')[0] || file.fieldName,
          filename: file.originalFileName || file.fileName,
          size: file.fileSize,
          mediatype: this.determineMediaType(file.mimeType),
        });
      } catch (error) {
        // Log error but continue with other files
        this.log.error(`Error uploading ${file.fileName} to S3:`, error);
      }
    }

    return results;
  }

  async getSignedUrl(s3Key: string): Promise<string> {
    if (!s3Key) {
      throw new Error('S3 key is required');
    }

    try {
      this.log.debug(`Generating signed URL for ${s3Key}`);

      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
      });

      const url = await getSignedUrl(this.s3, command, {
        expiresIn: 3600, // 1 hour expiration
      });

      return url;
    } catch (error) {
      this.log.error(`Error generating signed URL for ${s3Key}:`, error);
      throw new Error(`Failed to generate signed URL: ${error.message}`);
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
