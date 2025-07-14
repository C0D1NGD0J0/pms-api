import Logger from 'bunyan';
import { Types } from 'mongoose';
import { DoneCallback, Job } from 'bull';
import { createLogger } from '@utils/index';
import { EventTypes } from '@interfaces/events.interface';
import { PropertyUnitDAO, PropertyDAO } from '@dao/index';
import { EventEmitterService } from '@services/eventEmitter';
import { UnitBatchJobData } from '@queues/propertyUnit.queue';
import { UnitNumberingService } from '@services/unitNumbering/unitNumbering.service';

interface IConstructor {
  unitNumberingService: UnitNumberingService;
  emitterService: EventEmitterService;
  propertyUnitDAO: PropertyUnitDAO;
  propertyDAO: PropertyDAO;
}

export class PropertyUnitWorker {
  log: Logger;
  private readonly propertyDAO: PropertyDAO;
  private readonly emitterService: EventEmitterService;
  private readonly propertyUnitDAO: PropertyUnitDAO;
  private readonly unitNumberingService: UnitNumberingService;

  constructor({
    propertyDAO,
    propertyUnitDAO,
    emitterService,
    unitNumberingService,
  }: IConstructor) {
    this.propertyDAO = propertyDAO;
    this.emitterService = emitterService;
    this.propertyUnitDAO = propertyUnitDAO;
    this.unitNumberingService = unitNumberingService;
    this.log = createLogger('PropertyUnitWorker');
  }

  processUnitBatchCreation = async (job: Job<UnitBatchJobData>, done: DoneCallback) => {
    job.progress(10);
    const { units, pid, cuid, userId } = job.data;
    this.log.info(`Processing unit batch creation job ${job.id} for property ${pid}`);

    try {
      job.progress(20);
      const property = await this.propertyDAO.findFirst({ pid, cuid, deletedAt: null });
      if (!property) {
        done(new Error('Property not found'), null);
        return;
      }

      const canAddUnits = await this.propertyDAO.canAddUnitToProperty(property.id);
      if (!canAddUnits.canAdd) {
        done(new Error('Property has reached maximum unit capacity'), null);
        return;
      }

      // Additional validation: Check if adding the batch would exceed the limit
      if (
        canAddUnits.maxCapacity > 0 &&
        canAddUnits.currentCount + units.length > canAddUnits.maxCapacity
      ) {
        done(
          new Error(
            `Cannot add ${units.length} units. Property has ${canAddUnits.currentCount}/${canAddUnits.maxCapacity} units (including archived). Adding these units would exceed the limit.`
          ),
          null
        );
        return;
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
        done(new Error(`Pattern inconsistency: ${patternConsistency.recommendation}`), null);
        return;
      }

      job.progress(40);

      // Process units in transaction
      const session = await this.propertyUnitDAO.startSession();
      const result = await this.propertyUnitDAO.withTransaction(session, async (session) => {
        const createdUnits = [];
        const errors = [];

        for (let i = 0; i < units.length; i++) {
          const unit = units[i];

          try {
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
              cuid,
              propertyId: new Types.ObjectId(property.id),
              createdBy: new Types.ObjectId(userId),
              lastModifiedBy: new Types.ObjectId(userId),
            };

            // Insert unit
            const createdUnit = await this.propertyUnitDAO.insert(newUnitData, session);
            createdUnits.push(createdUnit);

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

        // Update property occupancy
        if (createdUnits.length > 0) {
          await this.propertyDAO.syncPropertyOccupancyWithUnits(property.id, userId);
        }

        return { createdUnits, errors };
      });

      job.progress(95);

      // Emit property update event
      this.emitterService.emit(EventTypes.PROPERTY_CREATED, {
        propertyId: pid,
        clientId: cuid,
        unitsCreated: result.createdUnits.length,
        maxAllowedUnits: units.length,
      });

      job.progress(100);

      done(null, {
        success: true,
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
      });

      this.log.info(
        `Completed unit batch creation job ${job.id} for property ${pid}: ${result.createdUnits.length}/${units.length} successful`
      );
    } catch (error) {
      this.log.error(`Error processing unit batch creation job ${job.id}:`, error);
      done(error, null);
    }
  };
}
