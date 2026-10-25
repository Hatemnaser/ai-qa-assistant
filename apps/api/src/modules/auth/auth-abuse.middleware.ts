import { createHmac } from 'node:crypto';
import type { NextFunction,Request,Response } from 'express';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { authAbuseRepository } from './auth-abuse.repository.js';
import type { AuthAbuseBudget,AuthAbuseRepository } from './auth-abuse.types.js';

const routes=new Map([
 ['/login',env.authLoginRateLimitMax],['/register',env.authRegisterRateLimitMax],
 ['/forgot-password',env.authForgotPasswordRateLimitMax],['/resend-verification',env.authResendVerificationRateLimitMax],
 ['/reset-password',env.authResetPasswordRateLimitMax],['/verify-email',env.authVerifyEmailRateLimitMax],
]);
const mailRoutes=new Set(['/register','/forgot-password','/resend-verification']);
export function authAbuseKey(scope:string,identity:string) {
  return createHmac('sha256',env.usageIpHashSalt).update(JSON.stringify(['auth06c',scope,identity])).digest('hex');
}
export function createDurableAuthAbuseMiddleware(stage:'ip'|'email',repository:AuthAbuseRepository=authAbuseRepository) {
  return async(req:Request,res:Response,next:NextFunction)=>{
    const route=req.path.toLowerCase().replace(/\/+$/,'')||'/',limit=routes.get(route);
    if (env.authAbuseStore!=='postgres' || req.method!=='POST' || !limit) {next();return;}
    const budget=(scope:string,id:string,max:number,windowMs=env.authRateLimitWindowMs):AuthAbuseBudget=>({key:authAbuseKey(scope,id),limit:max,windowMs});
    const email=typeof req.body?.email==='string'?req.body.email.trim().toLowerCase():'';
    const budgets=stage==='ip' ? [budget('global','mutations',env.authGlobalRateLimitMax),budget('ip:'+route,req.ip||req.socket.remoteAddress||'unknown',limit)]
      : email ? [budget('email:'+route,email,limit),...(mailRoutes.has(route)?[budget('mail:day','global',env.authEmailDailyMax,86400000),budget('mail:recipient',email,env.authRecipientDailyMax,86400000)]:[])] : [];
    if (!budgets.length) {next();return;}
    try {
      // GC is a separate transaction, before admission locks; it cannot invert
      // the row/advisory lock ordering of concurrent consumers.
      await repository.cleanup();
      const result=await repository.consume(budgets);
      if (!result.limited) {next();return;}
      if (stage==='ip') {req.pause();res.shouldKeepAlive=false;res.setHeader('Connection','close');}
      res.setHeader('Retry-After',String(result.retryAfterSeconds));
      res.status(429).json({code:'RATE_LIMITED',error:'Too many attempts. Please try again later.',message:'Too many attempts. Please try again later.'});
    } catch {
      if (stage==='ip') {req.pause();res.shouldKeepAlive=false;res.setHeader('Connection','close');}
      next(new AppError('Authentication protection is temporarily unavailable. Please try again later.',503,'AUTH_PROTECTION_UNAVAILABLE'));
    }
  };
}
