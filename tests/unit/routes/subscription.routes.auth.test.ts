import subscriptionRoutes from '@routes/subscription.routes';
import { subscriptionEntitlements, isAuthenticated } from '@shared/middlewares';

// subscriptionEntitlements no longer returns its own 401 when currentuser is missing,
// so every route using it must authenticate first — otherwise an anonymous request
// would reach the entitlements lookup (and the controller) without a 401.
const routesUsingEntitlements = (subscriptionRoutes as any).stack
  .filter((layer: any) => layer.route)
  .map((layer: any) => ({
    label: `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`,
    handlers: layer.route.stack.map((routeLayer: any) => routeLayer.handle),
  }))
  .filter(({ handlers }: any) => handlers.includes(subscriptionEntitlements));

describe('subscription routes — authentication before entitlements', () => {
  it('finds routes that use subscriptionEntitlements', () => {
    expect(routesUsingEntitlements.length).toBeGreaterThan(0);
  });

  it.each<{ label: string; handlers: unknown[] }>(routesUsingEntitlements)(
    '$label runs isAuthenticated before subscriptionEntitlements',
    ({ handlers }) => {
      const authIndex = handlers.indexOf(isAuthenticated);

      expect(authIndex).toBeGreaterThanOrEqual(0);
      expect(authIndex).toBeLessThan(handlers.indexOf(subscriptionEntitlements));
    }
  );
});
