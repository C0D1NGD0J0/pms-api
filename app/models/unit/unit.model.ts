import { Schema, model } from 'mongoose';
import uniqueValidator from 'mongoose-unique-validator';
import { generateShortUID, createLogger } from '@utils/index';
import {
  InspectionStatusEnum,
  DocumentStatusEnum,
  DocumentTypeEnum,
  PropertyUnitStatusEnum as UnitStatusEnum,
  IPropertyUnitDocument as IUnitDocument,
  PropertyUnitTypeEnum as UnitTypeEnum,
} from '@interfaces/propertyUnit.interface';
const logger = createLogger('UnitModel');

const UnitSchema = new Schema<IUnitDocument>(
  {
    puid: {
      type: String,
      required: true,
      unique: true,
      index: true,
      immutable: true,
      default: () => generateShortUID(12),
    },
    propertyId: {
      type: Schema.Types.ObjectId,
      ref: 'Property',
      required: true,
      index: true,
    },
    cid: {
      type: String,
      required: true,
      index: true,
      immutable: true,
    },
    unitNumber: {
      type: String,
      required: [true, 'Unit number is required'],
      trim: true,
    },
    floor: {
      type: Number,
      max: 100,
      min: -5,
      default: 1,
    },
    status: {
      type: String,
      enum: Object.values(UnitStatusEnum),
      default: UnitStatusEnum.AVAILABLE,
      index: true,
    },
    unitType: {
      type: String,
      enum: Object.values(UnitTypeEnum),
      required: true,
    },
    fees: {
      currency: { type: String, required: true, default: 'USD' },
      rentAmount: {
        type: Number,
        required: true,
        min: 0,
        get: (val: number) => {
          return (val / 100).toFixed(2);
        },
        set: (val: number) => val * 100,
      },
      securityDeposit: {
        type: Number,
        min: 0,
        default: 0,
        get: (val: number) => {
          return (val / 100).toFixed(2);
        },
        set: (val: number) => val * 100,
      },
    },
    specifications: {
      totalArea: {
        type: Number,
        min: 0,
        required: true,
      },
      bedrooms: {
        type: Number,
        min: 0,
        default: 1,
      },
      bathrooms: {
        type: Number,
        min: 0,
        default: 1,
      },
      maxOccupants: {
        type: Number,
        min: 1,
      },
    },
    utilities: {
      gas: { type: Boolean, default: false },
      water: { type: Boolean, default: false },
      electricity: { type: Boolean, default: false },
      trash: { type: Boolean, default: false },
      heating: { type: Boolean, default: false },
      airConditioning: { type: Boolean, default: false },
    },
    amenities: {
      internet: { type: Boolean, default: false },
      washerDryer: { type: Boolean, default: false },
      dishwasher: { type: Boolean, default: false },
      balcony: { type: Boolean, default: false },
      storage: { type: Boolean, default: false },
    },
    description: {
      type: String,
      trim: true,
    },
    media: {
      photos: [
        {
          url: { type: String, required: true },
          filename: { type: String },
          key: { type: String },
          caption: { type: String },
          isPrimary: { type: Boolean, default: false },
          uploadedAt: { type: Date, default: Date.now },
          uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
        },
      ],
    },
    documents: [
      {
        url: { type: String, required: true },
        key: { type: String },
        status: {
          type: String,
          enum: Object.values(DocumentStatusEnum),
          default: DocumentStatusEnum.ACTIVE,
        },
        documentType: {
          type: String,
          enum: Object.values(DocumentTypeEnum),
          required: true,
        },
        externalUrl: { type: String },
        uploadedAt: { type: Date, default: Date.now },
        uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
        description: { type: String },
        documentName: { type: String, maxlength: 100 },
      },
    ],
    inspections: [
      {
        inspectionDate: { type: Date, required: true },
        inspector: {
          name: { type: String, required: true },
          contact: { type: String, required: true },
          company: { type: String },
        },
        status: {
          type: String,
          enum: Object.values(InspectionStatusEnum),
          required: true,
        },
        notes: { type: String },
        attachments: [
          {
            url: { type: String, required: true },
            filename: { type: String, required: true },
            key: { type: String },
            uploadedAt: { type: Date, default: Date.now },
          },
        ],
      },
    ],
    lastInspectionDate: {
      type: Date,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    currentLease: {
      type: Schema.Types.ObjectId,
      ref: 'Lease',
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    lastModifiedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    deletedAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, getters: true },
    toObject: { virtuals: true, getters: true },
  }
);

UnitSchema.index({ propertyId: 1, unitNumber: 1 }, { unique: true });
UnitSchema.index({ cid: 1, status: 1 });

UnitSchema.plugin(uniqueValidator, {
  message: '{PATH} must be unique.',
});

UnitSchema.virtual('leases', {
  ref: 'Lease',
  localField: '_id',
  foreignField: 'unitId',
});

UnitSchema.virtual('maintenanceRequests', {
  ref: 'MaintenanceRequest',
  localField: '_id',
  foreignField: 'unitId',
});

UnitSchema.pre('save', function (this: IUnitDocument, next) {
  if (
    this.isModified('inspections') &&
    this.inspections &&
    Array.isArray(this.inspections) &&
    this.inspections.length > 0
  ) {
    const sortedInspections = this.inspections.sort(
      (a, b) => b.inspectionDate.getTime() - a.inspectionDate.getTime()
    );
    this.lastInspectionDate = sortedInspections[0].inspectionDate;
  }
  next();
});

UnitSchema.methods.softDelete = async function (userId: string) {
  this.status = UnitStatusEnum.INACTIVE;
  this.isActive = false;
  this.deletedAt = new Date();
  this.lastModifiedBy = userId;
  return this;
};

UnitSchema.methods.markUnitAsVacant = async function (userId: string) {
  this.status = UnitStatusEnum.AVAILABLE;
  this.currentLease = null;
  this.lastModifiedBy = userId;
  return this;
};

UnitSchema.methods.markUnitAsOccupied = async function (leaseId: string, userId: string) {
  this.status = UnitStatusEnum.OCCUPIED;
  this.currentLease = leaseId;
  this.lastModifiedBy = userId;
  return this;
};

UnitSchema.methods.prepareForMaintenance = async function (reason: string, userId: string) {
  this.status = UnitStatusEnum.MAINTENANCE;
  this.lastModifiedBy = userId;

  const note = {
    title: 'Maintenance Required',
    content: reason,
    createdAt: new Date(),
    createdBy: userId,
  };

  if (!this.notes) {
    this.notes = [];
  }

  this.notes.push(note);
  return this;
};

UnitSchema.methods.makeUnitAvailable = async function (userId: string) {
  this.status = UnitStatusEnum.AVAILABLE;
  this.lastModifiedBy = userId;
  this.currentLease = null;
  return this;
};

UnitSchema.methods.addInspection = async function (inspectionData: any, userId: string) {
  if (!this.inspections) {
    this.inspections = [];
  }

  const newInspection = {
    ...inspectionData,
    inspectionDate: inspectionData.inspectionDate || new Date(),
  };

  this.inspections.push(newInspection);
  this.lastModifiedBy = userId;
  return this;
};

UnitSchema.methods.calculateRentAdjustment = function (percentage: number) {
  if (percentage <= 0) {
    throw new Error('Adjustment percentage must be positive');
  }

  const currentRent = parseFloat(this.fees.rentAmount);
  const newRent = currentRent * (1 + percentage / 100);

  return {
    oldAmount: currentRent,
    newAmount: newRent,
    difference: newRent - currentRent,
    percentageApplied: percentage,
  };
};

UnitSchema.methods.applyRentAdjustment = async function (percentage: number, userId: string) {
  const adjustment = this.calculateRentAdjustment(percentage);
  this.fees.rentAmount = adjustment.newAmount;
  this.lastModifiedBy = userId;
  return this;
};

UnitSchema.pre('validate', async function (next) {
  try {
    if (this.isNew || this.isModified('propertyId')) {
      const PropertyModel = model('Property');

      const property = await PropertyModel.findOne({
        _id: this.propertyId,
        deletedAt: null,
      });

      if (!property) {
        return next(new Error('Associated property does not exist or has been deleted'));
      }
    }
    next();
  } catch (error) {
    logger.error('Error in unit pre-validate hook:', error);
    next(error);
  }
});

const UnitModel = model<IUnitDocument>('Unit', UnitSchema);
UnitModel.cleanIndexes();
UnitModel.syncIndexes();

export default UnitModel;
