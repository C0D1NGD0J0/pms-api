import md5 from 'md5';
import { Schema, model } from 'mongoose';
import uniqueValidator from 'mongoose-unique-validator';
import { IProfileDocument } from '@interfaces/profile.interface';

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
        unique: true,
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
    },
    user: {
      required: true,
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    settings: {
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
      },
    },
    puid: { type: String, required: true, index: true },
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
    timeZone: { type: String, default: 'UTC' },
    lang: { type: String, default: 'en' },
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

// Data protection - automatically set retention date based on policy
ProfileSchema.pre('save', function (this: IProfileDocument, next) {
  if (this.isModified('settings.dataRetentionPolicy')) {
    const today = new Date();
    switch (this.settings.gdprSettings.dataRetentionPolicy) {
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
