import propertyRoutes from '@routes/property.routes';

// Express matches routes in registration order, so a literal 2-segment path registered
// after /:cuid/:pid is swallowed by the catch-all (the literal is treated as a :pid).
const routeIndex = (method: string, path: string) =>
  (propertyRoutes as any).stack.findIndex(
    (layer: any) => layer.route?.path === path && layer.route?.methods?.[method]
  );

describe('property routes — registration order', () => {
  it.each([
    ['get', '/:cuid/pending-verifications'],
    ['get', '/:cuid/leaseable'],
    ['patch', '/:cuid/batch-archive'],
  ])('registers %s %s before the /:cuid/:pid catch-all', (method, literalPath) => {
    const literal = routeIndex(method, literalPath);
    const catchAll = routeIndex(method, '/:cuid/:pid');

    expect(literal).toBeGreaterThanOrEqual(0);
    expect(catchAll).toBeGreaterThanOrEqual(0);
    expect(literal).toBeLessThan(catchAll);
  });
});
