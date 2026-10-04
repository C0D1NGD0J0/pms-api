import { Types } from 'mongoose';
import { Response } from 'express';
import { httpStatusCodes } from '@utils/constants';
import { AppRequest } from '@interfaces/utils.interface';
import { ExpenseService } from '@services/expense/expense.service';
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

    const [receipt] = await this.mediaUploadService.uploadRequestFiles(req, {
      resourceName: 'expense',
      resourceId: expuid,
      fieldName: 'receipt',
      actorId: userId,
    });

    if (!receipt) {
      return res.status(httpStatusCodes.BAD_REQUEST).json({
        success: false,
        message: 'No file provided',
      });
    }

    // Persist the uploaded receipt on the expense document
    await this.expenseService.updateExpense(expuid, cuid, {
      receipt: {
        url: receipt.url,
        filename: receipt.filename,
        key: receipt.key ?? '',
        uploadedAt: new Date(),
        uploadedBy: new Types.ObjectId(userId),
      },
    });

    return res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'Receipt uploaded',
    });
  }
}
