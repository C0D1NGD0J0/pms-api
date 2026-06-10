import fs from 'fs';
import path from 'path';
import multer from 'multer';
import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { fromFile as fileTypeFromFile } from 'file-type';
import { NextFunction, Response, Request } from 'express';
import { BadRequestError, NotFoundError } from '@shared/customErrors';

const MIME_ALLOWLIST: Record<string, string[]> = {
  jpeg: ['image/jpeg'],
  jpg: ['image/jpeg', 'image/jpg'],
  png: ['image/png'],
  webp: ['image/webp'],
  heic: ['image/heic', 'image/heif'],
  pdf: ['application/pdf'],
  mp4: ['video/mp4'],
  mov: ['video/quicktime'],
  webm: ['video/webm'],
  csv: ['text/csv', 'application/csv', 'text/plain'],
};

interface FieldSizeConfig {
  fileTypes?: string[];
  maxCount: number;
  maxSize: number; // Size in bytes
  name: string;
}

export class DiskStorage {
  private readonly log: Logger = createLogger('DiskStorage');
  private readonly storagePath = 'uploads/';
  private readonly allowedExtensions = [
    'jpeg',
    'jpg',
    'png',
    'webp',
    'heic',
    'pdf',
    'mp4',
    'mov',
    'webm',
    'csv',
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
      name: 'videos',
      maxCount: 1,
      maxSize: 100 * 1024 * 1024, // 100MB
      fileTypes: ['mp4', 'mov'],
    },
    {
      name: 'csv_file',
      maxCount: 1,
      maxSize: 10 * 1024 * 1024, // 10MB
      fileTypes: ['csv'],
    },
    {
      name: 'documents.items[*].file', // Wildcard pattern for documents
      maxCount: 1,
      maxSize: 20 * 1024 * 1024, // 20MB
      fileTypes: ['pdf', 'jpeg', 'jpg', 'png'],
    },
    {
      name: 'documents[*].file', // Property documents pattern
      maxCount: 10,
      maxSize: 10 * 1024 * 1024, // 10MB
      fileTypes: ['pdf', 'jpeg', 'jpg', 'png'],
    },
    {
      name: 'images[*].file', // Property images pattern
      maxCount: 5,
      maxSize: 5 * 1024 * 1024, // 5MB
      fileTypes: ['jpeg', 'jpg', 'png'],
    },
    {
      name: 'propertyImages[*].file', // Property images pattern (alternative naming)
      maxCount: 5,
      maxSize: 5 * 1024 * 1024, // 5MB
      fileTypes: ['jpeg', 'jpg', 'png'],
    },
    {
      name: 'personalInfo.avatar.file',
      maxCount: 1,
      maxSize: 3 * 1024 * 1024, // 3MB
      fileTypes: ['jpeg', 'jpg', 'png'],
    },
    {
      name: 'leaseDocument[*].file',
      maxCount: 10,
      maxSize: 10 * 1024 * 1024, // 10MB
      fileTypes: ['pdf'],
    },
    {
      name: 'media[*][file]', // Maintenance request media (photos/videos of the issue)
      maxCount: 9, // up to 8 images + 1 video (matches frontend MAX_IMAGES + 1 video slot)
      maxSize: 150 * 1024 * 1024, // 150MB — matches frontend video limit; image size enforced at service layer
      fileTypes: ['jpeg', 'jpg', 'png', 'webp', 'heic', 'mp4', 'mov', 'webm'],
    },
    {
      name: 'invoice', // AI invoice scanning — single image or PDF
      maxCount: 1,
      maxSize: 10 * 1024 * 1024, // 10MB
      fileTypes: ['jpeg', 'jpg', 'png', 'webp', 'pdf'],
    },
  ];

  constructor() {
    const uploadDir = path.join(process.cwd(), this.storagePath);
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    this.log.debug(`DiskStorage initialized. Path: ${this.storagePath}`);
  }

  uploadMiddleware = (fieldPatterns: string[]) => {
    const matchedConfigs = fieldPatterns.map((p) =>
      this.fieldConfigs.find(
        (c) => c.name === p || this.matchesPattern(p, c.name) || this.matchesPattern(c.name, p)
      )
    );
    const maxFileSizeForPatterns = matchedConfigs.reduce<number | null>((max, c) => {
      if (!c) return max;
      return max === null ? c.maxSize : Math.max(max, c.maxSize);
    }, null);

    // Build a closure-scoped filter so the singleton has no per-request mutable state.
    const fieldFilter = this.buildFieldFilter(fieldPatterns);

    const upload = multer({
      storage: this.createDiskStorage(),
      fileFilter: fieldFilter,
      ...(maxFileSizeForPatterns !== null && { limits: { fileSize: maxFileSizeForPatterns } }),
    });

    return (req: Request, res: Response, next: NextFunction): void => {
      const fieldsArray = this.buildFieldsArray(fieldPatterns);

      const handler = fieldsArray.length > 0 ? upload.fields(fieldsArray) : upload.none();

      handler(req, res, (err: any) => {
        if (err) {
          let errorMessage = 'File upload error';
          const statusCode = 400;

          if (err instanceof multer.MulterError) {
            switch (err.code) {
              case 'LIMIT_UNEXPECTED_FILE':
                errorMessage =
                  'One or more files could not be uploaded. Please check the file type and try again.';
                break;
              case 'LIMIT_FILE_COUNT':
                errorMessage =
                  'Too many files uploaded. Please reduce the number of files and try again.';
                break;
              case 'LIMIT_FILE_SIZE':
                errorMessage =
                  'One or more files exceeds the maximum allowed size. Please use smaller files.';
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

  validateMagicBytes = () => {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      const files = req.files;
      if (!files) return next();

      const fileList: Express.Multer.File[] = Array.isArray(files)
        ? files
        : Object.values(files).flat();

      const invalidFiles: string[] = [];

      for (const file of fileList) {
        const declaredExt = path.extname(file.originalname).replace('.', '').toLowerCase();
        const allowedMimes = MIME_ALLOWLIST[declaredExt] ?? [];

        let detectedType: { mime: string } | undefined;
        try {
          detectedType = await fileTypeFromFile(file.path);
        } catch {
          invalidFiles.push(file.originalname);
          await fs.promises.unlink(file.path).catch(() => {});
          continue;
        }

        if (!detectedType) {
          const isTextFormat = ['csv', 'txt'].includes(declaredExt);
          if (!isTextFormat) {
            invalidFiles.push(file.originalname);
            await fs.promises.unlink(file.path).catch(() => {});
          }
          continue;
        }

        if (!allowedMimes.includes(detectedType.mime)) {
          this.log.warn(
            `Magic byte mismatch for ${file.originalname}: declared=${file.mimetype}, detected=${detectedType.mime}`
          );
          invalidFiles.push(file.originalname);
          await fs.promises.unlink(file.path).catch(() => {});
        }
      }

      if (invalidFiles.length > 0) {
        return next(
          new BadRequestError({
            message: `Invalid file type detected: ${invalidFiles.join(', ')}`,
            statusCode: 400,
          })
        );
      }

      next();
    };
  };

  private buildFieldsArray(patterns: string[]): multer.Field[] {
    const fields: multer.Field[] = [];

    for (const pattern of patterns) {
      const matchingConfig = this.fieldConfigs.find(
        (config) =>
          config.name === pattern ||
          this.matchesPattern(pattern, config.name) ||
          this.matchesPattern(config.name, pattern)
      );

      if (matchingConfig) {
        if (pattern.includes('[*]')) {
          // Expand wildcard pattern into multiple specific field entries
          for (let i = 0; i < matchingConfig.maxCount; i++) {
            const specificFieldName = pattern.replace('[*]', `[${i}]`);
            fields.push({
              name: specificFieldName,
              maxCount: 1, // Each specific field can only accept 1 file
            });
          }
        } else {
          // Non-wildcard pattern - keep existing behavior
          fields.push({
            name: pattern,
            maxCount: matchingConfig.maxCount,
          });
        }
      } else {
        this.log.warn(`No config found for pattern "${pattern}", using defaults`);
        // Check if unknown pattern is wildcard - expand with default maxCount
        if (pattern.includes('[*]')) {
          const specificFieldName = pattern.replace('[*]', '[0]');
          fields.push({
            name: specificFieldName,
            maxCount: 1,
          });
        } else {
          fields.push({
            name: pattern,
            maxCount: 1,
          });
        }
      }
    }

    return fields;
  }

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
        // Handle both absolute paths and relative filenames
        const filePath = path.isAbsolute(filename)
          ? filename
          : path.join(this.storagePath, filename);
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
        // Strip directory traversal sequences and whittle down to safe characters
        // before using the client-supplied name in a filesystem path.
        const safeName = path
          .basename(file.originalname)
          .replace(/[^a-zA-Z0-9._-]/g, '_')
          .slice(0, 200); // cap total length
        cb(null, `${timestamp}_${safeName}`);
      },
    });
  }

  private buildFieldFilter(fieldPatterns: string[]): multer.Options['fileFilter'] {
    return (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
      const isAllowedField = fieldPatterns.some((pattern) =>
        this.matchesPattern(file.fieldname, pattern)
      );

      if (!isAllowedField) {
        cb(new Error(`Unexpected field: ${file.fieldname}`));
        return;
      }

      const fileExt = path.extname(file.originalname).replace('.', '').toLowerCase();
      if (!fileExt || !this.allowedExtensions.includes(fileExt)) {
        cb(
          new Error(`File type not supported. Allowed types: ${this.allowedExtensions.join(', ')}`)
        );
        return;
      }

      const fieldConfig = this.fieldConfigs.find(
        (config) =>
          config.name === file.fieldname || this.matchesPattern(file.fieldname, config.name)
      );

      if (fieldConfig?.fileTypes?.length && !fieldConfig.fileTypes.includes(fileExt)) {
        cb(
          new Error(
            `For field "${file.fieldname}", only these file types are allowed: ${fieldConfig.fileTypes.join(', ')}`
          )
        );
        return;
      }

      cb(null, true);
    };
  }

  private matchesPattern(fieldName: string, pattern: string): boolean {
    if (fieldName === pattern) return true;

    // convert pattern to regex, escape regex meta-characters, then replace [*] with [\d+]
    const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let regexPattern = escapeRegExp(pattern);
    // after escaping, [*] becomes \[\*\], so we need to replace \[\*\] with \[\d+\]
    regexPattern = regexPattern.replace(/\\\[\\\*\\\]/g, '\\[\\d+\\]');

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(fieldName);
  }
}
