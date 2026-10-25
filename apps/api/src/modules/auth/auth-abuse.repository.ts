import { prisma } from '../../db/prisma.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { AuthAbuseBudget, AuthAbuseRepository } from './auth-abuse.types.js';

export function createPrismaAuthAbuseRepository(database:typeof prisma=prisma):AuthAbuseRepository {
  return {
    async cleanup() {
      // One bounded statement, fresh DB time and SKIP LOCKED. Never erase a
      // live window or wait for an in-progress admission to finish.
      return database.$executeRaw`
        WITH expired AS (
          SELECT "key" FROM "AuthAbuseBucket" WHERE "resetAt" <= clock_timestamp() AT TIME ZONE 'UTC'
          ORDER BY "resetAt" LIMIT 100 FOR UPDATE SKIP LOCKED
        ) DELETE FROM "AuthAbuseBucket" b USING expired e WHERE b."key"=e."key"
          AND b."resetAt" <= clock_timestamp() AT TIME ZONE 'UTC'
      `;
    },
    async consume(budgets) {
      if (!budgets.length || new Set(budgets.map(b=>b.key)).size !== budgets.length) throw new Error('Invalid auth abuse budgets.');
      for (const b of budgets) if (!/^[a-f0-9]{64}$/.test(b.key) || !Number.isSafeInteger(b.limit) || b.limit<1 || !Number.isSafeInteger(b.windowMs) || b.windowMs<1 || b.windowMs>86400000) throw new Error('Invalid auth abuse budget.');
      return database.$transaction(async tx=>{
        for (const key of budgets.map(b=>b.key).sort()) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`oddpath:auth-abuse:${key}`},0))`;
        // Read after all locks: a caller waiting at expiry must not spend a
        // newly reset window with a timestamp from before its wait.
        const [clock]=await tx.$queryRaw<Array<{now:Date}>>`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now`;
        if (!clock) throw new Error('Missing auth abuse clock.');
        const rows=await tx.authAbuseBucket.findMany({where:{key:{in:budgets.map(b=>b.key)}}});
        const current=new Map(rows.map(row=>[row.key,row]));
        const blocked=budgets.map(b=>current.get(b.key)).filter(row=>row && row.resetAt>clock.now && row.hits>=budgets.find(b=>b.key===row.key)!.limit);
        if (blocked.length) return {limited:true,retryAfterSeconds:Math.max(1,...blocked.map(row=>Math.ceil((row!.resetAt.getTime()-clock.now.getTime())/1000)))};
        for (const b of budgets) {
          const row=current.get(b.key),active=row && row.resetAt>clock.now;
          const data={hits:active?row.hits+1:1,resetAt:active?row.resetAt:new Date(clock.now.getTime()+b.windowMs)};
          await tx.authAbuseBucket.upsert({where:{key:b.key},create:{key:b.key,...data},update:data});
        }
        return {limited:false,retryAfterSeconds:0};
      },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted,maxWait:2000,timeout:5000});
    },
  };
}
export const authAbuseRepository=createPrismaAuthAbuseRepository();
