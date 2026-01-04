import md5 from 'md5';
import { Schema, model } from 'mongoose';
import uniqueValidator from 'mongoose-unique-validator';
import { ProfileBackgroundCheckStatus, IProfileDocument } from '@interfaces/profile.interface';

const ProfileSchema = new Schema<IProfileDocument>(
  {
    personalInfo: {
      location: {
        type: String,
        default: '',
        trim: true,
        required: true,
      },
      displayName: {
        type: String,
        required: true,
        maxlength: 45,
        minlength: 2,
        trim: true,
        index: true,
      },
      firstName: {
        type: String,
        required: true,
        maxlength: 25,
        minlength: 2,
        trim: true,
        index: true,
      },
      lastName: {
        type: String,
        required: true,
        maxlength: 25,
        minlength: 2,
        trim: true,
        index: true,
      },
      dob: {
        type: Date,
        trim: true,
      },
      avatar: {
        url: {
          type: String,
          default: 'http://lorempixel.com/450/450/?random=456',
        },
        filename: String,
        key: String,
      },
      phoneNumber: { type: String, default: '' },
      bio: {
        type: String,
        maxlength: 700,
        minlength: 2,
        trim: true,
      },
      headline: {
        type: String,
        maxlength: 50,
        minlength: 2,
        trim: true,
      },
      identification: {
        idType: {
          type: String,
          enum: ['passport', 'drivers-license', 'national-id', 'corporation-license'],
          required: function (this: IProfileDocument) {
            if (this.isNew) return false;
            return this.isModified('accountType.identification');
          },
        },
        issueDate: {
          type: Date,
          required: function (this: IProfileDocument) {
            if (this.isNew) return false;
            return this.isModified('accountType.issueDate');
          },
        },
        expiryDate: {
          type: Date,
          required: function (this: IProfileDocument) {
            if (this.isNew) return false;
            return this.isModified('accountType.expiryDate');
          },
        },
        idNumber: {
          type: String,
          trim: true,
          required: function (this: IProfileDocument) {
            if (this.isNew) return false;
            return this.isModified('accountType.idNumber');
          },
        },
        authority: { type: String, trim: true },
        issuingState: {
          type: String,
          trim: true,
          required: function (this: IProfileDocument) {
            if (this.isNew) return false;
            return this.isModified('accountType.issuingState');
          },
        },
      },
    },
    user: {
      required: true,
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    settings: {
      lang: { type: String, default: 'en' },
      timeZone: { type: String, default: 'UTC' },
      theme: {
        type: String,
        default: 'light',
        enum: ['light', 'dark'],
      },
      loginType: {
        type: String,
        default: 'password',
        enum: ['otp', 'password'],
      },
      gdprSettings: {
        dataRetentionPolicy: {
          type: String,
          enum: ['standard', 'extended', 'minimal'],
          default: 'standard',
        },
        retentionExpiryDate: {
          type: Date,
          default: () => new Date(Date.now() + 1000 * 60 * 60 * 24 * 365 * 7), // 7 years default
        },
        dataProcessingConsent: {
          type: Boolean,
          default: false,
        },
        processingConsentDate: Date,
      },
      notifications: {
        messages: { type: Boolean, default: false },
        comments: { type: Boolean, default: false },
        announcements: { type: Boolean, default: true },
        maintenance: { type: Boolean, default: true },
        payments: { type: Boolean, default: true },
        system: { type: Boolean, default: true },
        propertyUpdates: { type: Boolean, default: true },
        emailNotifications: { type: Boolean, default: true },
        inAppNotifications: { type: Boolean, default: true },

        emailFrequency: {
          type: String,
          enum: ['immediate', 'daily'],
          default: 'immediate',
        },
      },
    },

    puid: { type: String, required: true, index: true },

    vendorInfo: {
      type: {
        vendorId: {
          type: Schema.Types.ObjectId,
          ref: 'Vendor',
        },
        linkedVendorUid: {
          // this is the primary vendor (user -> uid)
          type: String,
          trim: true,
        },
        isLinkedAccount: {
          type: Boolean,
          default: false,
        },
      },
      default: null,
    },
    employeeInfo: {
      type: {
        department: { type: String, trim: true },
        jobTitle: { type: String, trim: true },
        employeeId: { type: String, trim: true, sparse: true, select: false },
        reportsTo: {
          required: function (this: IProfileDocument) {
            // Not required for vendor linked accounts
            if (this.vendorInfo?.isLinkedAccount) {
              return false;
            }
            // Not required if employeeInfo doesn't exist or is being set
            if (!this.employeeInfo || Object.keys(this.employeeInfo).length === 0) {
              return false;
            }
            // Only required for actual employees (when employeeInfo is present and not a vendor)
            return !!(this.employeeInfo.department || this.employeeInfo.jobTitle);
          },
          type: Schema.Types.ObjectId,
          ref: 'User',
        },
        startDate: { type: Date },
        permissions: [{ type: String }],
        clientSpecificSettings: { type: Schema.Types.Mixed },
      },
      default: null,
    },

    tenantInfo: {
      type: {
        employerInfo: [
          {
            cuid: { type: String, trim: true, required: true },
            companyName: { type: String, trim: true, required: true },
            position: { type: String, trim: true, required: true },
            monthlyIncome: { type: Number, min: 0, required: true },
            contactPerson: { type: String, trim: true, required: true },
            companyAddress: { type: String, trim: true, required: true },
            contactEmail: { type: String, trim: true, lowercase: true, required: true },
          },
        ],
        activeLeases: [
          {
            confirmedDate: { type: Date },
            confirmed: { type: Boolean, default: false },
            cuid: { type: String, trim: true, required: true },
            leaseId: { type: Schema.Types.ObjectId, ref: 'Lease', required: true },
          },
        ],
        backgroundChecks: [
          {
            cuid: { type: String, trim: true, required: true },
            status: {
              type: String,
              enum: Object.values(ProfileBackgroundCheckStatus),
              required: true,
            },
            checkedDate: { type: Date, required: true },
            expiryDate: { type: Date },
            notes: { type: String, trim: true },
          },
        ],
        rentalReferences: [
          {
            landlordName: { type: String, required: true, trim: true },
            landlordEmail: { type: String, trim: true },
            landlordContact: { type: String, required: true, trim: true },
            durationMonths: { type: Number, min: 1, max: 120 },
            reasonForLeaving: { type: String, trim: true },
            propertyAddress: { type: String, required: true, trim: true },
          },
        ],
        pets: [
          {
            type: { type: String, required: true, trim: true },
            breed: { type: String, required: true, trim: true },
            isServiceAnimal: { type: Boolean, default: false },
          },
        ],
        emergencyContact: {
          name: { type: String, trim: true },
          phone: { type: String, trim: true },
          relationship: { type: String, trim: true },
          email: { type: String, trim: true, lowercase: true },
        },
      },
      default: null,
    },

    policies: {
      tos: {
        acceptedOn: { type: Date, default: null },
        accepted: { type: Boolean, default: false },
      },
      marketing: {
        acceptedOn: { type: Date, default: null },
        accepted: { type: Boolean, default: false },
      },
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

ProfileSchema.index({ user: 1 }, { unique: true });

ProfileSchema.plugin(uniqueValidator, {
  message: '{PATH} must be unique.',
});

ProfileSchema.virtual('fullname').get(function (this: IProfileDocument) {
  return `${this.personalInfo.firstName} ${this.personalInfo.lastName}`;
});

ProfileSchema.methods.getGravatarUrl = function (email: string): string {
  const hash = md5(email);
  return `https://gravatar.com/avatar/${hash}?s=200`;
};

ProfileSchema.pre('save', function (this: IProfileDocument, next) {
  if (this.isModified('settings.dataRetentionPolicy')) {
    const today = new Date();
    switch (this.settings?.gdprSettings?.dataRetentionPolicy) {
      case 'extended':
        this.settings.gdprSettings.retentionExpiryDate = new Date(
          today.setFullYear(today.getFullYear() + 10)
        );
        break;
      case 'minimal':
        this.settings.gdprSettings.retentionExpiryDate = new Date(
          today.setFullYear(today.getFullYear() + 2)
        );
        break;
      default:
        if (this.settings.gdprSettings)
          this.settings.gdprSettings.retentionExpiryDate = new Date(
            today.setFullYear(today.getFullYear() + 7)
          );
        break;
    }
  }

  next();
});

const ProfileModel = model<IProfileDocument>('Profile', ProfileSchema);

ProfileModel.syncIndexes();

export default ProfileModel;
