import { parseColumnMappingField } from '@utils/helpers';

describe('parseColumnMappingField', () => {
  const mapping = { 'Email Address': 'inviteeEmail', 'Given Name': 'firstName' };

  it('parses the JSON string sent as a multipart form field', () => {
    expect(parseColumnMappingField(JSON.stringify(mapping))).toEqual(mapping);
  });

  it('accepts a mapping already parsed by validateRequest', () => {
    expect(parseColumnMappingField(mapping)).toEqual(mapping);
  });

  it('drops entries whose field key is not a string', () => {
    expect(parseColumnMappingField({ ...mapping, Note: 42 })).toEqual(mapping);
  });

  it.each([undefined, null, '', '   ', 'not json', '[1,2]', ['a'], 7])(
    'returns undefined for %p',
    (raw) => {
      expect(parseColumnMappingField(raw)).toBeUndefined();
    }
  );
});
