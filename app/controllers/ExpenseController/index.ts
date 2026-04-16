import { Response } from 'express';
import { AppRequest } from '@interfaces/utils.interface';
import { ExpenseService } from '@services/expense/expense.service';

export class ExpenseController {
  private readonly expenseService: ExpenseService;

  constructor({ expenseService }: { expenseService: ExpenseService }) {
    this.expenseService = expenseService;
  }

  async createExpense(req: AppRequest, res: Response): Promise<Response> {
    const { cuid } = req.params;
    const userId = req.context.currentuser!.sub;
    const result = await this.expenseService.createExpense(cuid, userId, req.body);
    return res.status(201).json(result);
  }

  async listExpenses(req: AppRequest, res: Response): Promise<Response> {
    const { cuid } = req.params;
    const result = await this.expenseService.listExpenses(cuid, req.query as any);
    return res.status(200).json(result);
  }

  async getPnLSummary(req: AppRequest, res: Response): Promise<Response> {
    const { cuid } = req.params;
    const { from, to } = req.query as { from: string; to: string };
    const result = await this.expenseService.getPnLSummary(cuid, from, to);
    return res.status(200).json(result);
  }

  async getExpense(req: AppRequest, res: Response): Promise<Response> {
    const { cuid, expuid } = req.params;
    const result = await this.expenseService.getExpenseById(expuid, cuid);
    return res.status(200).json(result);
  }

  async updateExpense(req: AppRequest, res: Response): Promise<Response> {
    const { cuid, expuid } = req.params;
    const result = await this.expenseService.updateExpense(expuid, cuid, req.body);
    return res.status(200).json(result);
  }

  async deleteExpense(req: AppRequest, res: Response): Promise<Response> {
    const { cuid, expuid } = req.params;
    const result = await this.expenseService.softDeleteExpense(expuid, cuid);
    return res.status(200).json(result);
  }
}
