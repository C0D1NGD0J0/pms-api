import { Schema, model } from 'mongoose';
import { generateShortUID } from '@utils/index';
import uniqueValidator from 'mongoose-unique-validator';
import { CURRENCIES } from '@interfaces/utils.interface';
import {
  PropertyUnitStatusEnum,
  IPropertyUnitDocument,
  PropertyUnitTypeEnum,
} from '@interfaces/propertyUnit.interface';

const PropertyUnitSchema = new Schema<IPropertyUnitDocument>(
  {
    puid: {
      type: String,
      required: true,
      unique: true,
      index: true,
      immutable: true,
      default: () => generateShortUID(),
    },
    propertyId: {
      type: Schema.Types.ObjectId,
      ref: 'Property',
      required: true,
      index: true,
    },
    cuid: {
      type: String,
      required: true,
      index: true,
    },
    unitNumber: {
      type: String,
      required: [true, 'Unit number is required'],
      trim: true,
    },
    floor: {
      type: Number,
      max: 100,
      min: 1,
      default: 1,
    },
    unitType: {
      type: String,
      enum: Object.values(PropertyUnitTypeEnum),
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(PropertyUnitStatusEnum),
      default: PropertyUnitStatusEnum.AVAILABLE,
      index: true,
    },
    fees: {
      currency: {
        type: String,
        enum: Object.values(CURRENCIES),
        default: 'USD',
      },
      rentAmount: {
        type: Number,
        required: true,
        min: 0,
      },
      securityDeposit: {
        type: Number,
        min: 0,
        default: 0,
      },
    },
    specifications: {
      totalArea: {
        type: Number,
        min: 0,
        required: true,
      },
      rooms: {
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
      trash: { type: Boolean, default: false },
      water: { type: Boolean, default: false },
      heating: { type: Boolean, default: false },
      centralAC: { type: Boolean, default: false },
    },
    amenities: {
      parking: { type: Boolean, default: false },
      cableTV: { type: Boolean, default: false },
      storage: { type: Boolean, default: false },
      internet: { type: Boolean, default: false },
      dishwasher: { type: Boolean, default: false },
      washerDryer: { type: Boolean, default: false },
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
          enum: ['passed', 'failed', 'needs_repair', 'scheduled'],
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
    notes: [
      {
        title: { type: String, required: true },
        content: { type: String, required: true },
        createdAt: { type: Date, default: Date.now },
        createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
      },
    ],
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

PropertyUnitSchema.index({ propertyId: 1, unitNumber: 1 }, { unique: true });
PropertyUnitSchema.index({ cuid: 1, status: 1 });
PropertyUnitSchema.index({ propertyId: 1, floor: 1, unitNumber: 1 }); // For sorted unit queries

PropertyUnitSchema.plugin(uniqueValidator, {
  message: '{PATH} must be unique.',
});

PropertyUnitSchema.virtual('leases', {
  ref: 'Lease',
  localField: '_id',
  foreignField: 'unitId',
});

PropertyUnitSchema.virtual('maintenanceRequests', {
  ref: 'MaintenanceRequest',
  localField: '_id',
  foreignField: 'unitId',
});

PropertyUnitSchema.pre('save', function (this: IPropertyUnitDocument, next) {
  if (this.isModified('inspections') && this.inspections && this.inspections.length > 0) {
    const sortedInspections = [...this.inspections].sort(
      (a, b) => b.inspectionDate.getTime() - a.inspectionDate.getTime()
    );
    this.lastInspectionDate = sortedInspections[0].inspectionDate;
  }
  next();
});

PropertyUnitSchema.methods.calculateRentAdjustment = function (percentage: number) {
  if (percentage < -100) {
    throw new Error('Percentage cannot be less than -100%');
  }

  const oldAmount = this.fees.rentAmount;
  const newAmount = oldAmount * (1 + percentage / 100);

  return {
    oldAmount,
    newAmount,
    difference: newAmount - oldAmount,
    percentageApplied: percentage,
  };
};

PropertyUnitSchema.methods.applyRentAdjustment = async function (
  percentage: number,
  userId: string
) {
  const adjustment = this.calculateRentAdjustment(percentage);
  this.fees.rentAmount = adjustment.newAmount;
  this.lastModifiedBy = userId;
  return this;
};

PropertyUnitSchema.methods.prepareForMaintenance = async function (reason: string, userId: string) {
  this.status = PropertyUnitStatusEnum.MAINTENANCE;
  this.lastModifiedBy = userId;
  if (!this.notes) {
    this.notes = [];
  }
  this.notes.push({
    title: 'Maintenance Required',
    content: reason,
    createdAt: new Date(),
    createdBy: userId,
  });
  return this;
};

PropertyUnitSchema.methods.markUnitAsOccupied = async function (leaseId: string, userId: string) {
  this.status = PropertyUnitStatusEnum.OCCUPIED;
  this.currentLease = leaseId;
  this.lastModifiedBy = userId;
  return this;
};

PropertyUnitSchema.methods.addInspection = async function (inspectionData: any, userId: string) {
  if (!this.inspections) {
    this.inspections = [];
  }
  this.inspections.push(inspectionData);
  this.lastModifiedBy = userId;
  return this;
};

PropertyUnitSchema.methods.makeUnitAvailable = async function (userId: string) {
  this.status = PropertyUnitStatusEnum.AVAILABLE;
  this.currentLease = null;
  this.lastModifiedBy = userId;
  return this;
};

PropertyUnitSchema.methods.markUnitAsVacant = async function (userId: string) {
  this.currentLease = null;
  this.status = PropertyUnitStatusEnum.AVAILABLE;
  this.lastModifiedBy = userId;
  return this;
};

PropertyUnitSchema.methods.softDelete = async function (userId: string) {
  this.status = PropertyUnitStatusEnum.INACTIVE;
  this.isActive = false;
  this.deletedAt = new Date();
  this.lastModifiedBy = userId;
  return this;
};

const PropertyUnitModel = model<IPropertyUnitDocument>('PropertyUnit', PropertyUnitSchema);
PropertyUnitModel.cleanIndexes();
PropertyUnitModel.syncIndexes();

export default PropertyUnitModel;
