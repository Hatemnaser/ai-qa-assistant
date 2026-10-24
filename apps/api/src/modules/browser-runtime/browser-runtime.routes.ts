import { Router } from "express";
import { runtimeRegistrationV2Schema, runtimeExitV2Schema, runtimeLoginAckSchema } from "@oddpath/qa-execution-contract";
import { z } from "zod";
import { savedLoginConsentSchema,browserStateTransferSchema } from '@oddpath/qa-execution-contract';
import { browserRuntimeRepository } from "./browser-runtime.repository.js";
import { browserRuntimeService } from "./browser-runtime.service.js";

const params = z.object({ projectId: z.string().min(1).max(120), executionId: z.string().min(1).max(120) }).strict();
export const browserRuntimeRouter = Router({ mergeParams: true });
browserRuntimeRouter.post('/:executionId/login/save-consent',async(req,res,next)=>{try{browserRuntimeService.requireEnabled();const p=params.parse(req.params),body=savedLoginConsentSchema.parse(req.body);await browserRuntimeRepository.saveConsentOwned(req.authUser!.id,p.projectId,p.executionId,body.controlEpoch,body.saveLogin);res.json(await browserRuntimeService.status(req.authUser!.id,p.projectId,p.executionId));}catch(error){next(error);}});
browserRuntimeRouter.get('/:executionId', async (req, res, next) => { try { const p = params.parse(req.params); res.json(await browserRuntimeService.status(req.authUser!.id, p.projectId, p.executionId)); } catch (error) { next(error); } });
browserRuntimeRouter.post('/:executionId/viewer', async (req, res, next) => { try { const p = params.parse(req.params); res.json(await browserRuntimeService.viewer(req.authUser!.id, p.projectId, p.executionId)); } catch (error) { next(error); } });
browserRuntimeRouter.post('/:executionId/login/viewer', async (req, res, next) => { try { const p = params.parse(req.params); res.json(await browserRuntimeService.loginViewer(req.authUser!.id,p.projectId,p.executionId)); } catch(error) { next(error); } });
for (const [path, action] of [['begin','BEGIN'],['complete','COMPLETE']] as const) browserRuntimeRouter.post(`/:executionId/login/${path}`, async(req,res,next) => { try {
  const p=params.parse(req.params), body=z.object({controlEpoch:z.string().uuid(), ...(action === 'COMPLETE' ? {acknowledgeFinished:z.literal(true)} : {})}).strict().parse(req.body);
  res.json(await browserRuntimeService.login(req.authUser!.id,p.projectId,p.executionId,body.controlEpoch,action));
} catch(error) { next(error); } });

// Mounted only under the authenticated v2 Runner adapter and its scopes.
export const runtimeRunnerRouter = Router({ mergeParams: true });
const execution = z.object({ executionId: z.string().min(1).max(120) }).strict();
for(const mode of ['capture','restore'] as const)runtimeRunnerRouter.post(`/saved-state/${mode}`,async(req,res,next)=>{try{
  browserRuntimeService.requireEnabled();
  const p=execution.parse(req.params),lease=z.object({claimId:z.string().uuid(),leaseToken:z.string().min(32).max(240)}).parse({claimId:req.get('x-oddpath-claim-id'),leaseToken:req.get('x-oddpath-execution-lease')});
  res.setHeader('Cache-Control','no-store');res.json(mode==='capture'?await browserRuntimeRepository.captureState(req.qaIntegration!.connectionId,p.executionId,lease,browserStateTransferSchema.parse(req.body)):await browserRuntimeRepository.restoreState(req.qaIntegration!.connectionId,p.executionId,lease));
}catch(error){next(error);}});
runtimeRunnerRouter.use((_req, _res, next) => { try { browserRuntimeService.requireEnabled(); next(); } catch (error) { next(error); } });
runtimeRunnerRouter.post('/', async (req, res, next) => { try {
  const p = execution.parse(req.params), lease = z.object({ claimId: z.string().uuid(), leaseToken: z.string().min(32).max(240) }).parse({ claimId: req.get('x-oddpath-claim-id'), leaseToken: req.get('x-oddpath-execution-lease') });
  res.json(await browserRuntimeRepository.begin(req.qaIntegration!.connectionId, p.executionId, lease, runtimeRegistrationV2Schema.parse(req.body)));
} catch (error) { next(error); } });
runtimeRunnerRouter.get('/', async (req, res, next) => { try { const p = execution.parse(req.params); res.json(await browserRuntimeRepository.status(req.qaIntegration!.connectionId, p.executionId)); } catch (error) { next(error); } });
runtimeRunnerRouter.post('/login-state', async(req,res,next) => { try {
  const p=execution.parse(req.params), lease=z.object({claimId:z.string().uuid(),leaseToken:z.string().min(32).max(240)}).parse({claimId:req.get('x-oddpath-claim-id'),leaseToken:req.get('x-oddpath-execution-lease')});
  res.json(await browserRuntimeRepository.loginAck(req.qaIntegration!.connectionId,p.executionId,lease,runtimeLoginAckSchema.parse(req.body)));
} catch(error) { next(error); } });
runtimeRunnerRouter.post('/stop', async (req, res, next) => { try { const p = execution.parse(req.params); res.json(await browserRuntimeRepository.requestStop(req.qaIntegration!.connectionId, p.executionId)); } catch (error) { next(error); } });
runtimeRunnerRouter.post('/exit', async (req, res, next) => { try { const p = execution.parse(req.params); res.json(await browserRuntimeRepository.exit(req.qaIntegration!.connectionId, p.executionId, runtimeExitV2Schema.parse(req.body))); } catch (error) { next(error); } });
