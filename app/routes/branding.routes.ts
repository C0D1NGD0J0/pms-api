import { loadBrandConfig } from '@branding/index';
import { basicLimiter } from '@shared/middlewares';
import { Response, Request, Router } from 'express';

const router = Router();

router.get('/:cuid', basicLimiter(), async (req: Request, res: Response) => {
  const config = await loadBrandConfig(req.params.cuid);
  res.set('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
  res.json(config);
});

export default router;
