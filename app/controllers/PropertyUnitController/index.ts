import { Response, Request } from 'express';
import { httpStatusCodes } from '@utils/index';
import { IPropertyFilterQuery } from '@interfaces/property.interface';
import { PropertyUnitService, PropertyService } from '@services/property';

interface IConstructor {
  propertyUnitService: PropertyUnitService;
  propertyService: PropertyService;
}

export class PropertyUnitController {
  private readonly propertyService: PropertyService;
  private readonly propertyUnitService: PropertyUnitService;

  constructor({ propertyService, propertyUnitService }: IConstructor) {
    this.propertyService = propertyService;
    this.propertyUnitService = propertyUnitService;
  }

  addUnit = async (req: Request, res: Response) => {
    const unitData = req.body;
    const { currentUser } = req.context;
    const { cid, pid } = req.params;

    const result = await this.propertyUnitService.addPropertyUnit(
      { cid, pid, currentUser },
      unitData
    );
    res.status(httpStatusCodes.OK).json(result);
  };

  getPropertyUnits = async (req: Request, res: Response) => {
    const { cid, pid } = req.params;
    const { page, limit, sort, sortBy } = req.query;
    const queryParams: IPropertyFilterQuery = {
      pagination: {
        page: parseInt(page as string) || 1,
        limit: parseInt(limit as string) || 10,
        sortBy: sortBy as string,
        sort: sort as string,
      },
      filters: {},
    };
    const { currentUser } = req.context;

    const result = await this.propertyUnitService.getPropertyUnits(
      { cid, pid, currentUser },
      queryParams
    );
    res.status(httpStatusCodes.OK).json(result);
  };

  getPropertyUnit = async (req: Request, res: Response) => {
    const { cid, pid, unitId } = req.params;
    const { currentUser } = req.context;

    const result = await this.propertyUnitService.getPropertyUnit(
      { cid, pid, unitId },
      currentUser
    );
    res.status(httpStatusCodes.OK).json(result);
  };

  updateUnit = async (req: Request, res: Response) => {
    const { cid, pid, unitId } = req.params;
    const { currentUser } = req.context;
    const unitData = req.body;

    const result = await this.propertyUnitService.updateUnit(
      { cid, pid, unitId, unitData },
      currentUser
    );
    res.status(httpStatusCodes.OK).json(result);
  };

  updateUnitStatus = async (req: Request, res: Response) => {
    const { cid, pid, unitId } = req.params;
    const { currentUser } = req.context;
    const { status } = req.body;

    const result = await this.propertyUnitService.updateUnitStatus(
      { cid, pid, unitId, status },
      currentUser
    );
    res.status(httpStatusCodes.OK).json(result);
  };

  archiveUnit = async (req: Request, res: Response) => {
    const { cid, pid, unitId } = req.params;
    const { currentUser } = req.context;

    const result = await this.propertyUnitService.archiveUnit({ cid, pid, unitId }, currentUser);
    res.status(httpStatusCodes.OK).json(result);
  };

  setupInpection = async (req: Request, res: Response) => {
    const { cid, pid, unitId } = req.params;
    const { currentUser } = req.context;
    const inspectionData = req.body;

    const result = await this.propertyUnitService.setupInspection(
      { cid, pid, unitId, inspectionData },
      currentUser
    );
    res.status(httpStatusCodes.OK).json(result);
  };

  addDocumentToUnit = async (req: Request, res: Response) => {
    const { cid, pid, unitId } = req.params;
    const { currentUser } = req.context;
    const documentData = req.body;

    const result = await this.propertyUnitService.addDocumentToUnit(
      { cid, pid, unitId, documentData },
      currentUser
    );
    res.status(httpStatusCodes.OK).json(result);
  };

  deleteDocumentFromUnit = async (req: Request, res: Response) => {
    const { cid, pid, unitId, documentId } = req.params;
    const { currentUser } = req.context;

    const result = await this.propertyUnitService.deleteDocumentFromUnit(
      { cid, pid, unitId, documentId },
      currentUser
    );
    res.status(httpStatusCodes.OK).json(result);
  };
}
