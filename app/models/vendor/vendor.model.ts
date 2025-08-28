import { Schema, model } from 'mongoose';
import { generateShortUID } from '@utils/helpers';
import uniqueValidator from 'mongoose-unique-validator';
import { IVendorDocument } from '@interfaces/vendor.interface';

const VendorSchema = new Schema<IVendorDocument>(
  {
    connectedClients: [
      {
        cuid: {
          type: String,
          required: true,
        },
        isConnected: {
          type: Boolean,
          default: false,
        },
        primaryAccountHolder: {
          type: Schema.Types.ObjectId,
          ref: 'User',
          required: true,
        },
      },
    ],
    companyName: {
      required: true,
      type: String,
      trim: true,
    },
    businessType: {
      required: true,
      type: String,
      trim: true,
    },
    registrationNumber: {
      required: true,
      type: String,
      trim: true,
    },
    taxId: {
      type: String,
      trim: true,
    },
    yearsInBusiness: {
      type: Number,
      min: 0,
    },
    servicesOffered: {
      plumbing: { type: Boolean },
      electrical: { type: Boolean },
      hvac: { type: Boolean },
      cleaning: { type: Boolean },
      landscaping: { type: Boolean },
      painting: { type: Boolean },
      carpentry: { type: Boolean },
      roofing: { type: Boolean },
      security: { type: Boolean },
      pestControl: { type: Boolean },
      applianceRepair: { type: Boolean },
      maintenance: { type: Boolean },
      other: { type: Boolean },
    },
    address: {
      street: { type: String },
      country: { type: String },
      postCode: { type: String },
      unitNumber: { type: String },
      streetNumber: { type: String },
      city: { type: String, index: true },
      state: { type: String, index: true },
      fullAddress: { type: String, index: true },
      computedLocation: {
        type: {
          type: String,
          enum: ['Point'],
          default: 'Point',
        },
        coordinates: {
          type: [Number],
          default: [0, 0],
          validate: {
            validator: function (this: any, v: number[]) {
              const addressDoc = this.parent();
              if (!addressDoc || !addressDoc.fullAddress) {
                return true;
              }
              if (!v || v.length === 0) {
                return true;
              }
              return v.length === 2 && v[0] >= -180 && v[0] <= 180 && v[1] >= -90 && v[1] <= 90;
            },
            message: 'Coordinates must be [longitude, latitude] with valid ranges',
          },
        },
      },
    },
    serviceAreas: {
      baseLocation: {
        address: { type: String },
        coordinates: {
          type: [Number],
          validate: {
            validator: function (v: number[]) {
              if (!v || v.length === 0) return true;
              return v.length === 2 && v[0] >= -180 && v[0] <= 180 && v[1] >= -90 && v[1] <= 90;
            },
            message: 'Base location coordinates must be [longitude, latitude] with valid ranges',
          },
        },
      },
      maxDistance: {
        type: Number,
        enum: [10, 15, 25, 50],
      },
    },
    insuranceInfo: {
      provider: { type: String, trim: true },
      policyNumber: { type: String, trim: true },
      expirationDate: { type: Date },
      coverageAmount: { type: Number, min: 0 },
    },
    contactPerson: {
      name: { type: String, trim: true },
      jobTitle: { type: String, trim: true },
      email: { type: String, trim: true },
      phone: { type: String, trim: true },
      department: { type: String, trim: true },
    },
    vuid: {
      required: true,
      type: String,
      unique: true,
      index: true,
      immutable: true,
      default: () => generateShortUID(),
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

// Indexes
VendorSchema.index({ 'connectedClients.cuid': 1 });
VendorSchema.index({ companyName: 1 });
VendorSchema.index({ registrationNumber: 1 }, { unique: true });
VendorSchema.index({ 'address.city': 1, 'address.state': 1 });

VendorSchema.plugin(uniqueValidator, {
  message: '{PATH} must be unique.',
});

const VendorModel = model<IVendorDocument>('Vendor', VendorSchema);

VendorModel.syncIndexes();

export default VendorModel;
