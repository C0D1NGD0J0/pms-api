import { BaseDAO } from '@dao/baseDAO';
import { Document, Schema, model } from 'mongoose';
import {
  InternalServerError,
  InvalidRequestError,
  BadRequestError,
  NotFoundError,
} from '@shared/customErrors';

interface IErrorTestDocument extends Document {
  name: string;
}

const ErrorTestModel = model<IErrorTestDocument>(
  'ThrowErrorHandlerTest',
  new Schema({ name: String })
);

describe('BaseDAO.throwErrorHandler', () => {
  const dao = new BaseDAO<IErrorTestDocument>(ErrorTestModel);

  it('rethrows an existing custom error unchanged', () => {
    const original = new BadRequestError({ message: 'already handled' });

    expect(() => dao.throwErrorHandler(original)).toThrow(original);
  });

  it('maps a duplicate key error to an InvalidRequestError', () => {
    const duplicateKey = Object.assign(new Error('E11000 duplicate key'), { code: 11000 });

    expect(() => dao.throwErrorHandler(duplicateKey)).toThrow(InvalidRequestError);
  });

  it('maps a cast error to a NotFoundError', () => {
    const castError = Object.assign(new Error('Cast failed'), { name: 'CastError', value: 'bad' });

    expect(() => dao.throwErrorHandler(castError)).toThrow(NotFoundError);
  });

  it('wraps a thrown non-Error value instead of crashing on it', () => {
    expect(() => dao.throwErrorHandler('plain string failure')).toThrow(InternalServerError);
    expect(() => dao.throwErrorHandler(undefined)).toThrow(InternalServerError);
  });
});
