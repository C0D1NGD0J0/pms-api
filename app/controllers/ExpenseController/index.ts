import { Types } from 'mongoose';
import { Response } from 'express';
import { httpStatusCodes } from '@utils/constants';
import { ExpenseService } from '@services/expense/expense.service';
import { ResourceContext, AppRequest } from '@interfaces/utils.interface';
import { MediaUploadService } from '@services/mediaUpload/mediaUpload.service';

export class ExpenseController {
  private readonly expenseService: ExpenseService;
  private readonly mediaUploadService: MediaUploadService;

  constructor({
    expenseService,
    mediaUploadService,
  }: {
    expenseService: ExpenseService;
    mediaUploadService: MediaUploadService;
  }) {
    this.expenseService = expenseService;
    this.mediaUploadService = mediaUploadService;
  }

  async createExpense(req: AppRequest, res: Response): Promise<Response> {
    const { cuid } = req.params;
    const userId = req.context.currentuser!.sub;
    const result = await this.expenseService.createExpense(cuid, userId, req.body);
    return res.status(httpStatusCodes.CREATED).json(result);
  }

  async listExpenses(req: AppRequest, res: Response): Promise<Response> {
    const { cuid } = req.params;
    const result = await this.expenseService.listExpenses(cuid, req.query as any);
    return res.status(httpStatusCodes.OK).json(result);
  }

  async getPnLSummary(req: AppRequest, res: Response): Promise<Response> {
    const { cuid } = req.params;
    const { from, to } = req.query as { from: string; to: string };
    const result = await this.expenseService.getPnLSummary(cuid, from, to);
    return res.status(httpStatusCodes.OK).json(result);
  }

  async getExpense(req: AppRequest, res: Response): Promise<Response> {
    const { cuid, expuid } = req.params;
    const result = await this.expenseService.getExpenseById(expuid, cuid);
    return res.status(httpStatusCodes.OK).json(result);
  }

  async updateExpense(req: AppRequest, res: Response): Promise<Response> {
    const { cuid, expuid } = req.params;
    const result = await this.expenseService.updateExpense(expuid, cuid, req.body);
    return res.status(httpStatusCodes.OK).json(result);
  }

  async deleteExpense(req: AppRequest, res: Response): Promise<Response> {
    const { cuid, expuid } = req.params;
    const result = await this.expenseService.softDeleteExpense(expuid, cuid);
    return res.status(httpStatusCodes.OK).json(result);
  }

  async attachReceipt(req: AppRequest, res: Response): Promise<Response> {
    const { cuid, expuid } = req.params;
    const userId = req.context.currentuser!.sub;

    const uploadResult = await this.mediaUploadService.handleFiles(req, {
      primaryResourceId: expuid,
      uploadedBy: userId,
      resourceContext: ResourceContext.EXPENSE,
    });

    if (!uploadResult.hasFiles) {
      return res.status(httpStatusCodes.BAD_REQUEST).json({
        success: false,
        message: 'No file provided',
      });
    }

    // Persist receipt metadata to the expense document
    const file = req.scannedFiles?.[0];
    if (file) {
      await this.expenseService.updateExpense(expuid, cuid, {
        receipt: {
          url: file.url || '',
          filename: file.originalFileName || file.filename || '',
          key: file.key || '',
          uploadedAt: new Date(),
          uploadedBy: new Types.ObjectId(userId),
        },
      });
    }

    return res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'Receipt uploaded',
      fileUpload: uploadResult.message,
      processedFiles: uploadResult.processedFiles,
    });
  }
}
