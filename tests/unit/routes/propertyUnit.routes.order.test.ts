import propertyUnitRoutes from '@routes/propertyUnit.routes';

const routeIndex = (method: string, path: string) =>
  (propertyUnitRoutes as any).stack.findIndex(
    (layer: any) => layer.route?.path === path && layer.route?.methods?.[method]
  );

describe('property unit routes — CSV endpoints', () => {
  it.each([
    ['get', '/csv/template'],
    ['get', '/csv/import-fields'],
    ['post', '/csv/validate'],
    ['post', '/csv/import'],
  ])('registers %s %s', (method, path) => {
    expect(routeIndex(method, path)).toBeGreaterThanOrEqual(0);
  });
});
