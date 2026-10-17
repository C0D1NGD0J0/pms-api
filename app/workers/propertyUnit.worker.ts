import { Job } from 'bull';
import Logger from 'bunyan';
import { Types } from 'mongoose';
import { createLogger } from '@utils/index';
import { MoneyUtils } from '@utils/money.utils';
import { isUnlimited } from '@utils/planLimits.utils';
import { SSEService } from '@services/sse/sse.service';
import { EventTypes } from '@interfaces/events.interface';
import { EventEmitterService } from '@services/eventEmitter';
import { UnitBatchJobData } from '@queues/propertyUnit.queue';
import { PropertyUnitDAO, SubscriptionDAO, PropertyDAO } from '@dao/index';
import { UnitNumberingService } from '@services/unitNumbering/unitNumbering.service';
import { subscriptionPlanConfig } from '@services/subscription/subscription_plans.config';

interface IConstructor {
  unitNumberingService: UnitNumberingService;
  emitterService: EventEmitterService;
  propertyUnitDAO: PropertyUnitDAO;
  subscriptionDAO: SubscriptionDAO;
  propertyDAO: PropertyDAO;
  sseService: SSEService;
}

export class PropertyUnitWorker {
  log: Logger;
  private readonly propertyDAO: PropertyDAO;
  private readonly subscriptionDAO: SubscriptionDAO;
  private readonly emitterService: EventEmitterService;
  private readonly propertyUnitDAO: PropertyUnitDAO;
  private readonly unitNumberingService: UnitNumberingService;
  private readonly sseService: SSEService;

  constructor({
    propertyDAO,
    propertyUnitDAO,
    emitterService,
    subscriptionDAO,
    unitNumberingService,
    sseService,
  }: IConstructor) {
    this.propertyDAO = propertyDAO;
    this.subscriptionDAO = subscriptionDAO;
    this.emitterService = emitterService;
    this.propertyUnitDAO = propertyUnitDAO;
    this.unitNumberingService = unitNumberingService;
    this.sseService = sseService;
    this.log = createLogger('PropertyUnitWorker');
  }

  /**
   * Called by PropertyUnitQueue once a batch job has failed for good (plan or capacity limits,
   * pattern problems, timeouts, crashed workers) so the units form doesn't report success.
   */
  notifyUnitBatchFailed = async (job: Job<UnitBatchJobData>, error: Error): Promise<void> => {
    await this.sseService.sendToUser(
      job.data.userId,
      job.data.cuid,
      {
        jobId: job.id.toString(),
        jobType: 'unit_batch_create',
        stage: 'failed',
        progress: 0,
        propertyPid: job.data.pid,
        message: error.message,
        error: error.message,
      },
      'job-notification'
    );
  };

  processUnitBatchCreation = async (job: Job<UnitBatchJobData>) => {
    job.progress(10);
    const { units, pid, cuid, userId } = job.data;
    this.log.info(`Processing unit batch creation job ${job.id} for property ${pid}`);

    try {
      job.progress(20);
      const property = await this.propertyDAO.findFirst({ pid, cuid, deletedAt: null });
      if (!property) {
        throw new Error('Property not found');
      }

      // Check subscription-level unit limit
      const subscription = await this.subscriptionDAO.findFirst({ cuid, deletedAt: null });
      if (subscription) {
        const maxUnits = subscriptionPlanConfig.getConfig(subscription.planName).limits.maxUnits;
        if (!isUnlimited(maxUnits)) {
          const remaining = maxUnits - subscription.resourceTracker.unitCount;
          if (remaining <= 0) {
            throw new Error(
              `Unit limit reached. Your ${subscription.planName} plan allows ${maxUnits} units. Upgrade to add more.`
            );
          }
          if (units.length > remaining) {
            throw new Error(
              `Cannot add ${units.length} units. Your ${subscription.planName} plan allows ${maxUnits} units (${remaining} remaining). Upgrade to add more.`
            );
          }
        }
      }

      const canAddUnits = await this.propertyDAO.canAddUnitToProperty(property.id);
      if (!canAddUnits.canAdd) {
        throw new Error('Property has reached maximum unit capacity');
      }

      if (
        canAddUnits.maxCapacity > 0 &&
        canAddUnits.currentCount + units.length > canAddUnits.maxCapacity
      ) {
        throw new Error(
          `Cannot add ${units.length} units. Property has ${canAddUnits.currentCount}/${canAddUnits.maxCapacity} units (including archived). Adding these units would exceed the limit.`
        );
      }

      job.progress(30);

      const unitsForValidation = units.map((unit: any) => ({
        unitNumber: unit.unitNumber,
        floor: unit.floor,
        unitType: unit.unitType,
      }));

      const patternConsistency =
        this.unitNumberingService.validatePatternConsistency(unitsForValidation);
      if (!patternConsistency.isConsistent) {
        throw new Error(`Pattern inconsistency: ${patternConsistency.recommendation}`);
      }

      // A unit number already on the property would hit the unique index inside the
      // transaction and abort every insert, so duplicates are reported per unit instead
      const takenUnitNumbers = new Set(
        await this.propertyUnitDAO.distinct('unitNumber', {
          propertyId: property._id,
          deletedAt: null,
        })
      );

      job.progress(40);

      // Process units in transaction
      const session = await this.propertyUnitDAO.startSession();
      const result = await this.propertyUnitDAO.withTransaction(session, async (session) => {
        const createdUnits = [];
        const errors = [];

        for (let i = 0; i < units.length; i++) {
          const unit = units[i];

          try {
            if (takenUnitNumbers.has(unit.unitNumber)) {
              errors.push({
                unitIndex: i,
                unitNumber: unit.unitNumber,
                error: `Unit number ${unit.unitNumber} already exists on this property`,
              });
              continue;
            }

            // Validate floor correlation
            const floorValidation = this.unitNumberingService.validateUnitNumberFloorCorrelation(
              unit.unitNumber,
              unit.floor
            );

            if (!floorValidation.isValid) {
              errors.push({
                unitIndex: i,
                unitNumber: unit.unitNumber,
                error: floorValidation.message,
              });
              continue;
            }

            // Create unit data
            const newUnitData = {
              ...unit,
              // Typed in dollars, stored in cents; billed in the property's currency
              fees: {
                ...MoneyUtils.parseMoneyInput(unit.fees),
                currency: (property.fees as any)?.currency ?? 'USD',
              },
              cuid,
              propertyId: new Types.ObjectId(property.id),
              createdBy: new Types.ObjectId(userId),
              lastModifiedBy: new Types.ObjectId(userId),
            };

            // Insert unit
            const createdUnit = await this.propertyUnitDAO.insert(newUnitData, session);
            createdUnits.push(createdUnit);
            takenUnitNumbers.add(unit.unitNumber);

            // Update progress
            const progress = 40 + Math.floor((i / units.length) * 50);
            job.progress(progress);
          } catch (error: any) {
            errors.push({
              unitIndex: i,
              unitNumber: unit.unitNumber,
              error: error.message,
            });
          }
        }

        return { createdUnits, errors };
      });

      job.progress(95);

      if (result.createdUnits.length > 0) {
        // Runs after commit: the sync reads unit counts outside the transaction session
        await this.propertyDAO.syncPropertyOccupancyWithUnits(property.id, userId);

        // Listeners are registered in the worker process too (EventListenerSetup):
        // SubscriptionService bumps the unit counter, PropertyService invalidates the cache
        this.emitterService.emit(EventTypes.UNIT_BATCH_CREATED, {
          propertyId: property.id,
          propertyPid: pid,
          cuid,
          userId,
          unitsCreated: result.createdUnits.length,
          unitsFailed: result.errors.length,
        });
      }

      job.progress(100);

      await this.sseService
        .sendToUser(
          userId,
          cuid,
          {
            jobId: job.id.toString(),
            jobType: 'unit_batch_create',
            stage:
              result.createdUnits.length === 0 && result.errors.length > 0 ? 'failed' : 'completed',
            progress: 100,
            propertyPid: pid,
            totalItems: units.length,
            createdCount: result.createdUnits.length,
            errorCount: result.errors.length,
            errors: result.errors,
            message:
              result.errors.length > 0
                ? `${result.createdUnits.length} units created successfully, ${result.errors.length} failed`
                : `All ${result.createdUnits.length} units created successfully`,
          },
          'job-notification'
        )
        .catch((error) =>
          this.log.error({ jobId: job.id, error }, 'Failed to send unit batch result')
        );

      this.log.info(
        `Completed unit batch creation job ${job.id} for property ${pid}: ${result.createdUnits.length}/${units.length} successful`
      );

      const everyUnitFailed = result.createdUnits.length === 0 && result.errors.length > 0;
      return {
        success: !everyUnitFailed,
        processId: job.id,
        data: {
          totalProcessed: units.length,
          successfullyCreated: result.createdUnits.length,
          failed: result.errors.length,
          createdUnits: result.createdUnits,
          errors: result.errors,
        },
        finishedAt: new Date(),
        message:
          result.errors.length > 0
            ? `${result.createdUnits.length} units created successfully, ${result.errors.length} failed`
            : `All ${result.createdUnits.length} units created successfully`,
      };
    } catch (error) {
      this.log.error(`Error processing unit batch creation job ${job.id}:`, error);
      throw error;
    }
  };
}
