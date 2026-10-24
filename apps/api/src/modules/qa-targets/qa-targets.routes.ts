import { Router } from "express";
import { AppError } from "../../lib/errors.js";
import { InMemoryFixedWindowRateLimiter } from "../../lib/fixed-window-rate-limiter.js";
import { targetParamsSchema } from "./qa-targets.schema.js";
import { qaTargetsService } from "./qa-targets.service.js";

export const qaTargetsRouter = Router({ mergeParams: true });
const limiter = new InMemoryFixedWindowRateLimiter({ maxAttempts: 10, windowMs: 60_000 });
qaTargetsRouter.use((req, _res, next) => {
  if (req.method !== "GET" && limiter.consume(req.authUser!.id, Date.now()).limited) return next(new AppError("Too many target changes or verification requests.", 429, "QA_TARGET_RATE_LIMITED"));
  next();
});
qaTargetsRouter.get("/", async (req, res, next) => { try { const p = targetParamsSchema.parse(req.params); res.json({ targets: await qaTargetsService.list(req.authUser!.id, p.projectId) }); } catch (error) { next(error); } });
qaTargetsRouter.post("/", async (req, res, next) => { try { const p = targetParamsSchema.parse(req.params); res.status(201).json({ target: await qaTargetsService.create(req.authUser!.id, p.projectId, req.body) }); } catch (error) { next(error); } });
qaTargetsRouter.post("/:targetId/revisions", async (req, res, next) => { try { const p = targetParamsSchema.parse(req.params); res.status(201).json({ target: await qaTargetsService.revise(req.authUser!.id, p.projectId, p.targetId!, req.body) }); } catch (error) { next(error); } });
qaTargetsRouter.post("/:targetId/challenges", async (req, res, next) => { try { const p = targetParamsSchema.parse(req.params); res.status(201).json(await qaTargetsService.challenge(req.authUser!.id, p.projectId, p.targetId!, req.body)); } catch (error) { next(error); } });
qaTargetsRouter.post("/:targetId/challenges/:verificationId/verify", async (req, res, next) => { try { const p = targetParamsSchema.parse(req.params); res.json(await qaTargetsService.verify(req.authUser!.id, p.projectId, p.targetId!, p.verificationId!)); } catch (error) { next(error); } });
