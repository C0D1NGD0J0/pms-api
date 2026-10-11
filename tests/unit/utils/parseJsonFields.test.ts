import { Request } from 'express';
import { parseJsonFields } from '@utils/helpers';

const parseBody = (body: Record<string, any>, extra: Partial<Request> = {}) =>
  parseJsonFields({ body, ...extra } as Request);

describe('parseJsonFields — unflattening FormData keys', () => {
  it('expands dot-notation keys into nested objects', () => {
    expect(
      parseBody({ 'address.city': 'Toronto', 'address.unitNumber': '4B', name: 'Elm' })
    ).toEqual({ address: { city: 'Toronto', unitNumber: '4B' }, name: 'Elm' });
  });

  it('expands bracket indices into real arrays', () => {
    const body = parseBody({ 'tags[0]': 'a', 'tags[2]': 'c' });

    expect(Array.isArray(body.tags)).toBe(true);
    expect(body.tags[0]).toBe('a');
    expect(body.tags[2]).toBe('c');
    expect(body.tags).toHaveLength(3);
  });

  it('expands bracket indices followed by dot keys into arrays of objects', () => {
    expect(
      parseBody({
        'documents[0].documentType': 'deed',
        'documents[0].description': 'Title deed',
        'documents[1].documentType': 'tax',
        'images[0].url': 'https://cdn.example.com/a.png',
      })
    ).toEqual({
      documents: [{ documentType: 'deed', description: 'Title deed' }, { documentType: 'tax' }],
      images: [{ url: 'https://cdn.example.com/a.png' }],
    });
  });

  it('handles deeper mixes of brackets and dots', () => {
    expect(
      parseBody({
        'lease.coTenants[0].name': 'Ana',
        'lease.coTenants[0].contacts[1].phone': '555',
        'rooms[0].items[0]': 'bed',
      })
    ).toEqual({
      lease: { coTenants: [{ name: 'Ana', contacts: [undefined, { phone: '555' }] }] },
      rooms: [{ items: ['bed'] }],
    });
  });

  it('merges into arrays multer already nested from pure-bracket keys', () => {
    expect(
      parseBody({
        documents: [{ documentType: 'deed' }],
        'documents[0].description': 'Title deed',
        'documents[1].documentType': 'tax',
      })
    ).toEqual({
      documents: [{ documentType: 'deed', description: 'Title deed' }, { documentType: 'tax' }],
    });
  });

  it('still converts JSON strings and booleans after unflattening', () => {
    expect(
      parseBody({
        'utilities.water': 'true',
        'coTenants[0].isPrimary': 'false',
        notes: '[{"text":"hi"}]',
      })
    ).toEqual({
      utilities: { water: true },
      coTenants: [{ isPrimary: false }],
      notes: [{ text: 'hi' }],
    });
  });

  it('leaves keys flat when they cannot be expanded safely', () => {
    const body = parseBody({
      '__proto__.polluted': 'yes',
      'a.constructor.prototype.polluted': 'yes',
      'huge[100000]': 'x',
      'weird[abc].x': 'y',
      'trailing.': 'z',
    });

    expect(({} as any).polluted).toBeUndefined();
    expect(Object.keys(body).sort()).toEqual(
      [
        '__proto__.polluted',
        'a.constructor.prototype.polluted',
        'huge[100000]',
        'weird[abc].x',
        'trailing.',
      ].sort()
    );
  });

  it('does not touch uploaded files, which multer keeps in req.files', () => {
    const files = { 'documents[0].file': [{ fieldname: 'documents[0].file' }] };
    const req = { body: { 'documents[0].documentType': 'deed' }, files } as unknown as Request;

    const body = parseJsonFields(req);

    expect(body).toEqual({ documents: [{ documentType: 'deed' }] });
    expect(req.files).toBe(files);
    expect(req.files).toEqual({ 'documents[0].file': [{ fieldname: 'documents[0].file' }] });
  });

  it('returns non-object bodies unchanged', () => {
    expect(parseJsonFields({ body: undefined } as Request)).toBeUndefined();
  });
});
