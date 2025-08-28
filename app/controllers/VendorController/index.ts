import Logger from 'bunyan';
import { Response } from 'express';
import { createLogger } from '@utils/index';
import { httpStatusCodes } from '@utils/constants';
import { AppRequest } from '@interfaces/utils.interface';
import { VendorService } from '@services/vendor/vendor.service';
import { IVendorFilterOptions } from '@dao/interfaces/vendorDAO.interface';

export class VendorController {
  private readonly log: Logger;
  private readonly vendorService: VendorService;

  constructor({ vendorService }: { vendorService: VendorService }) {
    this.log = createLogger('VendorController');
    this.vendorService = vendorService;
  }

  getFilteredVendors = async (req: AppRequest, res: Response) => {
    const { cuid } = req.params;
    const { status, businessType, page, limit, sortBy, sort } = req.query;

    const filterOptions: IVendorFilterOptions = {
      status: status as 'active' | 'inactive',
      businessType: businessType as string,
    };

    const paginationOpts = {
      page: page ? parseInt(page as string, 10) : 1,
      limit: limit ? parseInt(limit as string, 10) : 10,
      sortBy: sortBy as string | undefined,
      sort: sort as 'asc' | 'desc' | undefined,
      skip:
        ((page ? parseInt(page as string, 10) : 1) - 1) *
        (limit ? parseInt(limit as string, 10) : 10),
    };

    const result = await this.vendorService.getFilteredVendors(
      cuid as string,
      filterOptions,
      paginationOpts
    );

    res.status(httpStatusCodes.OK).json(result);
  };

  getSingleVendor = async (req: AppRequest, res: Response) => {
    const { cuid, vuid } = req.params;

    const result = await this.vendorService.getVendorInfo(cuid as string, vuid as string);

    res.status(httpStatusCodes.OK).json(result);
  };

  getClientVendors = async (req: AppRequest, res: Response) => {
    const { cuid } = req.params;

    const vendors = await this.vendorService.getClientVendors(cuid as string);

    const result = {
      success: true,
      data: vendors,
      message: 'Client vendors retrieved successfully',
    };

    res.status(httpStatusCodes.OK).json(result);
  };

  getVendorStats = async (req: AppRequest, res: Response) => {
    const { cuid } = req.params;
    const { status } = req.query;

    const result = await this.vendorService.getVendorStats(cuid as string, {
      status: status as 'active' | 'inactive',
    });

    res.status(httpStatusCodes.OK).json(result);
  };
}
