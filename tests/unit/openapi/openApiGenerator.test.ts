import { generateOpenApiDocument } from '@shared/openapi/generator';

describe('OpenAPI document generation', () => {
  let doc: ReturnType<typeof generateOpenApiDocument>;

  beforeAll(() => {
    doc = generateOpenApiDocument();
  });

  it('generates a valid OpenAPI 3.1 document', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toBe('PropertyDesk API');
    expect(doc.info.version).toBe('1.0.0');
  });

  it('includes the /api/v1 server', () => {
    expect(doc.servers).toEqual(expect.arrayContaining([{ url: '/api/v1' }]));
  });

  it('registers the cookieAuth security scheme', () => {
    expect(doc.components?.securitySchemes?.cookieAuth).toEqual(
      expect.objectContaining({
        type: 'apiKey',
        in: 'cookie',
        name: 'accessToken',
      })
    );
  });

  it('registers the auth/signup path', () => {
    expect(doc.paths?.['/auth/signup']).toBeDefined();
    expect(doc.paths?.['/auth/signup']?.post).toBeDefined();
    expect(doc.paths?.['/auth/signup']?.post?.tags).toContain('Auth');
  });

  it('registers the auth/login path', () => {
    expect(doc.paths?.['/auth/login']).toBeDefined();
    expect(doc.paths?.['/auth/login']?.post?.summary).toContain('Authenticate');
  });

  it('registers the healthcheck path with no auth', () => {
    const healthPath = doc.paths?.['/healthcheck'];
    expect(healthPath).toBeDefined();
    expect(healthPath?.get?.security).toEqual([]);
  });

  it('registers property routes', () => {
    expect(doc.paths?.['/properties/{cuid}']).toBeDefined();
    expect(doc.paths?.['/properties/{cuid}']?.post).toBeDefined();
    expect(doc.paths?.['/properties/{cuid}/{pid}']).toBeDefined();
  });

  it('registers lease routes', () => {
    expect(doc.paths?.['/leases/{cuid}']).toBeDefined();
    expect(doc.paths?.['/leases/{cuid}']?.post).toBeDefined();
  });

  it('registers payment routes', () => {
    expect(doc.paths?.['/payments/{cuid}']).toBeDefined();
    expect(doc.paths?.['/payments/{cuid}/{pytuid}/refund']).toBeDefined();
  });

  it('registers webhook routes without auth', () => {
    const stripePath = doc.paths?.['/webhooks/stripe'];
    expect(stripePath).toBeDefined();
    expect(stripePath?.post?.security).toEqual([]);
  });

  it('includes StandardSuccess and StandardError component schemas', () => {
    const schemas = doc.components?.schemas;
    expect(schemas?.StandardSuccess).toBeDefined();
    expect(schemas?.StandardError).toBeDefined();
  });

  it('includes request body schema for signup', () => {
    const signupPost = doc.paths?.['/auth/signup']?.post;
    const content = signupPost?.requestBody as any;
    expect(content?.content?.['application/json']?.schema).toBeDefined();
  });

  it('registers all major domain tags', () => {
    const allTags = new Set<string>();
    for (const pathObj of Object.values(doc.paths || {})) {
      for (const method of Object.values(pathObj as any)) {
        if ((method as any).tags) {
          for (const tag of (method as any).tags) {
            allTags.add(tag);
          }
        }
      }
    }
    const expectedTags = [
      'Auth',
      'Clients',
      'Properties',
      'Leases',
      'Payments',
      'Users',
      'Vendors',
      'Invitations',
      'Expenses',
      'Notifications',
      'Subscriptions',
      'Metrics',
      'Inspections',
      'MaintenanceRequests',
      'Reports',
      'GuestPasses',
      'Webhooks',
      'System',
    ];
    for (const tag of expectedTags) {
      expect(allTags).toContain(tag);
    }
  });

  it('registers 200+ endpoints total', () => {
    let count = 0;
    for (const pathObj of Object.values(doc.paths || {})) {
      count += Object.keys(pathObj as any).length;
    }
    expect(count).toBeGreaterThanOrEqual(200);
  });

  it('returns the same document on multiple calls (idempotent)', () => {
    const doc2 = generateOpenApiDocument();
    const pathKeys1 = Object.keys(doc.paths || {}).sort();
    const pathKeys2 = Object.keys(doc2.paths || {}).sort();
    expect(pathKeys1).toEqual(pathKeys2);
  });
});
