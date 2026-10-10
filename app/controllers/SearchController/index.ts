import { Response } from 'express';
import { httpStatusCodes } from '@utils/index';
import { AppRequest } from '@interfaces/utils.interface';
import { SearchService } from '@services/search/search.service';

interface IConstructor {
  searchService: SearchService;
}

export class SearchController {
  private readonly searchService: SearchService;

  constructor({ searchService }: IConstructor) {
    this.searchService = searchService;
  }

  async globalSearch(req: AppRequest, res: Response): Promise<Response> {
    const { cuid } = req.params;
    const { q } = req.query as { q: string };
    const result = await this.searchService.globalSearch(cuid, req.context, q);
    return res.status(httpStatusCodes.OK).json(result);
  }
}
