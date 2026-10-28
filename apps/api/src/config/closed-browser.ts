import {isClosedRecoveryDatabase,type RecoveryDatabaseState} from '@oddpath/qa-execution-contract';
import type { AppEnv } from './env/load.js';

export function closedBrowserOwnerAllowed(config: Pick<AppEnv, 'qaClosedRehearsalEnabled' | 'qaClosedRehearsalOwnerIds'>, ownerId: string) {
  return !config.qaClosedRehearsalEnabled || config.qaClosedRehearsalOwnerIds.includes(ownerId);
}

export function validateClosedBrowserRehearsal(config: AppEnv) {
  if (!config.qaClosedRehearsalEnabled) {
    if (config.qaClosedRehearsalOwnerIds.length) throw new Error('Closed browser rehearsal owner IDs require explicit activation.');
    return;
  }
  const fail = (reason: string): never => { throw new Error(`Unsafe closed browser rehearsal: ${reason}`); };
  const ids = config.qaClosedRehearsalOwnerIds;
  if (config.nodeEnv !== 'production') fail('use NODE_ENV=production with its complete safety validation.');
  if (!ids.length || ids.length > 20 || new Set(ids).size !== ids.length || ids.some(id => !/^[A-Za-z0-9_-]{1,120}$/.test(id))) fail('provide 1–20 distinct exact account IDs.');
  if (config.registrationMode !== 'disabled') fail('registration must remain disabled.');
  if (!config.qaExecutionV2Enabled || !config.qaBrowserRuntimeEnabled || !config.qaManagedRoutingEnabled || config.qaLegacyRunnerDispatchEnabled) fail('require managed v2 routing with legacy dispatch disabled.');
  if (config.aiEnabled || config.guestAiEnabled || config.projectDocumentEmbeddingsEnabled || config.qaProcessingWorkerEnabled) fail('AI, embeddings and QA generation workers must remain disabled.');
  if (config.privateAssetsEnabled || config.qaSavedLoginEnabled || config.portabilityImportsEnabled) fail('private assets, saved login and imports remain gated separately.');
  if (config.cookieDomain || !config.cookieSecure || config.cookieSameSite === 'none') fail('require secure host-only cookies.');
  if (config.corsOrigins.length !== 1 || config.corsOrigins[0] !== config.appOrigin || config.qaBrowserViewerOrigin === config.appOrigin) fail('require one exact app origin and a distinct viewer origin.');
}

/** A recovery activation may never silently become a normal/public deployment. */
export function assertClosedRecoveryRuntime(state:RecoveryDatabaseState,config:AppEnv){
 if(!isClosedRecoveryDatabase(state))return;
 if(!config.qaClosedRehearsalEnabled)throw new Error('RESTORE_CLOSED_PROFILE_REQUIRED');
 validateClosedBrowserRehearsal(config);
}
