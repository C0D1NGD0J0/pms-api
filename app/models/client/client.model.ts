import Zod from 'zod';
import { Schema, model } from 'mongoose';
import { isValidPhoneNumber } from '@utils/index';
import { IClientDocument } from '@interfaces/index';
import uniqueValidator from 'mongoose-unique-validator';

const ClientSchema = new Schema<IClientDocument>(
  {
    cuid: {
      type: String,
      required: true,
      unique: true,
      index: true,
      immutable: true,
    },
    accountType: {
      category: {
        type: String,
        enum: ['business', 'individual'],
        required: true,
        index: true,
      },
      isEnterpriseAccount: {
        type: Boolean,
        default: false,
      },
    },
    dataProcessingConsent: {
      type: Boolean,
      default: false,
    },
    identityVerification: {
      sessionId: { type: String, select: false },
      sessionStatus: { type: String, enum: ['requires_input', 'stripe_verified'] },
      documentType: { type: String },
      issuingCountry: { type: String },
      expiryDate: { type: Date },
      verifiedBy: {
        type: Schema.Types.ObjectId,
        ref: 'User',
      },
      verifiedAt: {
        type: Date,
        default: null,
      },
    },
    subscription: {
      type: Schema.Types.ObjectId,
      ref: 'Subscription',
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    accountAdmin: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    displayName: {
      type: String,
      trim: true,
    },
    companyProfile: {
      legalEntityName: {
        type: String,
        trim: true,
        index: true,
        required: function (this: IClientDocument) {
          return this.accountType?.isEnterpriseAccount === true;
        },
      },
      tradingName: {
        type: String,
        trim: true,
      },
      companyEmail: {
        type: String,
        trim: true,
        lowercase: true,
        required: function (this: IClientDocument) {
          return this.accountType?.isEnterpriseAccount === true;
        },
        validate: {
          validator: function (v: string) {
            if (!v) return true;
            try {
              const schema = Zod.string().email();
              schema.parse(v);
              return true;
            } catch (error) {
              return false;
            }
          },
          message: 'Please enter a valid email address',
        },
      },
      companyAddress: {
        type: String,
        trim: true,
        minlength: 5,
        lowercase: true,
        required: function (this: IClientDocument) {
          return this.accountType?.isEnterpriseAccount === true;
        },
      },
      registrationNumber: {
        type: String,
        trim: true,
        index: true,
      },
      website: {
        type: String,
        trim: true,
        validate: {
          validator: function (v: string) {
            if (!v) return true;
            try {
              const schema = Zod.string().url();
              schema.parse(v);
              return true;
            } catch (error) {
              return false;
            }
          },
          message: 'Please enter a valid website URL',
        },
      },
      companyPhone: {
        type: String,
        trim: true,
        required: function (this: IClientDocument) {
          return this.accountType?.isEnterpriseAccount === true;
        },
        validate: {
          validator: function (v: string) {
            return isValidPhoneNumber(v);
          },
          message: 'Please enter a valid phone number',
        },
      },
      contactInfo: {
        email: {
          type: String,
          trim: true,
          lowercase: true,
          validate: {
            validator: function (v: string) {
              if (!v) return true;
              try {
                const schema = Zod.string().email();
                schema.parse(v);
                return true;
              } catch (error) {
                return false;
              }
            },
            message: 'Please enter a valid email address',
          },
        },
        phoneNumber: {
          type: String,
          trim: true,
          validate: {
            validator: function (v: string) {
              return isValidPhoneNumber(v);
            },
            message: 'Please enter a valid phone number',
          },
        },
        contactPerson: {
          type: String,
          trim: true,
        },
      },
    },
    settings: {
      notificationPreferences: {
        email: {
          type: Boolean,
          default: true,
        },
        sms: {
          type: Boolean,
          default: false,
        },
        inApp: {
          type: Boolean,
          default: true,
        },
      },
      timeZone: {
        type: String,
        default: 'UTC',
        validate: {
          validator: function (v: string) {
            // Validate timezone using Intl API
            try {
              Intl.DateTimeFormat(undefined, { timeZone: v });
              return true;
            } catch (error) {
              return false;
            }
          },
          message: 'Invalid timezone',
        },
      },
      lang: {
        type: String,
        default: 'en',
        validate: {
          validator: function (v: string) {
            // Validate language code format
            return /^[a-z]{2}(-[A-Z]{2})?$/.test(v);
          },
          message: 'Invalid language code',
        },
      },
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

ClientSchema.plugin(uniqueValidator, {
  message: '{PATH} must be unique.',
});
ClientSchema.virtual('fullCompanyName').get(function (this: IClientDocument) {
  return this.companyProfile?.tradingName || this.companyProfile?.legalEntityName || 'Unknown';
});

ClientSchema.virtual('verificationDeadline').get(function (this: IClientDocument) {
  if (this.isVerified) return null;
  return new Date((this.createdAt as Date).getTime() + 3 * 24 * 60 * 60 * 1000);
});

// Soft deletion method
ClientSchema.methods.softDelete = async function (userId: string) {
  this.status = 'deleted';
  this.deletedAt = new Date();
  this.lastModifiedBy = userId;
  return await this.save();
};

const ClientModel = model<IClientDocument>('Client', ClientSchema);

ClientModel.syncIndexes();

export default ClientModel;
