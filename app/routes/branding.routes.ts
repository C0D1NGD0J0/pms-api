import { asyncWrapper } from '@utils/index';
import { basicLimiter } from '@shared/middlewares';
import { Response, Request, Router } from 'express';
import { loadBrandConfig, CACHE_TTL_MS } from '@branding/index';

const CUID_FORMAT = /^[a-zA-Z0-9_-]{8,50}$/;

const router = Router();

router.get(
  '/:cuid',
  basicLimiter(),
  asyncWrapper(async (req: Request, res: Response) => {
    const { cuid } = req.params;

    if (!CUID_FORMAT.test(cuid)) {
      res.status(400).json({ success: false, message: 'Invalid cuid format' });
      return;
    }

    const config = await loadBrandConfig(cuid);
    const maxAge = Math.floor(CACHE_TTL_MS / 1000);
    res.set('Cache-Control', `public, max-age=${maxAge}, stale-while-revalidate=${maxAge * 2}`);
    res.json(config);
  })
);

export default router;
