import fs from 'fs';
import path from 'path';
import multer from 'multer';
import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { NextFunction, Request, Response } from 'express';
import { NotFoundError, BadRequestError } from '@shared/customErrors';

export class DiskStorage {
  private readonly upload: multer.Multer;
  private readonly log: Logger;
  private readonly storagePath = 'uploads/';
  private readonly allowedExtensions = [
    'jpeg',
    'jpg',
    'png',
    'svg',
    'pdf',
    'mp4',
    'avi',
    'mov',
    'x-matroska',
  ];
  private readonly fields = [{ name: 'document.photos', maxCount: 10 }];

  constructor() {
    this.log = createLogger('DiskStorage');
    const uploadDir = path.join(process.cwd(), this.storagePath);
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    this.upload = multer({
      storage: this.createDiskStorage(),
      fileFilter: this.fileFilter,
      limits: {
        fileSize: 50 * 1024 * 1024, // 50MB default
      },
    });

    this.log.info(`DiskStorage initialized. Path: ${this.storagePath}`);
  }

  uploadMiddleware = (req: Request, res: Response, next: NextFunction): void => {
    this.log.debug('Processing file upload');
    const upload = this.upload.fields(this.fields);

    upload(req, res, (err) => {
      if (err) {
        let errorMessage = 'File upload error';
        let statusCode = 400;

        if (err instanceof multer.MulterError) {
          switch (err.code) {
            case 'LIMIT_FILE_SIZE':
              errorMessage = `File size exceeds limit`;
              break;
            case 'LIMIT_FILE_COUNT':
              errorMessage = 'Too many files uploaded';
              break;
            case 'LIMIT_UNEXPECTED_FILE':
              errorMessage = `Unexpected field: ${err.field}`;
              break;
            default:
              errorMessage = err.message;
          }
        } else if (err instanceof Error) {
          errorMessage = err.message;
        }

        this.log.error(`Upload error: ${errorMessage}`);
        return next(new BadRequestError({ message: errorMessage, statusCode }));
      }

      this.log.debug('File upload processed successfully');
      next();
    });
  };

  async getFile(filename: string): Promise<Buffer> {
    const filePath = path.join(process.cwd(), this.storagePath, filename);

    try {
      return await fs.promises.readFile(filePath);
    } catch (err) {
      this.log.error(`Error reading file ${filePath}:`, err);
      throw new NotFoundError({ message: `File ${filename} not found` });
    }
  }

  async deleteFiles(filenames: string[]): Promise<boolean> {
    if (!filenames || filenames.length === 0) {
      return true;
    }

    this.log.debug(`Deleting ${filenames.length} files from disk`);
    let allSuccessful = true;

    for (const filename of filenames) {
      try {
        const filePath = path.join(process.cwd(), this.storagePath, filename);

        await fs.promises.access(filePath, fs.constants.F_OK);
        await fs.promises.unlink(filePath);
        this.log.debug(`Deleted file: ${filePath}`);
      } catch (err) {
        this.log.warn(`Failed to delete file ${filename}:`, err);
        allSuccessful = false;
      }
    }

    return allSuccessful;
  }

  getFilePath(filename: string): string {
    return path.join(process.cwd(), this.storagePath, filename);
  }

  private createDiskStorage(): multer.StorageEngine {
    return multer.diskStorage({
      destination: (req, file, cb) => {
        const uploadDir = path.join(process.cwd(), this.storagePath);
        cb(null, uploadDir);
      },
      filename: (req, file, cb) => {
        const timestamp = Date.now();
        const fileName = `${timestamp}_${file.originalname}`;

        cb(null, fileName);
      },
    });
  }

  private fileFilter = (
    req: Request,
    file: Express.Multer.File,
    cb: multer.FileFilterCallback
  ): void => {
    const fileExt = file.mimetype.split('/')[1]?.toLowerCase();

    if (!fileExt || !this.allowedExtensions.includes(fileExt)) {
      this.log.warn(`Rejected file with extension: ${fileExt}`);
      cb(new Error(`File type not supported. Allowed types: ${this.allowedExtensions.join(', ')}`));
      return;
    }

    cb(null, true);
  };
}
