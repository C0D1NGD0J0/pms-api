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

  getVendorTeamMembers = async (req: AppRequest, res: Response): Promise<void> => {
    const { cuid, vuid } = req.params;
    const { page, limit, status } = req.query;

    const paginationOpts = {
      page: page ? parseInt(page as string, 10) : 1,
      limit: limit ? parseInt(limit as string, 10) : 10,
      skip:
        ((page ? parseInt(page as string, 10) : 1) - 1) *
        (limit ? parseInt(limit as string, 10) : 10),
    };

    const result = await this.vendorService.getVendorTeamMembers(
      req.context,
      cuid,
      vuid,
      status as 'active' | 'inactive' | undefined,
      paginationOpts
    );

    res.status(httpStatusCodes.OK).json(result);
  };

  getVendorForEdit = async (req: AppRequest, res: Response): Promise<void> => {
    const { cuid, vuid } = req.params;
    const currentUser = req.context.currentuser!;

    try {
      // Get vendor document
      const vendorDoc = await this.vendorService.getVendorById(vuid);
      if (!vendorDoc) {
        res.status(httpStatusCodes.NOT_FOUND).json({
          success: false,
          message: 'Vendor not found',
        });
        return;
      }

      // Find the client connection for this vendor
      const clientConnection = vendorDoc.connectedClients?.find((cc: any) => cc.cuid === cuid);
      if (!clientConnection) {
        res.status(httpStatusCodes.NOT_FOUND).json({
          success: false,
          message: 'Vendor is not connected to this client',
        });
        return;
      }

      // Check if current user is the primary account holder
      if (clientConnection.primaryAccountHolder?.toString() !== currentUser.uid) {
        res.status(httpStatusCodes.FORBIDDEN).json({
          success: false,
          message: 'Only primary account holders can access vendor edit data',
        });
        return;
      }

      // Return vendor data formatted for editing
      const vendorData = {
        vuid: vendorDoc.vuid,
        companyName: vendorDoc.companyName,
        businessType: vendorDoc.businessType,
        registrationNumber: vendorDoc.registrationNumber,
        taxId: vendorDoc.taxId,
        servicesOffered: vendorDoc.servicesOffered,
        address: vendorDoc.address,
        contactPerson: vendorDoc.contactPerson,
        serviceAreas: vendorDoc.serviceAreas,
        insuranceInfo: vendorDoc.insuranceInfo,
        yearsInBusiness: vendorDoc.yearsInBusiness,
        isConnected: clientConnection.isConnected,
        primaryAccountHolder: clientConnection.primaryAccountHolder,
      };

      res.status(httpStatusCodes.OK).json({
        success: true,
        data: vendorData,
        message: 'Vendor data retrieved successfully',
      });
    } catch (error) {
      this.log.error('Error retrieving vendor for edit:', error);
      res.status(httpStatusCodes.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Error retrieving vendor data',
      });
    }
  };

  updateVendorDetails = async (req: AppRequest, res: Response): Promise<void> => {
    const { cuid, vuid } = req.params;
    const updateData = req.body;
    const currentUser = req.context.currentuser!;

    // Check if user is primary account holder for this vendor
    const vendorDoc = await this.vendorService.getVendorById(vuid);
    if (!vendorDoc) {
      res.status(httpStatusCodes.NOT_FOUND).json({
        success: false,
        message: 'Vendor not found',
      });
      return;
    }

    // Find the client connection for this vendor
    const clientConnection = vendorDoc.connectedClients?.find((cc: any) => cc.cuid === cuid);
    if (!clientConnection) {
      res.status(httpStatusCodes.NOT_FOUND).json({
        success: false,
        message: 'Vendor is not connected to this client',
      });
      return;
    }

    // Check if current user is the primary account holder
    if (clientConnection.primaryAccountHolder?.toString() !== currentUser.uid) {
      res.status(httpStatusCodes.FORBIDDEN).json({
        success: false,
        message: 'Only primary account holders can update vendor business information',
      });
      return;
    }

    // Update vendor information
    const result = await this.vendorService.updateVendorInfo(vuid, updateData);

    res.status(httpStatusCodes.OK).json(result);
  };
}
