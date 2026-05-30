import Logger from 'bunyan';
import { Types } from 'mongoose';
import { t } from '@shared/languages';
import { VendorDAO } from '@dao/vendorDAO';
import { PropertyDAO } from '@dao/propertyDAO';
import { AIService } from '@services/ai/ai.service';
import { SubscriptionDAO } from '@dao/subscriptionDAO';
import { EventTypes } from '@interfaces/events.interface';
import { EventEmitterService } from '@services/eventEmitter';
import { MaintenanceRequestDAO } from '@dao/maintenanceRequestDAO';
import { CATEGORY_TO_VENDOR_SERVICE, createLogger } from '@utils/index';
import { ServiceAreaService } from '@services/serviceArea/serviceArea.service';
import { ISuccessReturnData, IRequestContext } from '@interfaces/utils.interface';
import { BadRequestError, ForbiddenError, NotFoundError } from '@shared/customErrors';
import {
  IMaintenanceRequestDocument,
  MaintenanceRequestStatus,
  MaintenanceCategory,
  IVendorSuggestion,
} from '@interfaces/maintenanceRequest.interface';

interface IConstructor {
  maintenanceRequestDAO: MaintenanceRequestDAO;
  serviceAreaService: ServiceAreaService;
  emitterService: EventEmitterService;
  subscriptionDAO: SubscriptionDAO;
  propertyDAO: PropertyDAO;
  vendorDAO: VendorDAO;
  aiService: AIService;
}

export class VendorSuggestionService {
  private readonly log: Logger;
  private readonly vendorDAO: VendorDAO;
  private readonly propertyDAO: PropertyDAO;
  private readonly aiService: AIService;
  private readonly subscriptionDAO: SubscriptionDAO;
  private readonly emitterService: EventEmitterService;
  private readonly serviceAreaService: ServiceAreaService;
  private readonly maintenanceRequestDAO: MaintenanceRequestDAO;

  // ── Vendor Suggestion Scoring ──────────────────────────────────────────────
  //
  // Proprietary scoring algorithm: ranks qualified vendors for a maintenance
  // category using four weighted signals. This is deterministic (no LLM) and
  // designed to improve over time as vendor performance data accumulates.

  private static readonly SCORE_WEIGHTS = {
    COMPLETION_RATE: 25,
    RATING: 25,
    SPEED: 15,
    WORKLOAD: 15,
    PROXIMITY: 20,
  } as const;

  private static readonly NEW_VENDOR_BASELINE = 50;
  private static readonly MAX_COMPLETION_DAYS = 30; // cap for speed scoring
  private static readonly MAX_ACTIVE_JOBS = 10; // cap for workload scoring

  constructor({
    vendorDAO,
    propertyDAO,
    aiService,
    subscriptionDAO,
    emitterService,
    serviceAreaService,
    maintenanceRequestDAO,
  }: IConstructor) {
    this.vendorDAO = vendorDAO;
    this.propertyDAO = propertyDAO;
    this.aiService = aiService;
    this.subscriptionDAO = subscriptionDAO;
    this.emitterService = emitterService;
    this.serviceAreaService = serviceAreaService;
    this.maintenanceRequestDAO = maintenanceRequestDAO;
    this.log = createLogger('VendorSuggestionService');
  }

  /**
   * PM accepts the AI-suggested category + priority — copies aiAnalysis values to the
   * main category/priority fields.
   */
  async acceptAISuggestion(ctx: IRequestContext, mruid: string): Promise<ISuccessReturnData> {
    const { cuid } = ctx.request.params;
    const role = ctx.currentuser?.client?.role;
    if (!role || !['super-admin', 'manager', 'admin'].includes(role)) {
      throw new ForbiddenError({ message: 'Only managers can accept AI suggestions' });
    }

    const request = await this.maintenanceRequestDAO.getByMruid(mruid, cuid);
    if (!request) throw new NotFoundError({ message: t('maintenance.errors.notFound') });

    if (!request.aiAnalysis?.suggestedCategory && !request.aiAnalysis?.suggestedPriority) {
      throw new BadRequestError({ message: 'No AI suggestion available to accept' });
    }

    const updateFields: Record<string, unknown> = {};
    if (request.aiAnalysis.suggestedCategory)
      updateFields.category = request.aiAnalysis.suggestedCategory;
    if (request.aiAnalysis.suggestedPriority)
      updateFields.priority = request.aiAnalysis.suggestedPriority;
    updateFields['aiAnalysis.accepted'] = true;

    // Auto-assign the scored vendor when the request is still open.
    // This triggers the same notification/event pipeline as a manual assignment.
    let vendorAutoAssigned = false;
    if (request.aiAnalysis.suggestedVendorId && request.status === MaintenanceRequestStatus.OPEN) {
      const vendorDoc = await this.vendorDAO.findFirst({
        _id: new Types.ObjectId(request.aiAnalysis.suggestedVendorId.toString()),
        'connectedClients.cuid': cuid,
        'connectedClients.isConnected': true,
        deletedAt: null,
      });

      const clientConn = vendorDoc?.connectedClients?.find((c: any) => c.cuid === cuid);
      if (clientConn?.primaryAccountHolderUserId) {
        updateFields.vendorId = clientConn.primaryAccountHolderUserId;
        updateFields.assignedAt = new Date();
        updateFields.assignedBy = new Types.ObjectId(ctx.currentuser.sub);
        updateFields.status = MaintenanceRequestStatus.ASSIGNED;
        vendorAutoAssigned = true;
      }
    }

    const updated = await this.maintenanceRequestDAO.update(
      { _id: request._id },
      { $set: updateFields }
    );

    if (vendorAutoAssigned) {
      this.emitterService.emit(EventTypes.MAINTENANCE_REQUEST_ASSIGNED, {
        requestId: request._id.toString(),
        mruid: request.mruid,
        cuid,
        tenantId: request.tenantId?.toString(),
        vendorId: (updateFields.vendorId as Types.ObjectId).toString(),
        assignedBy: ctx.currentuser.sub,
      });
    }

    const message = vendorAutoAssigned
      ? t('maintenance.success.assigned')
      : 'AI suggestion applied';

    return { success: true, data: updated, message };
  }

  /**
   * PM dismisses the AI suggestion — keeps tenant's original values and marks the
   * suggestion as dismissed so the panel doesn't show again.
   */
  async dismissAISuggestion(ctx: IRequestContext, mruid: string): Promise<ISuccessReturnData> {
    const { cuid } = ctx.request.params;
    // Only managers and above may dismiss AI suggestions.
    const role = ctx.currentuser?.client?.role;
    if (!role || !['super-admin', 'manager', 'admin'].includes(role)) {
      throw new ForbiddenError({ message: 'Only managers can dismiss AI suggestions' });
    }
    const request = await this.maintenanceRequestDAO.getByMruid(mruid, cuid);
    if (!request) throw new NotFoundError({ message: t('maintenance.errors.notFound') });

    const updated = await this.maintenanceRequestDAO.update(
      { _id: request._id },
      { $set: { 'aiAnalysis.accepted': false } }
    );

    return { success: true, data: updated, message: 'AI suggestion dismissed' };
  }

  /**
   * Fire-and-forget AI triage: suggests category + priority and persists to aiAnalysis.
   * Tenant-provided values remain authoritative — AI results are advisory only.
   * After AI categorisation, runs vendor scoring to suggest the best-fit vendor.
   */
  async runAITriage(request: IMaintenanceRequestDocument): Promise<void> {
    const descriptionText =
      typeof request.description === 'string'
        ? request.description
        : ((request.description as any)?.text ?? '');

    const subscription = await this.subscriptionDAO.findFirst({ cuid: request.cuid });
    const planName = subscription?.planName ?? 'essential';

    const result = await this.aiService.categorizeMaintenanceRequest(
      request.title,
      descriptionText,
      planName
    );

    if (!result) return; // feature flag disabled or null result

    const updateFields: Record<string, unknown> = {
      'aiAnalysis.suggestedCategory': result.suggestedCategory,
      'aiAnalysis.suggestedPriority': result.suggestedPriority,
      'aiAnalysis.confidence': result.confidence,
      'aiAnalysis.reasoning': result.reasoning,
      'aiAnalysis.processedAt': new Date(),
      'aiAnalysis.modelUsed': 'claude-haiku-4-5',
    };

    // Vendor suggestion: use AI's suggested category — it's the authoritative classification.
    // The tenant's original category may be wrong (AI corrects it), so we do not fall back to it.
    const requestContext = { title: request.title, description: descriptionText };
    const vendorSuggestion = await this.suggestVendor(
      request.cuid,
      result.suggestedCategory,
      request.propertyId,
      requestContext
    );

    if (vendorSuggestion) {
      updateFields['aiAnalysis.suggestedVendorId'] = vendorSuggestion.vendorId;
      updateFields['aiAnalysis.suggestedVendorName'] = vendorSuggestion.companyName;
      if (vendorSuggestion.reasoning) {
        updateFields['aiAnalysis.suggestedVendorReasoning'] = vendorSuggestion.reasoning;
      }
    }

    await this.maintenanceRequestDAO.update({ _id: request._id }, { $set: updateFields });

    if (request.tenantId) {
      this.emitterService.emit(EventTypes.MAINTENANCE_AI_TRIAGE_COMPLETED, {
        tenantId: request.tenantId.toString(),
        mruid: request.mruid,
        cuid: request.cuid,
      });
    }

    this.log.info(
      {
        mruid: request.mruid,
        confidence: result.confidence,
        suggestedVendor: vendorSuggestion?.companyName ?? null,
      },
      'AI triage persisted'
    );
  }

  async suggestVendor(
    cuid: string,
    category: MaintenanceCategory,
    propertyId?: Types.ObjectId | string,
    requestContext?: { title: string; description: string }
  ): Promise<IVendorSuggestion | null> {
    const serviceKey = CATEGORY_TO_VENDOR_SERVICE[category];
    if (!serviceKey) {
      this.log.info({ category }, 'suggestVendor: no service key mapping for category');
      return null;
    }

    const { items: allVendors } = await this.vendorDAO.getClientVendors(cuid);
    if (!allVendors || allVendors.length === 0) {
      this.log.info({ cuid }, 'suggestVendor: no vendors connected to client');
      return null;
    }

    const qualified = allVendors.filter((v: any) => v.servicesOffered?.[serviceKey] === true);
    if (qualified.length === 0) {
      this.log.info(
        {
          cuid,
          category,
          serviceKey,
          vendorCount: allVendors.length,
          sample: allVendors.slice(0, 3).map((v: any) => ({
            vuid: v.vuid,
            servicesOffered: v.servicesOffered,
          })),
        },
        'suggestVendor: no vendors qualify for service key'
      );
      return null;
    }

    // Resolve property coordinates for proximity filtering + scoring
    let propertyCoords: [number, number] | null = null;
    if (propertyId) {
      const property = await this.propertyDAO.findFirst({ _id: propertyId });
      const coords = property?.computedLocation?.coordinates;
      if (coords?.length === 2) {
        propertyCoords = coords as [number, number];
      }
    }

    // Filter by service area using ServiceAreaService ($geoNear).
    // Vendors with no computedLocation or maxDistance are always included.
    let locationFiltered: typeof qualified = [];
    const distanceMap = new Map<string, number>();

    if (propertyCoords) {
      const geoChecks = await Promise.all(
        qualified.map(async (v: any) => {
          const hasLocation =
            v.address?.computedLocation?.coordinates?.length === 2 && v.serviceAreas?.maxDistance;
          if (!hasLocation) {
            return { vendor: v, include: true, distance: null };
          }
          const check = await this.serviceAreaService.isLocationInVendorServiceArea(
            v._id.toString(),
            propertyCoords!
          );
          return { vendor: v, include: check.isInRange, distance: check.distance ?? null };
        })
      );
      geoChecks.forEach(({ vendor, include, distance }) => {
        if (include) {
          locationFiltered.push(vendor);
          if (distance !== null) distanceMap.set(vendor._id.toString(), distance);
        }
      });
    } else {
      locationFiltered = qualified;
    }

    if (locationFiltered.length === 0) {
      // All qualified vendors are outside their declared service areas for this property.
      // Fall back to the full qualified list so the PM always gets a best-effort suggestion —
      // proximity score will be 0 for these vendors, which deprioritises them naturally.
      this.log.info(
        { cuid, category, qualifiedCount: qualified.length },
        'suggestVendor: geo filter eliminated all candidates — falling back to unfiltered qualified list'
      );
      locationFiltered = qualified;
    }

    // Batch: 2 aggregation queries for all vendors instead of 2 per vendor
    const vendorIds = locationFiltered.map((v: any) => v._id.toString());
    const [statsMap, ratingMap] = await Promise.all([
      this.maintenanceRequestDAO.getVendorStatsBatch(vendorIds),
      this.maintenanceRequestDAO.getVendorAvgRatingBatch(vendorIds),
    ]);

    const W = VendorSuggestionService.SCORE_WEIGHTS;
    const scored: IVendorSuggestion[] = locationFiltered.map((vendor: any) => {
      const vendorIdStr = vendor._id?.toString();
      const reasons: string[] = [];
      const stats = statsMap.get(vendorIdStr);
      const avgRating = ratingMap.get(vendorIdStr) ?? 0;

      const isNewVendor = !stats || stats.total === 0;

      if (isNewVendor) {
        reasons.push('New vendor — no job history yet');
        return {
          vendorId: vendorIdStr,
          vuid: vendor.vuid,
          companyName: vendor.companyName || 'Unknown',
          score: VendorSuggestionService.NEW_VENDOR_BASELINE,
          reasons,
        };
      }

      // Completion rate: completed / total (0-1) → scaled to weight
      const completionRate = stats.total > 0 ? stats.completed / stats.total : 0;
      const completionScore = completionRate * W.COMPLETION_RATE;
      reasons.push(`${Math.round(completionRate * 100)}% completion rate`);

      // Rating: 0-5 scale → normalized to weight
      const ratingScore = avgRating > 0 ? (avgRating / 5) * W.RATING : 0;
      if (avgRating > 0) {
        reasons.push(`${avgRating.toFixed(1)} avg rating`);
      }

      // Speed: inverse of avgCompletionDays, capped
      const maxDays = VendorSuggestionService.MAX_COMPLETION_DAYS;
      const days = Math.min(stats.avgCompletionDays ?? maxDays, maxDays);
      const speedScore = ((maxDays - days) / maxDays) * W.SPEED;
      if (stats.avgCompletionDays !== undefined) {
        reasons.push(`${Math.round(stats.avgCompletionDays)}d avg completion`);
      }

      // Workload: fewer active jobs = higher score
      const activeJobs = stats.inProgress + stats.assigned;
      const maxJobs = VendorSuggestionService.MAX_ACTIVE_JOBS;
      const workloadScore = (Math.max(maxJobs - activeJobs, 0) / maxJobs) * W.WORKLOAD;
      reasons.push(`${activeJobs} active job${activeJobs !== 1 ? 's' : ''}`);

      // Proximity: full score at vendor location, 0 at boundary edge
      const distance = distanceMap.get(vendorIdStr);
      let proximityScore = 0;
      if (distance !== undefined) {
        const maxDist = (vendor as any).serviceAreas?.maxDistance ?? 25;
        proximityScore = Math.max(0, 1 - distance / maxDist) * W.PROXIMITY;
        reasons.push(`${Math.round(distance)} km from property`);
      }

      const score = Math.round(
        completionScore + ratingScore + speedScore + workloadScore + proximityScore
      );

      return {
        vendorId: vendorIdStr,
        vuid: vendor.vuid,
        companyName: vendor.companyName || 'Unknown',
        score,
        reasons,
      };
    });

    scored.sort((a, b) => b.score - a.score);

    // Skip LLM when only 1 candidate or no request context provided
    if (scored.length <= 1 || !requestContext) {
      return scored[0] ?? null;
    }

    // Pass top 3 to Claude for context-aware final selection
    const shortlist = scored.slice(0, 3).map((v) => ({
      vendorId: v.vendorId,
      companyName: v.companyName,
      score: v.score,
      reasons: v.reasons,
    }));

    try {
      const aiPick = await this.aiService.selectBestVendor(
        requestContext.title,
        requestContext.description,
        shortlist
      );
      const winner = scored.find((v) => v.vendorId === aiPick.vendorId) ?? scored[0];
      return { ...winner, reasoning: aiPick.reasoning };
    } catch (err) {
      this.log.error(
        { err: err instanceof Error ? err.message : String(err) },
        'suggestVendor: AI selection failed — returning top-scored candidate'
      );
      return scored[0];
    }
  }
}
