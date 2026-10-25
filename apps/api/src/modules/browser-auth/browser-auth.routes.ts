import { Router } from 'express';
import { z } from 'zod';
import { browserAuthRepository } from './browser-auth.repository.js';
export const browserAuthRouter=Router({mergeParams:true});
const project=z.object({projectId:z.string().min(1).max(120)});
browserAuthRouter.get('/',async(req,res,next)=>{try{const p=project.parse(req.params);res.setHeader('Cache-Control','no-store');res.json({states:await browserAuthRepository.list(req.authUser!.id,p.projectId)});}catch(error){next(error);}});
browserAuthRouter.post('/:id/revoke',async(req,res,next)=>{try{const p=project.extend({id:z.string().uuid()}).parse(req.params);z.object({acknowledgeRevocation:z.literal(true)}).strict().parse(req.body);res.json(await browserAuthRepository.revoke(req.authUser!.id,p.projectId,p.id));}catch(error){next(error);}});
