import { requestSanitizer } from '@shared/middlewares/requestSanitizer';

const runSanitizer = (overrides: Record<string, any>) => {
  const req: Record<string, any> = {
    url: '/api/v1/webhooks/stripe',
    params: {},
    query: {},
    ...overrides,
  };
  const next = jest.fn();
  requestSanitizer(req as any, {} as any, next);
  expect(next).toHaveBeenCalledTimes(1);
  return req;
};

describe('requestSanitizer', () => {
  it.each([
    [
      'a v1 signature starting with "1" (stripped "1=1")',
      't=1760300005,v1=1fce9f5a22e4d14551bb8,v0=ab',
    ],
    ['a signature containing "add"', 't=1760300000,v1=5d7ffdac233eadd5e8b7ac9be0f435e3'],
  ])('leaves a Stripe signature header with %s untouched', (_label, signature) => {
    const req = runSanitizer({ headers: { 'stripe-signature': signature } });

    expect(req.headers['stripe-signature']).toBe(signature);
  });

  it('leaves JWT cookies untouched', () => {
    const cookie =
      'access_token=eyJhbGciOiJIUzI1NiJ9.llwhbCXbaddJ9ifR7wSwa2.sig; refresh_token=a==';
    const req = runSanitizer({ headers: { cookie } });

    expect(req.headers.cookie).toBe(cookie);
  });

  it('leaves base64 signature headers with "==" padding untouched', () => {
    const req = runSanitizer({ headers: { 'x-twilio-signature': 'q1w2E3r4T5add+/x==' } });

    expect(req.headers['x-twilio-signature']).toBe('q1w2E3r4T5add+/x==');
  });

  it.each(['Paddington', 'address', 'unit 1=1', '$100'])(
    'keeps the search term %p intact in the query string',
    (term) => {
      const req = runSanitizer({ headers: {}, query: { search: term } });

      expect(req.query.search).toBe(term);
    }
  );

  it('still strips XSS payloads from query values', () => {
    const req = runSanitizer({ headers: {}, query: { search: '<img src=x onerror=alert(1)>' } });

    expect(req.query.search).toBe('');
  });
});
