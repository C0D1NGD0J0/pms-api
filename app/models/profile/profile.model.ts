import { Schema, model } from 'mongoose';
import uniqueValidator from 'mongoose-unique-validator';
import { IProfileDocument } from '@interfaces/profile.interface';

const ProfileSchema = new Schema<IProfileDocument>(
  {
    dob: {
      type: Date,
      trim: true,
    },
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
    user: {
      required: true,
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    avatar: {
      url: {
        type: String,
        default: 'http://lorempixel.com/450/450/?random=456',
      },
      filename: String,
      key: String,
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
      name: { type: String, default: 'individual', enum: ['individual', 'corporate'] },
    },
    notifications: {
      messages: { type: Boolean, default: false },
      comments: { type: Boolean, default: false },
      announcements: { type: Boolean, default: true },
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

ProfileSchema.plugin(uniqueValidator, {
  message: '{PATH} must be unique.',
});

ProfileSchema.index({ user: 1 });

const ProfileModel = model<IProfileDocument>('Profile', ProfileSchema);

ProfileModel.syncIndexes();

export default ProfileModel;
