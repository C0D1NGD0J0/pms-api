import { Schema, model } from 'mongoose';
import { IClientDocument } from '@interfaces/index';
import uniqueValidator from 'mongoose-unique-validator';
import { CURRENCIES } from '@interfaces/utils.interface';

const ClientSchema = new Schema<IClientDocument>(
  {
    cid: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    accountType: {
      planId: { type: String, required: true },
      planName: { type: String, required: true },
      isEnterpriseAccount: { type: Boolean, default: false },
    },
    identification: {
      idType: {
        type: String,
        enum: ['passport', 'drivers-license', 'national-id', 'corporation-license'],
        required: function (this: IClientDocument) {
          if (this.isNew) return false;
          return this.isModified('accountType.identification');
        },
      },
      issueDate: {
        type: Date,
        required: function (this: IClientDocument) {
          if (this.isNew) return false;
          return this.isModified('accountType.issueDate');
        },
      },
      expiryDate: {
        type: Date,
        required: function (this: IClientDocument) {
          if (this.isNew) return false;
          return this.isModified('accountType.expiryDate');
        },
      },
      idNumber: {
        type: String,
        trim: true,
        required: function (this: IClientDocument) {
          if (this.isNew) return false;
          return this.isModified('accountType.idNumber');
        },
      },
      authority: { type: String, trim: true },
      issuingState: {
        type: String,
        trim: true,
        required: function (this: IClientDocument) {
          if (this.isNew) return false;
          return this.isModified('accountType.issuingState');
        },
      },
      name: { type: String, default: 'individual', enum: ['individual', 'corporate'] },
    },
    subscription: {
      type: Schema.Types.ObjectId,
      ref: 'Subscription',
    },
    isVerified: { type: Boolean, default: false },
    accountAdmin: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    companyInfo: {
      legalEntityName: { type: String, trim: true },
      tradingName: { type: String, trim: true },
      businessType: { type: String, trim: true },
      registrationNumber: { type: String, trim: true },
      yearEstablished: { type: Number },
      industry: { type: String, trim: true },
      website: { type: String, trim: true },
      contactInfo: {
        email: { type: String, trim: true },
        address: { type: String, trim: true },
        phoneNumber: { type: String, trim: true },
        contactPerson: { type: String, trim: true },
      },
    },
    settings: {
      notificationPreferences: {
        email: { type: Boolean, default: true },
        sms: { type: Boolean, default: false },
        inApp: { type: Boolean, default: true },
      },
      timeZone: { type: String, default: 'UTC' },
      lang: { type: String, default: 'en' },
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, getters: true },
    toObject: { virtuals: true, getters: true },
  }
);

// Indexes for performance
ClientSchema.index({ admin: 1 });
ClientSchema.index({ active: 1 });
ClientSchema.index({ 'contactInfo.primaryEmail': 1 });

ClientSchema.plugin(uniqueValidator, {
  message: '{PATH} must be unique.',
});

ClientSchema.pre('validate', function (next) {
  if (this.isNew) return next();

  // Check if identification is being updated partially
  if (this.isModified('identification')) {
    const identification = this.identification;

    // If identification object exists and any field is provided, require all fields
    if (identification && Object.values(identification).some((value) => value !== undefined)) {
      const requiredFields = [
        'idType',
        'issueDate',
        'expiryDate',
        'idNumber',
        'authority',
        'issuingState',
      ];

      // Check if any required field is missing
      const missingFields = requiredFields.filter(
        (field) => !identification[field as keyof typeof identification]
      );

      if (missingFields.length > 0) {
        return next(
          new Error(`Missing required identification fields: ${missingFields.join(', ')}`)
        );
      }
    }
  }

  next();
});

ClientSchema.path('identification.expiryDate').validate(function (expiryDate) {
  if (this.identification?.issueDate && expiryDate) {
    return expiryDate > this.identification?.issueDate;
  }
  return true; // if no date is set, skip validation
}, 'Expiry date must be after issue date');

const ClientModel = model<IClientDocument>('Client', ClientSchema);

ClientModel.syncIndexes();

export default ClientModel;
