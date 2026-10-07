import {
  getInvitationImportFieldsResponse,
  INVITATION_REQUIRED_FIELD_KEYS,
  isKnownInvitationImportField,
} from '@services/csv/invitationImportFields';

describe('invitationImportFields', () => {
  it('requires only email, first name, last name and role', () => {
    expect([...INVITATION_REQUIRED_FIELD_KEYS].sort()).toEqual(
      ['firstName', 'inviteeEmail', 'lastName', 'role'].sort()
    );
  });

  it('knows its own fields and nothing else', () => {
    expect(isKnownInvitationImportField('tenantInfo_emergencyContactPhone')).toBe(true);
    expect(isKnownInvitationImportField('cuid')).toBe(false);
    expect(isKnownInvitationImportField('password')).toBe(false);
  });

  it('returns every field with no platform preset', () => {
    const response = getInvitationImportFieldsResponse();
    expect(response.presetMapping).toBeNull();
    expect(response.fields.length).toBeGreaterThan(4);
  });
});
