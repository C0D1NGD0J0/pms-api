import authRoutes from './auth.routes';
import userRoutes from './users.routes';
import adminRoutes from './admin.routes';
import leaseRoutes from './lease.routes';
import clientRoutes from './client.routes';
import vendorRoutes from './vendors.routes';
import webhookRoutes from './webhook.routes';
import paymentRoutes from './payments.routes';
import propertyRoutes from './property.routes';
import invitationRoutes from './invitation.routes';
import notificationRoutes from './notification.routes';
import subscriptionRoutes from './subscription.routes';
import emailTemplateRoutes from './emailTemplate.routes';

export const routes = {
  adminRoutes,
  authRoutes,
  userRoutes,
  leaseRoutes,
  clientRoutes,
  vendorRoutes,
  webhookRoutes,
  propertyRoutes,
  paymentRoutes,
  invitationRoutes,
  subscriptionRoutes,
  notificationRoutes,
  emailTemplateRoutes,
};
