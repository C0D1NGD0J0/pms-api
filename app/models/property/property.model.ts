import { v4 as uuid } from 'uuid';
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
      default: () => generateShortUID(uuid()),
    },
    cid: {
      type: Schema.Types.ObjectId,
      ref: 'Client',
      required: true,
      index: true,
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
    specifications: {
      totalArea: {
        type: Number,
        min: 0,
        required: true,
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
      trash: { type: Boolean, default: false },
      cableTV: { type: Boolean, default: false },
    },
    description: {
      type: String,
      trim: true,
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
    exteriorAmenities: {
      swimmingPool: { type: Boolean, default: false },
      fitnessCenter: { type: Boolean, default: false },
      elevator: { type: Boolean, default: false },
      balcony: { type: Boolean, default: false },
      parking: { type: Boolean, default: false },
      garden: { type: Boolean, default: false },
      securitySystem: { type: Boolean, default: false },
      playground: { type: Boolean, default: false },
    },
    communityAmenities: {
      petFriendly: { type: Boolean, default: false },
      clubhouse: { type: Boolean, default: false },
      bbqArea: { type: Boolean, default: false },
      laundryFacility: { type: Boolean, default: false },
      doorman: { type: Boolean, default: false },
    },
    address: {
      type: String,
      required: true,
      index: true,
      validate: {
        validator: function (v: string) {
          return Boolean(v && v.length > 10);
        },
        message: (props) => `${props.value} is not a valid address!`,
      },
    },
    computedLocation: {
      type: { type: String, default: 'Point' },
      coordinates: [Number],
      address: {
        street: { type: String },
        city: { type: String },
        state: { type: String },
        country: { type: String },
        postCode: { type: String },
        streetNumber: { type: String },
      },
      latAndlon: {
        type: String,
        select: false,
        index: true,
      },
    },
    documents: [
      {
        photos: [
          {
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
            filename: { type: String },
            key: { type: String },
            caption: { type: String },
            isPrimary: { type: Boolean, default: false },
            uploadedAt: { type: Date, default: Date.now },
            uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
          },
        ],
        documentType: {
          type: String,
          enum: ['deed', 'tax', 'insurance', 'inspection', 'other', 'lease'],
        },
        description: { type: String },
        uploadedAt: { type: Date, default: Date.now },
        uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      },
    ],
    occupancyStatus: {
      type: String,
      enum: ['vacant', 'occupied', 'partially_occupied'],
      default: 'vacant',
    },
    occupancyRate: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
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

PropertySchema.index(
  { cid: 1, address: 1 },
  {
    unique: true,
    partialFilterExpression: { deletedAt: null }, // only non-deleted properties
  }
);

PropertySchema.index(
  { cid: 1, 'computedLocation.latAndlon': 1 },
  {
    unique: true,
    partialFilterExpression: {
      deletedAt: null,
      'computedLocation.latAndlon': { $exists: true },
    },
  }
);

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
PropertySchema.pre('save', async function (next) {
  try {
    // this runs if the address or location has changed, or it's a new property
    if (this.isNew || this.isModified('address') || this.isModified('computedLocation.latAndlon')) {
      const PropertyModel = this.constructor as any;

      // Check for existing properties with same address or coordinates for this client
      const duplicateCheck = await PropertyModel.findOne({
        cid: this.cid,
        $or: [
          { address: this.address },
          { 'computedLocation.latAndlon': this.computedLocation?.latAndlon },
        ],
        _id: { $ne: this._id }, // Exclude this document if it's an update
        deletedAt: null,
      });

      if (duplicateCheck) {
        const error = new Error('A property with this address already exists for this client');
        return next(error);
      }
    }

    next();
  } catch (error) {
    logger.error('Error in property pre-save hook:', error);
    next(error);
  }
});

const PropertyModel = model<IPropertyDocument>('Property', PropertySchema);

PropertyModel.syncIndexes();

export default PropertyModel;
