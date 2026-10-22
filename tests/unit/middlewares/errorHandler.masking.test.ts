import { t } from '@shared/languages';
import { InternalServerError } from '@shared/customErrors';
import { errorHandlerMiddleware } from '@shared/middlewares/error-handler';

const run = async (err: Error) => {
  const res: any = { headersSent: false };
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);

  await errorHandlerMiddleware(err as any, {} as any, res, jest.fn());
  return res.json.mock.calls[0][0];
};

describe('errorHandlerMiddleware — server error masking', () => {
  it('replaces the message of an unexpected error with a generic one', async () => {
    const body = await run(new TypeError("Cannot read properties of undefined (reading 'cuid')"));

    expect(body.statusCode).toBe(500);
    expect(body.message).not.toContain('Cannot read properties');
    expect(body.message).toBe(t('system.errors.unexpectedError'));
  });

  it('keeps the message of a CustomError written for the user', async () => {
    const body = await run(new InternalServerError({ message: 'Please try again later' }));

    expect(body.statusCode).toBe(500);
    expect(body.message).toBe('Please try again later');
  });
});
