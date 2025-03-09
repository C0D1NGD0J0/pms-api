import md5 from 'md5';
import bcrypt from 'bcryptjs';
import uniqueValidator from 'mongoose-unique-validator';
import { UpdateQuery, Schema, Query, model } from 'mongoose';
import { IUserDocument, IUser } from '@interfaces/user.interface';

const UserSchema = new Schema<IUserDocument>(
  {
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
    password: {
      type: String,
      required: [true, 'Password is required.'],
      minlength: 6,
      trim: true,
    },
    email: {
      type: String,
      index: true,
      required: [true, 'Please provide an email address.'],
      unique: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please add a valid email'],
    },
    location: {
      type: String,
      maxlength: 35,
      trim: true,
    },
    cids: [
      {
        roles: [{ type: String, required: true }],
        cid: { type: String, required: true, index: true },
        isConnected: { type: Boolean, required: true, default: false },
        _id: false,
      },
    ],
    phoneNumber: { type: String, default: '' },
    activationToken: { type: String, default: '' },
    isActive: { type: Boolean, default: false },
    passwordResetToken: { type: String, default: '' },
    cid: { type: String, required: true, index: true },
    uid: { type: String, required: true, index: true },
    deletedAt: { type: Date, default: null, select: false },
    activationTokenExpiresAt: { type: Date, default: null },
    passwordResetTokenExpiresAt: { type: Number, default: null },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

UserSchema.index({
  email: 'text',
  firstName: 'text',
  lastName: 'text',
});

UserSchema.pre('save', async function (this: IUserDocument, next) {
  if (this.isModified('password')) {
    // Hashing Password
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
  }
  next();
});

UserSchema.pre<Query<any, IUser>>('findOneAndUpdate', async function (next) {
  const update = this.getUpdate() as UpdateQuery<IUser>;
  // Check if password is being updated
  if (update.password) {
    const salt = await bcrypt.genSalt(10);
    update.password = await bcrypt.hash(update.password, salt);
  }

  next();
});

UserSchema.virtual('fullname').get(function (this: IUserDocument) {
  return `${this.firstName} ${this.lastName}`;
});

UserSchema.methods.getGravatar = function () {
  const hash = md5(this.email);
  return `https://gravatar.com/avatar/${hash}?s=200`;
};

UserSchema.plugin(uniqueValidator, {
  message: '{PATH} must be unique.',
});

UserSchema.methods.validatePassword = async function (pwd: string): Promise<boolean> {
  return await bcrypt.compare(pwd, this.password);
};

const UserModel = model<IUserDocument>('User', UserSchema);

UserModel.syncIndexes();

export default UserModel;
