import { Router, type Request, type Response, type NextFunction } from "express";
import { activateTestSessionSchema, createTestSessionSchema, deleteTestSessionSchema, prepareTestSessionSchema, resumeTestPreparationSchema, testSessionParams, testSessionProjectParams, testSessionTurnSchema, updateTestSessionSchema } from "./test-sessions.schema.js";
import { testSessionsService } from "./test-sessions.service.js";

export const testSessionsRouter = Router({ mergeParams: true });
const handle = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { void fn(req, res).catch(next); };
testSessionsRouter.get("/", handle(async (req, res) => {
  const { projectId } = testSessionProjectParams.parse(req.params);
  res.json(await testSessionsService.list(req.authUser!.id, projectId));
}));
testSessionsRouter.post("/", handle(async (req, res) => {
  const { projectId } = testSessionProjectParams.parse(req.params);
  res.status(201).json({ session: await testSessionsService.create(req.authUser!.id, projectId, createTestSessionSchema.parse(req.body)) });
}));
testSessionsRouter.post("/activate", handle(async (req, res) => {
  const { projectId } = testSessionProjectParams.parse(req.params);
  res.json({ session: await testSessionsService.activate(req.authUser!.id, projectId, activateTestSessionSchema.parse(req.body)) });
}));
testSessionsRouter.get("/:sessionId", handle(async (req, res) => {
  const { projectId, sessionId } = testSessionParams.parse(req.params);
  res.json({ session: await testSessionsService.get(req.authUser!.id, projectId, sessionId) });
}));
testSessionsRouter.patch("/:sessionId", handle(async (req, res) => {
  const { projectId, sessionId } = testSessionParams.parse(req.params);
  res.json({ session: await testSessionsService.update(req.authUser!.id, projectId, sessionId, updateTestSessionSchema.parse(req.body)) });
}));
testSessionsRouter.delete("/:sessionId", handle(async (req, res) => {
  const { projectId, sessionId } = testSessionParams.parse(req.params);
  await testSessionsService.delete(req.authUser!.id, projectId, sessionId, deleteTestSessionSchema.parse(req.body));
  res.status(204).end();
}));
testSessionsRouter.post("/:sessionId/turns", handle(async (req, res) => {
  const { projectId, sessionId } = testSessionParams.parse(req.params);
  res.status(202).json(await testSessionsService.turn(req.authUser!.id, projectId, sessionId, testSessionTurnSchema.parse(req.body)));
}));
testSessionsRouter.post("/:sessionId/prepare", handle(async (req, res) => {
  const { projectId, sessionId } = testSessionParams.parse(req.params);
  res.status(202).json({ session: await testSessionsService.prepare(req.authUser!.id, projectId, sessionId, prepareTestSessionSchema.parse(req.body)) });
}));
testSessionsRouter.post("/:sessionId/preparation", handle(async (req, res) => {
  const { projectId, sessionId } = testSessionParams.parse(req.params);
  res.status(202).json({ session: await testSessionsService.resume(req.authUser!.id, projectId, sessionId, resumeTestPreparationSchema.parse(req.body)) });
}));
