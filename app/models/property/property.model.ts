import { Schema, model } from 'mongoose';
import uniqueValidator from 'mongoose-unique-validator';
import { generateShortUID, createLogger } from '@utils/index';
import { IPropertyDocument } from '@interfaces/property.interface';

const logger = createLogger('PropertyModel');

const PropertySchema = new Schema<IPropertyDocument>(
  {
    pid: {
      type: String,
      required: true,
      unique: true,
      index: true,
      immutable: true,
      default: () => generateShortUID(12),
    },
    cid: {
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
        message: (props) => `${props.value} is not a valid year!`,
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
    specifications: {
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
    utilities: {
      water: { type: Boolean, default: false },
      gas: { type: Boolean, default: false },
      electricity: { type: Boolean, default: false },
      internet: { type: Boolean, default: false },
      cableTV: { type: Boolean, default: false },
    },
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
    interiorAmenities: {
      airConditioning: { type: Boolean, default: false },
      heating: { type: Boolean, default: false },
      washerDryer: { type: Boolean, default: false },
      dishwasher: { type: Boolean, default: false },
      fridge: { type: Boolean, default: false },
      furnished: { type: Boolean, default: false },
      storageSpace: { type: Boolean, default: false },
    },
    communityAmenities: {
      swimmingPool: { type: Boolean, default: false },
      fitnessCenter: { type: Boolean, default: false },
      elevator: { type: Boolean, default: false },
      parking: { type: Boolean, default: false },
      securitySystem: { type: Boolean, default: false },
      laundryFacility: { type: Boolean, default: false },
      petFriendly: { type: Boolean, default: false },
      doorman: { type: Boolean, default: false },
    },
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

PropertySchema.index(
  { cid: 1, address: 1 },
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
        cid: this.cid,
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
