import { Document, Schema, model } from 'mongoose';

export interface IAssetDocument extends Document {
  resource: {
    name: string; // 'User', 'Property', etc. (was resourceType)
    id: string; // (was resourceId)
  };
  s3Info: {
    url: string;
    filename: string;
    key: string;
  };
  type: 'image' | 'video' | 'document';
  status: 'active' | 'deleted';
  originalName: string;
  uploadedBy: string;
  fieldName: string; // 'avatar', 'documents', 'photos', etc.
  deletedAt?: Date;
  mimeType: string;
  createdAt: Date;
  updatedAt: Date;
  size: number;
}

const AssetSchema = new Schema<IAssetDocument>(
  {
    originalName: {
      type: String,
      required: [true, 'Original file name is required'],
      trim: true,
      maxlength: 255,
    },
    s3Info: {
      url: {
        type: String,
        required: [true, 'File URL is required'],
        trim: true,
      },
      filename: {
        type: String,
        required: [true, 'File name is required'],
        trim: true,
        maxlength: 255,
      },
      key: {
        type: String,
        required: [true, 'S3 key is required'],
        trim: true,
        index: true,
      },
    },
    resource: {
      name: {
        type: String,
        required: [true, 'Resource type is required'],
        trim: true,
        index: true,
      },
      id: {
        type: String,
        required: [true, 'Resource ID is required'],
        trim: true,
        index: true,
      },
    },
    size: {
      type: Number,
      required: [true, 'File size is required'],
      min: 0,
    },
    mimeType: {
      type: String,
      required: [true, 'MIME type is required'],
      trim: true,
      lowercase: true,
    },
    type: {
      type: String,
      required: [true, 'File type is required'],
      enum: ['image', 'video', 'document'],
      index: true,
    },
    fieldName: {
      type: String,
      required: [true, 'Field name is required'],
      trim: true,
    },
    uploadedBy: {
      type: String,
      required: [true, 'Uploaded by user ID is required'],
      trim: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['active', 'deleted'],
      default: 'active',
      index: true,
    },
    deletedAt: {
      type: Date,
      default: null,
      select: false,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

AssetSchema.index({ 'resource.name': 1, 'resource.id': 1, status: 1 });
AssetSchema.index({ uploadedBy: 1, status: 1 });
AssetSchema.index({ 's3Info.key': 1 });

const AssetModel = model<IAssetDocument>('Asset', AssetSchema);

AssetModel.syncIndexes();

export default AssetModel;
