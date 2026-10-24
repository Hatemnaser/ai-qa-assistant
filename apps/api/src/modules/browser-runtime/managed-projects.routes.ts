import {timingSafeEqual} from 'node:crypto';
import express,{Router} from 'express';
import {z} from 'zod';
import {runtimeExitV2Schema} from '@oddpath/qa-execution-contract';
import {env} from '../../config/env.js';
import {AppError} from '../../lib/errors.js';
import {createProjectConnectionPreBodyRateLimit} from '../project-connections/project-connections.rateLimit.js';
import {managedProjectsRepository} from './managed-projects.repository.js';

export const managedProjectsRouter=Router();
managedProjectsRouter.use(createProjectConnectionPreBodyRateLimit({ipLimit:600,tokenLimit:600}));
managedProjectsRouter.use((req,res,next)=>{
  try{
    const provided=req.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    // Dispatch may be disabled while a physical Stop still needs observation.
    // Keep only the narrow control adapter available until runtime drain ends.
    if(!env.qaBrowserRuntimeEnabled||(!env.qaManagedRoutingEnabled&&req.path!=='/control'))throw new AppError('Managed routing is unavailable.',404,'NOT_FOUND');
    if(req.get('origin')||req.get('cookie')||!provided||!/^[a-f0-9]{64}$/.test(env.qaManagedRoutingKey)||!timingSafeEqual(Buffer.from(provided,'hex'),Buffer.from(env.qaManagedRoutingKey,'hex')))
      throw new AppError('Managed host authentication required.',401,'MANAGED_HOST_REQUIRED');
    next();
  }catch(error){req.pause();res.shouldKeepAlive=false;res.setHeader('Connection','close');next(error);}
});
// Mounted ahead of session CSRF: authenticated machine adapter, no cookies.
managedProjectsRouter.use(express.json({limit:'4kb'}));
managedProjectsRouter.post('/catalog',async(req,res,next)=>{
  try{
    const input=z.object({after:z.string().min(1).max(120).optional(),manualLogin:z.boolean().default(false),allowProduction:z.boolean().default(false)}).strict().parse(req.body);
    res.json(await managedProjectsRepository.catalog(input.after,input.manualLogin,input.allowProduction));
  }catch(error){next(error);}
});
managedProjectsRouter.post('/control',async(req,res,next)=>{
  try{
    const input=z.object({projectId:z.string().min(1).max(120),executionId:z.string().min(1).max(120),action:z.enum(['status','stop','exit']),exit:runtimeExitV2Schema.optional()}).strict().parse(req.body);
    if((input.action==='exit')!==!!input.exit)throw new AppError('Invalid exit observation.',400,'BROWSER_RUNTIME_INVALID');
    res.json(await managedProjectsRepository.control(input.projectId,input.executionId,input.action,input.exit));
  }catch(error){next(error);}
});
