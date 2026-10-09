import { Router, type Request, type Response, type NextFunction } from "express";
import { requireAuth } from "../auth/auth.middleware.js";
import { sessionsService } from "./sessions.service.js";
import { createSessionSchema, sessionParams, sessionTurnSchema, updateSessionSchema, retrySessionTurnSchema } from "./sessions.schema.js";
import { deleteTestSessionSchema, prepareTestSessionSchema, resumeTestPreparationSchema } from "../test-sessions/test-sessions.schema.js";

export const sessionsRouter = Router();
sessionsRouter.use(requireAuth);
const handle = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { void fn(req, res).catch(next); };
const identity = (req: Request) => ({ userId: req.authUser!.id, sessionId: sessionParams.parse(req.params).sessionId });
sessionsRouter.get("/", handle(async (req, res) => res.json(await sessionsService.list(req.authUser!.id))));
sessionsRouter.post("/", handle(async (req, res) => res.status(201).json({ session: await sessionsService.create(req.authUser!.id, createSessionSchema.parse(req.body)) })));
sessionsRouter.get("/:sessionId", handle(async (req, res) => {
  const { userId, sessionId } = identity(req);
  res.json({ session: await sessionsService.read(userId, sessionId) });
}));
sessionsRouter.post("/:sessionId/turns", handle(async (req, res) => {
  const { userId, sessionId } = identity(req);
  res.status(202).json(await sessionsService.turn(userId, sessionId, sessionTurnSchema.parse(req.body)));
}));
sessionsRouter.post("/:sessionId/turns/:turnId/retry", handle(async (req, res) => {
  const { userId, sessionId } = identity(req);
  const turnId = sessionParams.parse({ sessionId: req.params.turnId }).sessionId;
  res.status(202).json({ session: await sessionsService.retry(userId, sessionId, turnId, retrySessionTurnSchema.parse(req.body)) });
}));
sessionsRouter.patch("/:sessionId", handle(async (req, res) => {
  const { userId, sessionId } = identity(req);
  res.json({ session: await sessionsService.update(userId, sessionId, updateSessionSchema.parse(req.body)) });
}));
sessionsRouter.delete("/:sessionId", handle(async (req, res) => {
  const { userId, sessionId } = identity(req);
  await sessionsService.remove(userId, sessionId, deleteTestSessionSchema.extend({ expectedUpdatedAt: updateSessionSchema.shape.expectedUpdatedAt }).parse(req.body));
  res.status(204).end();
}));
sessionsRouter.post("/:sessionId/prepare", handle(async (req, res) => {
  const { userId, sessionId } = identity(req);
  res.status(202).json({ session: await sessionsService.prepare(userId, sessionId, prepareTestSessionSchema.parse(req.body)) });
}));
sessionsRouter.post("/:sessionId/preparation", handle(async (req, res) => {
  const { userId, sessionId } = identity(req);
  res.status(202).json({ session: await sessionsService.resume(userId, sessionId, resumeTestPreparationSchema.parse(req.body)) });
}));
