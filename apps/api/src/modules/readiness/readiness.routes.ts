import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { InMemoryFixedWindowRateLimiter } from '../../lib/fixed-window-rate-limiter.js';
import { readinessService } from './readiness.service.js';

export function createReadinessRouter(service = readinessService) {
  const router = Router({ mergeParams: true }), limiter = new InMemoryFixedWindowRateLimiter({ maxAttempts: 10, windowMs: 60_000 });
  const id = z.string().min(1).max(120), params = z.object({ projectId: id, requestId: id, candidateId: id.optional() }).strict();
  router.use((req, _res, next) => {
    if (req.method !== 'GET' && limiter.consume(req.authUser!.id, Date.now()).limited) return next(new AppError('Too many readiness changes.', 429, 'READINESS_RATE_LIMITED'));
    next();
  });
  router.get('/', async (req, res, next) => { try { const p = params.parse(req.params); res.json(await service.list({ ...p, userId: req.authUser!.id })); } catch (e) { next(e); } });
  router.post('/', async (req, res, next) => { try { const p = params.parse(req.params); res.status(201).json({ candidate: await service.create({ ...p, userId: req.authUser!.id }, req.body) }); } catch (e) { next(e); } });
  router.post('/:candidateId/evaluations', async (req, res, next) => { try { const p = params.parse(req.params); res.status(201).json({ evaluation: await service.evaluate({ ...p, userId: req.authUser!.id }, p.candidateId!, req.body) }); } catch (e) { next(e); } });
  return router;
}
export const readinessRouter = createReadinessRouter();
