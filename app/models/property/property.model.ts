import { Schema, model } from 'mongoose';
import uniqueValidator from 'mongoose-unique-validator';
import { generateShortUID, createLogger } from '@utils/index';
import { IPropertyDocument, OwnershipType } from '@interfaces/property.interface';

const logger = createLogger('PropertyModel');

const SpecificationsSchema = new Schema(
  {
    totalArea: {
      type: Number,
      min: 0,
    },
    lotSize: {
      type: Number,
      min: 0,
    },
    bedrooms: {
      type: Number,
      min: 0,
      default: 0,
    },
    bathrooms: {
      type: Number,
      min: 0,
      default: 0,
    },
    floors: {
      type: Number,
      min: 1,
      default: 1,
    },
    garageSpaces: {
      type: Number,
      min: 0,
      default: 0,
    },
    maxOccupants: {
      type: Number,
      min: 1,
    },
  },
  { _id: false, strict: false }
);

const UtilitiesSchema = new Schema(
  {
    water: { type: Boolean, default: false },
    gas: { type: Boolean, default: false },
    electricity: { type: Boolean, default: false },
    internet: { type: Boolean, default: false },
    cableTV: { type: Boolean, default: false },
  },
  { _id: false, strict: false }
);

const InteriorAmenitiesSchema = new Schema(
  {
    airConditioning: { type: Boolean, default: false },
    heating: { type: Boolean, default: false },
    washerDryer: { type: Boolean, default: false },
    dishwasher: { type: Boolean, default: false },
    fridge: { type: Boolean, default: false },
    furnished: { type: Boolean, default: false },
    storageSpace: { type: Boolean, default: false },
  },
  { _id: false, strict: false }
);

const CommunityAmenitiesSchema = new Schema(
  {
    swimmingPool: { type: Boolean, default: false },
    fitnessCenter: { type: Boolean, default: false },
    elevator: { type: Boolean, default: false },
    parking: { type: Boolean, default: false },
    securitySystem: { type: Boolean, default: false },
    laundryFacility: { type: Boolean, default: false },
    petFriendly: { type: Boolean, default: false },
    doorman: { type: Boolean, default: false },
  },
  { _id: false, strict: false }
);

const PropertyOwnerSchema = new Schema(
  {
    type: {
      type: String,
      enum: ['company_owned', 'external_owner', 'self_owned'],
      default: 'company_owned',
    },
    name: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    taxId: { type: String, trim: true },
    notes: { type: String, trim: true, maxlength: 500 },
    bankDetails: {
      accountName: { type: String, trim: true },
      accountNumber: { type: String, trim: true },
      routingNumber: { type: String, trim: true },
      bankName: { type: String, trim: true },
    },
  },
  { _id: false }
);
const PropertyAuthorizationSchema = new Schema(
  {
    isActive: { type: Boolean, default: true },
    documentUrl: { type: String, trim: true },
    expiresAt: { type: Date },
    notes: { type: String, trim: true, maxlength: 500 },
  },
  { _id: false }
);

const PropertySchema = new Schema<IPropertyDocument>(
  {
    pid: {
      type: String,
      required: true,
      unique: true,
      index: true,
      immutable: true,
      default: () => generateShortUID(),
    },
    cuid: {
      index: true,
      type: String,
      required: true,
      immutable: true,
    },
    name: {
      type: String,
      required: [true, 'Property name is required'],
      trim: true,
      index: true,
    },
    propertyType: {
      type: String,
      required: [true, 'Property type is required'],
      default: 'house',
      enum: ['apartment', 'house', 'condominium', 'townhouse', 'commercial', 'industrial'],
      index: true,
    },
    status: {
      type: String,
      enum: ['available', 'occupied', 'maintenance', 'construction', 'inactive'],
      default: 'available',
      index: true,
    },
    managedBy: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: 'User',
      index: true,
    },
    yearBuilt: {
      type: Number,
      min: 1800,
      max: new Date().getFullYear() + 10, // Allow for properties under construction
      validate: {
        validator: function (v: number) {
          return !isNaN(v) && v >= 1800 && v <= new Date().getFullYear() + 10;
        },
        message: (props: any) => `${props.value} is not a valid year!`,
      },
    },
    financialDetails: {
      purchasePrice: {
        type: Number,
        min: 0,
      },
      purchaseDate: {
        type: Date,
      },
      marketValue: {
        type: Number,
        min: 0,
      },
      propertyTax: {
        type: Number,
        min: 0,
      },
      lastAssessmentDate: {
        type: Date,
      },
    },
    fees: {
      currency: { type: String, required: true, default: 'USD' },
      taxAmount: {
        default: 0,
        type: Number,
        get: (val: number) => {
          return (val / 100).toFixed(2);
        },
        set: (val: number) => val * 100,
      },
      rentalAmount: {
        default: 0,
        type: Number,
        get: function (val: number) {
          return (val / 100).toFixed(2);
        },
        set: (val: number) => val * 100,
      },
      managementFees: {
        default: 0,
        type: Number,
        get: (val: number) => {
          return (val / 100).toFixed(2);
        },
        set: (val: number) => val * 100,
      },
      securityDeposit: {
        default: 0,
        type: Number,
        get: (val: number) => {
          return (val / 100).toFixed(2);
        },
        set: (val: number) => val * 100,
      },
    },
    specifications: SpecificationsSchema,
    utilities: UtilitiesSchema,
    description: {
      text: {
        required: true,
        type: String,
        trim: true,
      },
      html: {
        type: String,
        trim: true,
      },
    },
    interiorAmenities: InteriorAmenitiesSchema,
    communityAmenities: CommunityAmenitiesSchema,
    address: {
      street: { type: String },
      country: { type: String },
      postCode: { type: String },
      unitNumber: { type: String },
      streetNumber: { type: String },
      city: { type: String, index: true },
      state: { type: String, index: true },
      fullAddress: { type: String, index: true, required: true },
    },
    computedLocation: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number],
        required: true,
      },
    },
    documents: [
      {
        documentType: {
          type: String,
          enum: ['deed', 'tax', 'insurance', 'inspection', 'other', 'lease'],
        },
        url: {
          type: String,
          validate: {
            validator: function (v: string) {
              // Basic URL validation
              return /^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})([/\w .-]*)*\/?$/.test(v);
            },
            message: (props: any) => `${props.value} is not a valid URL!`,
          },
        },
        key: { type: String },
        status: {
          type: String,
          enum: ['active', 'inactive'], // if inactive it would be deleted via cron job ltr
          default: 'active',
        },
        externalUrl: {
          type: String,
          validate: {
            validator: function (v: string) {
              // Basic URL validation
              return /^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})([/\w .-]*)*\/?$/.test(v);
            },
            message: (props: any) => `${props.value} is not a valid URL!`,
          },
        },
        uploadedAt: { type: Date, default: Date.now },
        uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
        description: { type: String, trim: true, maxlength: 150 },
        documentName: { type: String, trim: true, maxlength: 100 },
      },
    ],
    images: {
      type: [
        {
          url: {
            type: String,
            validate: {
              validator: function (v: string) {
                return /^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})([/\w .-]*)*\/?$/.test(v);
              },
              message: (props: any) => `${props.value} is not a valid URL!`,
            },
          },
          filename: { type: String },
          key: { type: String },
          uploadedAt: { type: Date, default: Date.now },
          uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
        },
      ],
      validate: {
        validator: function (images: any[]) {
          return images.length <= 5;
        },
        message: 'Property cannot have more than 5 images',
      },
      default: [],
    },
    occupancyStatus: {
      type: String,
      enum: ['vacant', 'occupied', 'partially_occupied'],
      default: 'vacant',
    },
    maxAllowedUnits: {
      type: Number,
      min: 0,
      max: 400,
      default: 0,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: 'User',
    },
    lastModifiedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    approvalStatus: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'draft'],
      default: 'pending',
      index: true,
    },
    approvalDetails: [
      {
        action: {
          type: String,
          enum: ['created', 'updated', 'approved', 'rejected'],
          required: true,
        },
        actor: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        timestamp: { type: Date, default: Date.now },
        notes: { type: String, maxlength: 500 },
        rejectionReason: { type: String, maxlength: 500 },
        metadata: { type: Schema.Types.Mixed },
      },
    ],
    pendingChanges: {
      type: Schema.Types.Mixed,
      default: null,
    },
    deletedAt: {
      type: Date,
      default: null,
      index: true,
    },
    owner: {
      type: PropertyOwnerSchema,
      select: false,
    },
    authorization: {
      type: PropertyAuthorizationSchema,
      select: false,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, getters: true },
    toObject: { virtuals: true, getters: true },
  }
);

PropertySchema.index(
  { cuid: 1, address: 1 },
  {
    unique: true,
    partialFilterExpression: { deletedAt: null }, // only non-deleted properties
  }
);

PropertySchema.index({ computedLocation: '2dsphere' });
PropertySchema.plugin(uniqueValidator, {
  message: '{PATH} must be unique.',
});

PropertySchema.virtual('units', {
  ref: 'Unit',
  localField: '_id',
  foreignField: 'propertyId',
});

PropertySchema.virtual('leases', {
  ref: 'Lease',
  localField: '_id',
  foreignField: 'propertyId',
});

PropertySchema.virtual('maintenanceRequests', {
  ref: 'MaintenanceRequest',
  localField: '_id',
  foreignField: 'propertyId',
});

/**
 * Check if property management is authorized
 * For company-owned properties, always returns true
 * For external owners, checks authorization status and expiry
 */
PropertySchema.methods.isManagementAuthorized = function (this: IPropertyDocument): boolean {
  if (this.owner?.type === OwnershipType.COMPANY_OWNED) {
    return true;
  }
  if (!this.authorization || !this.authorization.isActive) {
    return false;
  }

  if (this.authorization.expiresAt && new Date(this.authorization.expiresAt) < new Date()) {
    return false;
  }

  return true;
};

/**
 * Get authorization status with detailed message
 * Useful for user-facing feedback
 */
PropertySchema.methods.getAuthorizationStatus = function (this: IPropertyDocument): {
  isAuthorized: boolean;
  reason?: string;
  daysUntilExpiry?: number;
} {
  // Company-owned properties
  if (this.owner?.type === 'company_owned') {
    return { isAuthorized: true };
  }

  // No authorization record
  if (!this.authorization) {
    return {
      isAuthorized: false,
      reason:
        'No management authorization on file. Upload management agreement to manage this property.',
    };
  }

  // Inactive authorization
  if (!this.authorization.isActive) {
    return {
      isAuthorized: false,
      reason: 'Management authorization is inactive.',
    };
  }

  // Check expiry
  if (this.authorization.expiresAt) {
    const expiryDate = new Date(this.authorization.expiresAt);
    const today = new Date();

    if (expiryDate < today) {
      return {
        isAuthorized: false,
        reason: `Management authorization expired on ${expiryDate.toLocaleDateString()}.`,
      };
    }

    // Calculate days until expiry
    const daysUntilExpiry = Math.ceil(
      (expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
    );

    return {
      isAuthorized: true,
      daysUntilExpiry,
    };
  }

  return { isAuthorized: true };
};

PropertySchema.pre('validate', async function (this: IPropertyDocument, next) {
  if (this.isModified('occupancyStatus')) {
    // add logic to recalculate occupancy based on associated units
  }
  next();
});

// hook to prevent duplicate properties
PropertySchema.pre('validate', async function (next) {
  try {
    // this runs if the address or location has changed, or it's a new property
    if (this.isNew || this.isModified('address') || this.isModified('computedLocation')) {
      const PropertyModel = model<IPropertyDocument>('Property');

      const query = {
        cuid: this.cuid,
        _id: { $ne: this._id },
        deletedAt: null,
      };

      if (this.address && this.address.fullAddress) {
        const addressQuery = await PropertyModel.findOne({
          ...query,
          'address.fullAddress': this.address.fullAddress,
        });

        if (addressQuery) {
          return next(new Error('A property with this address already exists for this client'));
        }
      }

      if (this.computedLocation?.coordinates?.length === 2) {
        const locationQuery = await PropertyModel.findOne({
          ...query,
          'computedLocation.coordinates': this.computedLocation.coordinates,
        });

        if (locationQuery) {
          return next(
            new Error('A property with these coordinates already exists for this client')
          );
        }
      }
    }

    next();
  } catch (error) {
    logger.error('Error in property pre-save hook:', error);
    next(error);
  }
});

const PropertyModel = model<IPropertyDocument>('Property', PropertySchema);
PropertyModel.cleanIndexes();
PropertyModel.syncIndexes();

export default PropertyModel;
