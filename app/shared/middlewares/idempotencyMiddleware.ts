import { createLogger } from '@utils/index';
import { NextFunction, Response } from 'express';
import { AppRequest } from '@interfaces/utils.interface';

const logger = createLogger('IdempotencyMiddleware');

export const idempotency = async (
  req: AppRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

  if (!idempotencyKey) {
    res.status(400).json({ success: false, message: 'Missing required request header' });
    return;
  }

  if (idempotencyKey.length > 255) {
    res.status(400).json({ success: false, message: 'Invalid request key format' });
    return;
  }

  const { idempotencyCache } = req.container.cradle;
  const userId = req.context?.currentuser?.sub ?? 'anonymous';
  const cuid = req.params?.cuid ?? 'global';
  const routePath = req.route?.path ?? req.path;

  try {
    const claim = await idempotencyCache.claimRouteRequest(
      req.method,
      routePath,
      userId,
      cuid,
      idempotencyKey
    );

    if (typeof claim === 'object') {
      logger.info({ idempotencyKey, cuid }, 'Returning cached idempotent response');
      res.status(claim.statusCode).json(claim.body);
      return;
    }

    if (claim === 'processing') {
      res.status(409).json({
        success: false,
        message: 'A request with this idempotency key is already being processed',
      });
      return;
    }

    // claim === 'claimed' — proceed with the request
    const originalJson = res.json.bind(res);
    res.json = (body: any): Response => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        idempotencyCache
          .finalizeRouteRequest(
            req.method,
            routePath,
            userId,
            cuid,
            idempotencyKey,
            res.statusCode,
            body
          )
          .catch((err: unknown) =>
            logger.error({ err, idempotencyKey, cuid }, 'Failed to finalize idempotent response')
          );
      } else {
        // Non-success response — release the claim so the client can retry
        idempotencyCache
          .releaseRouteClaim(req.method, routePath, userId, cuid, idempotencyKey)
          .catch((err: unknown) =>
            logger.error({ err, idempotencyKey, cuid }, 'Failed to release idempotency claim')
          );
      }
      return originalJson(body);
    };

    next();
  } catch (err) {
    logger.error({ err, idempotencyKey }, 'Idempotency middleware error — failing closed');
    res.status(503).json({ success: false, message: 'Service temporarily unavailable' });
  }
};
