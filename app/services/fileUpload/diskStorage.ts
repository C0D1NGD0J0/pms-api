import fs from 'fs';
import path from 'path';
import multer from 'multer';
import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { NextFunction, Response, Request } from 'express';
import { BadRequestError, NotFoundError } from '@shared/customErrors';

interface FieldSizeConfig {
  fileTypes?: string[]; // Optional array of file extensions
  maxCount: number;
  maxSize: number; // Size in bytes
  name: string;
}

export class DiskStorage {
  private readonly log: Logger = createLogger('DiskStorage');
  private upload: multer.Multer;
  private readonly storagePath = 'uploads/';
  private readonly allowedExtensions = [
    'jpeg',
    'jpg',
    'png',
    'svg',
    'pdf',
    'mp4',
    'avi',
    'csv',
    'mov',
    'x-matroska',
  ];
  private fieldConfigs: FieldSizeConfig[] = [
    {
      name: 'profile_image',
      maxCount: 1,
      maxSize: 5 * 1024 * 1024, // 5MB
      fileTypes: ['jpeg', 'jpg', 'png'],
    },
    {
      name: 'documents',
      maxCount: 1,
      maxSize: 20 * 1024 * 1024, // 20MB
      fileTypes: ['pdf'],
    },
    {
      name: 'images',
      maxCount: 5,
      maxSize: 10 * 1024 * 1024, // 10MB
      fileTypes: ['jpeg', 'jpg', 'png'],
    },
    {
      name: 'videos',
      maxCount: 1,
      maxSize: 100 * 1024 * 1024, // 60MB
      fileTypes: ['mp4', 'avi', 'mov'],
    },
    {
      name: 'csv_file',
      maxCount: 1,
      maxSize: 10 * 1024 * 1024, // 10MB
      fileTypes: ['csv'],
    },
    {
      name: 'document.photos',
      maxCount: 5,
      maxSize: 15 * 1024 * 1024, // 15MB
      fileTypes: ['jpeg', 'jpg', 'png', 'pdf'],
    },
  ];

  constructor() {
    const uploadDir = path.join(process.cwd(), this.storagePath);
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    this.log.info(`DiskStorage initialized. Path: ${this.storagePath}`);
  }

  uploadMiddleware = (fieldNames: string[]) => {
    const fieldsToUse = fieldNames
      ? this.fieldConfigs.filter((config) => fieldNames.includes(config.name))
      : null;

    // convert to multer field format
    const multerFields = fieldsToUse?.map((config) => ({
      name: config.name,
      maxCount: config.maxCount,
    }));

    this.upload = multer({
      storage: this.createDiskStorage(),
      fileFilter: this.fieldSpecificFilter,
    });
    return (req: Request, res: Response, next: NextFunction): void => {
      const upload = this.upload.fields(multerFields || []);
      upload(req, res, (err) => {
        if (err) {
          let errorMessage = 'File upload error';
          const statusCode = 400;

          if (err instanceof multer.MulterError) {
            switch (err.code) {
              case 'LIMIT_UNEXPECTED_FILE':
                errorMessage = `Unexpected field: ${err.field}`;
                break;
              case 'LIMIT_FILE_COUNT':
                errorMessage = 'Too many files uploaded';
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
        next();
      });
    };
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

  deleteFiles = async (filenames: string[]): Promise<boolean> => {
    if (!filenames || filenames.length === 0) {
      return true;
    }

    let allSuccessful = true;
    for (const filename of filenames) {
      try {
        const filePath = path.join(this.storagePath, filename);
        await fs.promises.unlink(filePath);
      } catch (err: any) {
        if (err.code === 'ENOENT') {
          // file doesn't exist
          this.log.debug(`File ${filename} doesn't exist, skipping deletion`);
        } else {
          this.log.warn(`Failed to delete file ${filename}:`, err);
          allSuccessful = false;
        }
      }
    }

    if (allSuccessful) {
      this.log.info(`Successfully deleted ${filenames.length} files`);
    }
    return allSuccessful;
  };

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

  private fieldSpecificFilter = (
    req: Request,
    file: Express.Multer.File,
    cb: multer.FileFilterCallback
  ) => {
    // if the file type is allowed
    const fileExt = file.mimetype.split('/')[1]?.toLowerCase();
    if (!fileExt || !this.allowedExtensions.includes(fileExt)) {
      cb(new Error(`File type not supported. Allowed types: ${this.allowedExtensions.join(', ')}`));
      return;
    }
    const fieldConfig = this.fieldConfigs.find((config) => config.name === file.fieldname) || false;

    // validate file type for field
    if (fieldConfig && fieldConfig.fileTypes && fieldConfig.fileTypes.length > 0) {
      if (!fieldConfig.fileTypes.includes(fileExt)) {
        cb(
          new Error(
            `For field "${file.fieldname}", only these file types are allowed: ${fieldConfig.fileTypes.join(', ')}`
          )
        );
        return;
      }
    }

    // validate file size for field
    if (fieldConfig && fieldConfig.maxSize && file.size > fieldConfig.maxSize) {
      this.log.warn(`${file.originalname} exceeds size limit for ${file.fieldname}`);
      return cb(
        new BadRequestError({
          message: `${file.originalname} exceeds max allowed size of ${Math.round(fieldConfig.maxSize / (1024 * 1024))}MB for field "${file.fieldname}"`,
          statusCode: 400,
        })
      );
    }

    cb(null, true);
  };
}
