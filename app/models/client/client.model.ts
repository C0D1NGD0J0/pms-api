import Zod from 'zod';
import { Schema, model } from 'mongoose';
import { isValidPhoneNumber } from '@utils/index';
import uniqueValidator from 'mongoose-unique-validator';
import { IdentificationEnumType, IClientDocument } from '@interfaces/index';

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
      planId: {
        type: String,
        required: true,
        trim: true,
      },
      planName: {
        type: String,
        required: true,
        trim: true,
      },
      isEnterpriseAccount: {
        type: Boolean,
        default: false,
      },
    },
    identification: {
      idType: {
        type: String,
        enum: Object.values(IdentificationEnumType),
        required: function (this: IClientDocument) {
          if (this.isNew) return false;
          return this.isModified('identification.idType');
        },
        // Field level encryption could be added here
      },
      issueDate: {
        type: Date,
        required: function (this: IClientDocument) {
          if (this.isNew) return false;
          return this.isModified('identification.issueDate');
        },
      },
      expiryDate: {
        type: Date,
        required: function (this: IClientDocument) {
          if (this.isNew) return false;
          return this.isModified('identification.expiryDate');
        },
        validate: {
          validator: function (this: IClientDocument, expiryDate: Date) {
            return !this.identification?.issueDate || expiryDate > this.identification?.issueDate;
          },
          message: 'Expiry date must be after issue date',
        },
      },
      idNumber: {
        type: String,
        trim: true,
        required: function (this: IClientDocument) {
          if (this.isNew) return false;
          return this.isModified('identification.idNumber');
        },
      },
      authority: {
        type: String,
        trim: true,
      },
      issuingState: {
        type: String,
        trim: true,
        required: function (this: IClientDocument) {
          if (this.isNew) return false;
          return this.isModified('identification.issuingState');
        },
      },
      retentionExpiryDate: {
        type: Date,
        default: () => new Date(Date.now() + 1000 * 60 * 60 * 24 * 365 * 7), // 7 years default
      },
      lastVerifiedAt: Date,
      dataProcessingConsent: {
        type: Boolean,
        default: false,
      },
      processingConsentDate: Date,
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
    verifiedBy: {
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

// Pre-validation middleware
ClientSchema.pre('validate', function (this: IClientDocument, next) {
  if (this.isNew) return next();

  // Check if identification is being updated partially
  if (this.isModified('identification')) {
    const identification = this.identification;

    // If identification object exists and any field is provided, require all mandatory fields
    if (identification && Object.values(identification).some((value) => value !== undefined)) {
      const requiredFields = ['idType', 'issueDate', 'expiryDate', 'idNumber', 'issuingState'];

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
