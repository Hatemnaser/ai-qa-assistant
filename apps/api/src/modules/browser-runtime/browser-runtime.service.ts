import {closedBrowserOwnerAllowed} from '../../config/closed-browser.js';
import { createHmac, randomUUID } from "node:crypto";
import { browserViewerGrantSchema, browserLoginGrantSchema } from "@oddpath/qa-execution-contract";
import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import { browserRuntimeRepository } from "./browser-runtime.repository.js";
import type { BrowserRuntimeRepository } from "./browser-runtime.types.js";

export function createBrowserRuntimeService({ repository, signingKey, viewerOrigin, enabled = false, manualEnabled = false, now = () => new Date() }: {
  repository: Pick<BrowserRuntimeRepository, 'owned'> & Partial<Pick<BrowserRuntimeRepository, 'loginOwned'>>; signingKey: string; viewerOrigin: string; enabled?: boolean; manualEnabled?: boolean; now?: () => Date;
}) {
  function requireEnabled() { if (!enabled) throw new AppError('Managed browser runtime is not active.', 409, 'BROWSER_RUNTIME_NOT_ACTIVE'); }
  return {
    requireEnabled,
    async status(userId: string, projectId: string, executionId: string) {
      requireEnabled();
      const row = await repository.owned(userId, projectId, executionId);
      return { executionId, runtimeId: row.runtimeId, state: row.state, requestedAt: row.stopRequestedAt, confirmedAt: row.exitObservedAt,
        savedLogin: { enabled: env.qaSavedLoginEnabled, consent: !!row.saveLoginConsentAt, savedLoginId: row.savedLoginId || null },
        authenticationKind:row.authenticationKind||(row.loginPhase==='NONE'?'NONE':'MANUAL'),
        login: { phase: row.loginPhase || 'NONE', controlEpoch: row.loginEpoch || null, expiresAt: row.loginDeadlineAt?.toISOString() || null },
        terminationProof: row.state === 'STOP_CONFIRMED' ? { processExited: true, observedAt: row.exitObservedAt } : null };
    },
    async viewer(userId: string, projectId: string, executionId: string) {
      if (!closedBrowserOwnerAllowed(env,userId)) throw new AppError('This account is outside the closed browser rehearsal.',403,'BROWSER_REHEARSAL_ACCOUNT_REQUIRED');

      requireEnabled();
      const row = await repository.owned(userId, projectId, executionId), currentTime = now();
      if (row.state !== 'LIVE' || !['CLAIMED','RUNNING'].includes(row.execution.status) || !row.execution.leaseExpiresAt
        || row.execution.leaseExpiresAt <= currentTime || row.execution.deadlineAt <= currentTime || !row.execution.authorization.bindingHash) throw new AppError('Browser is unavailable.', 409, 'BROWSER_RUNTIME_UNAVAILABLE');
      if (!['NONE','READY'].includes(row.loginPhase || 'NONE')) throw new AppError('Viewing is paused during human preparation.', 409, 'BROWSER_CAPTURE_PAUSED');
      const grant = browserViewerGrantSchema.parse({ schemaVersion: 1, executionId, runtimeId: row.runtimeId, ownerId: userId, projectId,
        bindingHash: row.execution.authorization.bindingHash, nonce: randomUUID(), expiresAt: currentTime.getTime() + 60_000, mode: 'VIEW' });
      const payload = Buffer.from(JSON.stringify(grant)).toString('base64url');
      const signature = createHmac('sha256', Buffer.from(signingKey, 'hex')).update(payload).digest('base64url');
      return { url: `${viewerOrigin}/open#${payload}.${signature}`, expiresAt: new Date(grant.expiresAt).toISOString(), mode: 'VIEW' };
    },
    async login(userId: string, projectId: string, executionId: string, epoch: string, action: 'BEGIN' | 'COMPLETE') {
      if (!closedBrowserOwnerAllowed(env,userId)) throw new AppError('This account is outside the closed browser rehearsal.',403,'BROWSER_REHEARSAL_ACCOUNT_REQUIRED');

      requireEnabled();
      if (!manualEnabled || !repository.loginOwned) throw new AppError('Manual login is not active.', 409, 'BROWSER_LOGIN_NOT_ACTIVE');
      await repository.loginOwned(userId, projectId, executionId, epoch, action);
      return this.status(userId, projectId, executionId);
    },
    async loginViewer(userId: string, projectId: string, executionId: string) {
      if (!closedBrowserOwnerAllowed(env,userId)) throw new AppError('This account is outside the closed browser rehearsal.',403,'BROWSER_REHEARSAL_ACCOUNT_REQUIRED');

      requireEnabled();
      if (!manualEnabled || !repository.loginOwned) throw new AppError('Manual login is not active.', 409, 'BROWSER_LOGIN_NOT_ACTIVE');
      const row = await repository.owned(userId, projectId, executionId);
      if (!row.loginEpoch) throw new AppError('Login is unavailable.', 409, 'BROWSER_LOGIN_UNAVAILABLE');
      await repository.loginOwned(userId, projectId, executionId, row.loginEpoch, 'CHECK');
      const currentTime = now();
      if (row.state !== 'LIVE' || row.execution.status !== 'CLAIMED' || !row.execution.leaseExpiresAt || row.execution.leaseExpiresAt <= currentTime
        || row.execution.deadlineAt <= currentTime || row.loginPhase !== 'LOGIN' || !row.loginDeadlineAt || row.loginDeadlineAt <= currentTime
        || !row.execution.authorization.bindingHash) throw new AppError('Login is unavailable.', 409, 'BROWSER_LOGIN_UNAVAILABLE');
      const grant = browserLoginGrantSchema.parse({ schemaVersion: 1, executionId, runtimeId: row.runtimeId, ownerId: userId, projectId,
        bindingHash: row.execution.authorization.bindingHash, nonce: randomUUID(), expiresAt: Math.min(currentTime.getTime() + 60_000, row.loginDeadlineAt.getTime()), mode: 'LOGIN', controlEpoch: row.loginEpoch });
      const payload = Buffer.from(JSON.stringify(grant)).toString('base64url');
      const signature = createHmac('sha256', Buffer.from(signingKey, 'hex')).update(payload).digest('base64url');
      return { url: `${viewerOrigin}/open#${payload}.${signature}`, expiresAt: new Date(grant.expiresAt).toISOString(), mode: 'LOGIN' };
    },
  };
}
export const browserRuntimeService = createBrowserRuntimeService({ repository: browserRuntimeRepository,
  signingKey: env.qaBrowserViewerSigningKey, viewerOrigin: env.qaBrowserViewerOrigin, enabled: env.qaBrowserRuntimeEnabled, manualEnabled: env.qaManualLoginEnabled });
