import Logger from 'bunyan';
import { UserDAO } from '@dao/userDAO';
import { ClientDAO } from '@dao/clientDAO';
import { createLogger, toId } from '@utils/index';
import { InspectionDAO } from '@dao/inspectionDAO';
import { SSEService } from '@services/sse/sse.service';
import { InspectionStatus } from '@interfaces/inspection.interface';
import { RoleHelpers, IUserRole } from '@shared/constants/roles.constants';
import { MediaUploadService } from '@services/mediaUpload/mediaUpload.service';
import { PdfGeneratorService } from '@services/pdfGenerator/pdfGenerator.service';
import { IPromiseReturnedData, ResourceContext } from '@interfaces/utils.interface';
import { BadRequestError, ForbiddenError, NotFoundError } from '@shared/customErrors';

import { buildInspectionReportHtml, InspectionReportData } from './inspectionReportTemplate';

interface IConstructor {
  pdfGeneratorService: PdfGeneratorService;
  mediaUploadService: MediaUploadService;
  inspectionDAO: InspectionDAO;
  sseService: SSEService;
  clientDAO: ClientDAO;
  userDAO: UserDAO;
}

export class InspectionReportService {
  private readonly log: Logger;
  private readonly inspectionDAO: InspectionDAO;
  private readonly clientDAO: ClientDAO;
  private readonly userDAO: UserDAO;
  private readonly sseService: SSEService;
  private readonly pdfGeneratorService: PdfGeneratorService;
  private readonly mediaUploadService: MediaUploadService;

  constructor({
    inspectionDAO,
    clientDAO,
    userDAO,
    sseService,
    pdfGeneratorService,
    mediaUploadService,
  }: IConstructor) {
    this.inspectionDAO = inspectionDAO;
    this.clientDAO = clientDAO;
    this.userDAO = userDAO;
    this.sseService = sseService;
    this.pdfGeneratorService = pdfGeneratorService;
    this.mediaUploadService = mediaUploadService;
    this.log = createLogger('InspectionReportService');
  }

  async generateReport(
    cuid: string,
    iuid: string,
    includePhotos: boolean,
    forceRegenerate: boolean,
    userRole: string,
    userId: string,
    userDepartment?: string
  ): Promise<IPromiseReturnedData<{ url: string; filename: string; fileSize?: number }>> {
    const inspection = await this.inspectionDAO.findFirst(
      { iuid, cuid, deletedAt: null },
      {
        populate: [
          { path: 'propertyId', select: 'name pid address' },
          {
            path: 'leaseId',
            select: 'property.unitId fees',
            populate: { path: 'propertyUnitInfo', select: 'unitNumber' },
          },
          {
            path: 'tenantId',
            select: 'uid email',
            populate: { path: 'profile', select: 'personalInfo.firstName personalInfo.lastName' },
          },
        ],
      }
    );

    if (!inspection) {
      throw new NotFoundError({ message: 'Inspection not found' });
    }

    if (userRole === 'tenant' && toId(inspection.tenantId) !== userId) {
      throw new ForbiddenError({ message: 'Access denied' });
    }

    if (
      ![InspectionStatus.SUBMITTED, InspectionStatus.APPROVED, InspectionStatus.DISPUTED].includes(
        inspection.status
      )
    ) {
      throw new BadRequestError({
        message: 'Report can only be generated for submitted, approved, or disputed inspections',
      });
    }

    // Return cached report if available (unless forced regeneration)
    const hasCachedReport =
      inspection.reportDocument?.status === 'active' && !!inspection.reportDocument.url;

    if (hasCachedReport && !forceRegenerate) {
      return {
        success: true,
        data: {
          url: inspection.reportDocument!.url,
          filename: inspection.reportDocument!.filename,
          fileSize: inspection.reportDocument!.size,
        },
      };
    }

    // Only managers/admins and management-dept staff can trigger (re)generation
    if (!canGenerateReports(userRole, userDepartment)) {
      throw new ForbiddenError({
        message: hasCachedReport
          ? 'Only managers can regenerate inspection reports.'
          : 'Report has not been generated yet. Only managers can generate inspection reports.',
      });
    }

    const client = await this.clientDAO.findFirst({ cuid, deletedAt: null });
    if (!client) {
      throw new NotFoundError({ message: 'Client not found' });
    }

    // inspectorUid is a string UID — resolve via manual lookup
    let inspectorName = 'Inspector';
    if (inspection.inspectorUid) {
      const inspectorUser = (await this.userDAO.findFirst(
        { uid: inspection.inspectorUid, deletedAt: null },
        { populate: { path: 'profile', select: 'personalInfo.firstName personalInfo.lastName' } }
      )) as any;
      if (inspectorUser) {
        const info = inspectorUser.profile?.personalInfo;
        if (info?.firstName) inspectorName = `${info.firstName} ${info.lastName ?? ''}`.trim();
      }
    }

    const tenant = inspection.tenantId as any;
    const tenantInfo = tenant?.profile?.personalInfo;
    const tenantName = tenantInfo?.firstName
      ? `${tenantInfo.firstName} ${tenantInfo.lastName ?? ''}`.trim()
      : 'Tenant';

    const property = inspection.propertyId as { name?: string; pid?: string } | undefined;
    const lease = inspection.leaseId as { propertyUnitId?: { unitNumber?: string } } | undefined;
    const unit = lease?.propertyUnitId;
    const propertyName = property?.name || property?.pid || 'Property';
    const unitNumber = unit?.unitNumber || 'N/A';

    const companyProfile = client.companyProfile;
    const companyName =
      companyProfile?.tradingName ||
      companyProfile?.legalEntityName ||
      client.displayName ||
      'Property Management';

    const reportData: InspectionReportData = {
      inspection,
      propertyName,
      unitNumber,
      inspectorName,
      tenantName,
      company: {
        name: companyName,
        email: companyProfile?.companyEmail,
        phone: companyProfile?.companyPhone,
        website: companyProfile?.website,
        logo: companyProfile?.logo,
      },
      includePhotos,
    };

    const html = buildInspectionReportHtml(reportData);

    const pdfResult = await this.pdfGeneratorService.generatePdf(html, {
      format: 'Letter',
      printBackground: true,
    });

    if (!pdfResult.success || !pdfResult.buffer) {
      throw new BadRequestError({
        message: pdfResult.error || 'PDF generation failed',
      });
    }

    const filename = forceRegenerate
      ? `inspection_report_${iuid}_${Date.now()}.pdf`
      : `inspection_report_${iuid}.pdf`;

    // Mark as pending while uploading
    await this.inspectionDAO.updateById(inspection._id.toString(), {
      $set: {
        reportDocument: {
          url: '',
          key: '',
          filename,
          size: pdfResult.metadata?.fileSize,
          status: 'pending',
          generatedAt: new Date(),
        },
      },
    });

    this.mediaUploadService
      .handleBuffer(pdfResult.buffer, filename, {
        primaryResourceId: inspection._id.toString(),
        uploadedBy: inspection.createdBy?.toString() || 'system',
        resourceContext: ResourceContext.INSPECTION,
        fieldName: 'reportDocument',
      })
      .catch(async (bufferError) => {
        this.log.error(
          { error: bufferError, iuid, filename },
          'Failed to queue inspection PDF buffer for upload'
        );
        await this.inspectionDAO
          .updateById(inspection._id.toString(), {
            $set: {
              'reportDocument.status': 'failed',
              'reportDocument.error':
                bufferError instanceof Error ? bufferError.message : 'Failed to queue upload',
            },
          })
          .catch((dbErr) => this.log.error({ dbErr }, 'Failed to mark report as failed'));
      });

    return {
      success: true,
      message: 'Report generation started. The PDF will be available shortly.',
      data: {
        url: '',
        filename,
        fileSize: pdfResult.metadata?.fileSize,
      },
    };
  }
}

/** Checks if a role can generate inspection reports (management roles + root-admin) */
function canGenerateReports(role: string, department?: string): boolean {
  const normalized = role.toLowerCase();
  return (
    RoleHelpers.isManagementRole(normalized) ||
    normalized === IUserRole.ROOT_ADMIN ||
    (normalized === 'staff' && department === 'management')
  );
}
