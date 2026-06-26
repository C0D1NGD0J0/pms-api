import dayjs from 'dayjs';
import { Schema, model } from 'mongoose';
import { generateShortUID } from '@utils/index';
import {
  IGuestPassDocument,
  DeliveryStatusEnum,
  GuestPassStatus,
  DeliveryMethod,
} from '@interfaces/guestPass.interface';

const GuestPassSchema = new Schema<IGuestPassDocument>(
  {
    vpuid: {
      type: String,
      required: true,
      unique: true,
      index: true,
      immutable: true,
      default: () => generateShortUID(),
    },
    cuid: {
      type: String,
      immutable: true,
      required: [true, 'Client ID (cuid) is required'],
      trim: true,
      index: true,
    },
    code: {
      type: String,
      required: [true, 'Access code is required'],
      trim: true,
      minlength: 6,
      maxlength: 6,
    },
    propertyId: {
      type: Schema.Types.ObjectId,
      ref: 'Property',
      required: [true, 'Property is required'],
      index: true,
    },
    propertyUnitId: {
      type: Schema.Types.ObjectId,
      ref: 'PropertyUnit',
    },
    visitorInfo: {
      name: {
        trim: true,
        type: String,
        maxlength: 100,
        required: [true, 'Visitor name is required'],
      },
      phone: {
        type: String,
        trim: true,
      },
      email: {
        trim: true,
        type: String,
        lowercase: true,
      },
      _id: false,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    validUntil: {
      type: Date,
      required: true,
    },
    expiryMinutes: {
      type: Number,
      required: true,
      min: 15,
      max: 60,
      default: 30,
    },
    status: {
      type: String,
      enum: Object.values(GuestPassStatus),
      default: GuestPassStatus.ACTIVE,
      index: true,
    },
    validatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    entryNotes: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    sentVia: {
      type: [{ type: String, enum: Object.values(DeliveryMethod) }],
      default: [],
    },
    deliveryStatus: {
      sms: {
        type: String,
        enum: Object.values(DeliveryStatusEnum),
      },
      email: {
        type: String,
        enum: Object.values(DeliveryStatusEnum),
      },
      _id: false,
    },
    isAcknowledged: {
      type: Boolean,
      default: false,
      index: true,
    },
    acknowledgedAt: Date,
    acknowledgedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    revokedAt: Date,
    revokedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

GuestPassSchema.index({ cuid: 1, propertyId: 1, createdAt: -1 });
GuestPassSchema.index({ cuid: 1, status: 1, validUntil: 1 });
GuestPassSchema.index({ code: 1, cuid: 1, status: 1 });

GuestPassSchema.virtual('isExpired').get(function (this: IGuestPassDocument) {
  return this.validUntil ? dayjs().isAfter(dayjs(this.validUntil)) : false;
});

GuestPassSchema.virtual('minutesRemaining').get(function (this: IGuestPassDocument) {
  if (!this.validUntil) return 0;
  const remaining = dayjs(this.validUntil).diff(dayjs(), 'minute');
  return Math.max(0, remaining);
});

GuestPassSchema.methods.isValid = function (this: IGuestPassDocument): boolean {
  return this.status === GuestPassStatus.ACTIVE && dayjs().isBefore(dayjs(this.validUntil));
};

const GuestPassModel = model<IGuestPassDocument>('GuestPass', GuestPassSchema);
GuestPassModel.syncIndexes();

export default GuestPassModel;
