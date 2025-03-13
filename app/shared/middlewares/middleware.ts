import { container } from '@di/index';
import { Response, Request, NextFunction } from 'express';

export const scopedMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // Create a scoped contaner
  const scope = container.createScope();
  // Attach the scoped container to the request
  req.container = scope;
  next();
};
