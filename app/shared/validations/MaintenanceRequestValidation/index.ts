import { MaintenanceSchemas } from './schemas';

export const MaintenanceValidations = {
  mruidParam: MaintenanceSchemas.mruidParam,
  createBody: MaintenanceSchemas.createBody,
  updateBody: MaintenanceSchemas.updateBody,
  assignBody: MaintenanceSchemas.assignBody, // PM assigns vendor (vendorId, scheduledDate, estimatedCost)
  assignmentBody: MaintenanceSchemas.assignmentBody, // Vendor responds (action: accept|decline, reason?)
  statusBody: MaintenanceSchemas.statusBody,
  completeBody: MaintenanceSchemas.completeBody,
  cancelBody: MaintenanceSchemas.cancelBody,
  invoiceBody: MaintenanceSchemas.invoiceBody,
  invoiceReviewBody: MaintenanceSchemas.invoiceReviewBody,
  workOrderBody: MaintenanceSchemas.workOrderBody,
  workOrderReviewBody: MaintenanceSchemas.workOrderReviewBody,
  listQuery: MaintenanceSchemas.listQuery,
  webhookSourceParam: MaintenanceSchemas.webhookSourceParam,
  webhookBody: MaintenanceSchemas.webhookBody,
  tenantFeedbackBody: MaintenanceSchemas.tenantFeedbackBody,
};
