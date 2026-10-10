import { BadRequestError } from '@shared/customErrors';
import { PaymentErrorCode } from '@interfaces/payments.interface';
import { errorHandlerMiddleware } from '@shared/middlewares/error-handler';

const run = async (err: Error) => {
  const res: any = { headersSent: false };
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);

  await errorHandlerMiddleware(err as any, {} as any, res, jest.fn());
  return res.json.mock.calls[0][0];
};

describe('errorHandlerMiddleware — error codes', () => {
  it('returns a custom error code at the top level, not inside errorInfo', async () => {
    const body = await run(
      new BadRequestError({
        message: 'The amount must match the charge being settled.',
        code: PaymentErrorCode.AMOUNT_MISMATCH,
      })
    );

    expect(body).toMatchObject({
      success: false,
      statusCode: 400,
      code: PaymentErrorCode.AMOUNT_MISMATCH,
    });
    expect(body).not.toHaveProperty('errorInfo');
  });

  it('omits code when the error has none', async () => {
    const body = await run(new BadRequestError({ message: 'Bad input' }));

    expect(body).not.toHaveProperty('code');
  });
});
