import { setTimeout as delay } from 'node:timers/promises';
import { executeClaim, createManagedPlaywrightSession } from '@oddpath/runner';
import { loadSupervisorConfig } from './config.mjs';
import { DockerRuntimeDriver } from './docker-driver.mjs';
import { RuntimeJournal } from './journal.mjs';
import { BrowserSupervisor } from './supervisor.mjs';
import { createViewerGateway } from './viewer-gateway.mjs';
import { claimManagedExecution } from './project-claim.mjs';
import { waitForHumanPreparation } from './human-preparation.mjs';
import { captureSavedLogin,restoreSavedLogin } from './saved-preparation.mjs';
import { renewProjectRegistration } from './project-registration.mjs';
import {ManagedProjectCatalog} from './managed-projects.mjs';
import { deferPreparationFailure, retryFailureReports } from './failure-reports.mjs';
import { logPreparationFailure } from './preparation-failure.mjs';

const config = await loadSupervisorConfig();
const catalog=config.discovery?new ManagedProjectCatalog(config):null;
const journal = new RuntimeJournal('/var/lib/oddpath/runtime.sqlite');
const driver = new DockerRuntimeDriver(config);
const supervisor = new BrowserSupervisor({ driver, journal });
await supervisor.recover();
const gateway = createViewerGateway({ journal, driver, signingKey: config.key, publicOrigin: config.publicOrigin, frameOrigin: config.viewerFrameOrigin || null });
gateway.listen(8081, '0.0.0.0');
let stopping = false, activeExecution;
const shutdown = () => { stopping = true; if (activeExecution) void supervisor.stop(activeExecution).catch(() => {}); };
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
const keepers = config.projects.map(project => {
  let pending = false;
  return setInterval(async () => {
    if (stopping || pending) return;
    pending = true;
    try {
      await renewProjectRegistration(project, Boolean(config.transferKeys));
    }
    catch { console.error('Managed Runner registration renewal failed.'); }
    finally { pending = false; }
  }, 15_000);
});
try {
  if(catalog){await catalog.refresh();catalog.start();}
  while (!stopping) {
    const projects = catalog ? catalog.projects() : config.projects;
    await retryFailureReports({ journal, projects });
    for (const project of projects) {
      if (stopping) break;
      if (journal.active().length) break;
      try {
        const claimed = await claimManagedExecution(project);
        if (!claimed) continue;
        activeExecution = claimed.task.executionId;
        let row, terminalPromise, preparation;
        const terminate = () => terminalPromise ||= (async () => {
          if (!row) return;
          await project.client.runtime(activeExecution, 'stop').catch(() => {});
          const proof = await supervisor.stop(activeExecution);
          try {
            await project.client.runtime(activeExecution, 'exit', { runtimeId: row.runtime, processExited: true, observedAt: new Date(proof.observedAt).toISOString() });
            journal.reported(activeExecution);
          } catch { console.error('Runtime exit reporting deferred to the independent reaper.'); }
        })();
        try {
          row = await supervisor.allocate(claimed.task, new Date(claimed.claim.leaseExpiresAt).getTime(), async reserved => {
            row = reserved;
            const registered = await project.client.runtime(activeExecution, 'begin', { runtimeId: reserved.runtime, imageDigest: config.chromeImage,
              ...(claimed.task.profile.authentication.kind !== 'NONE' ? { preparationDeadlineAt: new Date(reserved.preparationDeadline).toISOString() } : {}) }, claimed.claim);
            if (registered.state !== 'LIVE' || (await project.client.runtime(activeExecution, 'status')).state !== 'LIVE') throw new Error('Runtime Stop requested.');
          });
          const endpoint = await driver.endpoint(row.runtime);
          let ready = false;
          for (let attempt = 0; attempt < 30 && !stopping; attempt++) {
            try { const response = await fetch(`${endpoint}/cdp/json/version`, { headers: { authorization: `Bearer ${row.token}` }, signal: AbortSignal.timeout(1_000) }); ready = response.ok; }
            catch {}
            if (ready) break;
            await delay(200);
          }
          if (!ready || stopping) throw new Error('Managed Chrome did not become ready.');
          if (claimed.task.profile.authentication.kind === 'MANUAL') {
            preparation = await waitForHumanPreparation({ claimed, client: project.client, supervisor, journal, capture:()=>captureSavedLogin({claimed,client:project.client,supervisor,keys:config.transferKeys}), stopping: () => stopping });
          }
          if(claimed.task.profile.authentication.kind==='SAVED_STATE')preparation=await restoreSavedLogin({claimed,client:project.client,supervisor,keys:config.transferKeys});
          // A dedicated object retains the original client's methods/bindings.
          const client = {
            accept: (...args) => project.client.accept(...args),
            heartbeat: async (...args) => {
              const result = await project.client.heartbeat(...args);
              const status = await project.client.runtime(activeExecution, 'status');
              if (status.state !== 'LIVE') throw new Error('Runtime Stop requested.');
              await supervisor.renew(activeExecution, new Date(result.leaseExpiresAt).getTime());
              return result;
            },
            recordItem: (...args) => project.client.recordItem(...args), finish: (...args) => project.client.finish(...args),
            fail: (...args) => project.client.fail(...args), initiateEvidenceUpload: (...args) => project.client.initiateEvidenceUpload(...args),
            completeEvidenceUpload: (...args) => project.client.completeEvidenceUpload(...args), uploadEvidenceBytes: (...args) => project.client.uploadEvidenceBytes(...args),
          };
          await executeClaim(claimed, { allowProduction: config.allowProduction === true, client, profiles: [], heartbeatIntervalMs: 5_000,
            createSession: () => createManagedPlaywrightSession(endpoint, row.token, claimed.task.profile.target.baseUrl),
            managedV2: { profileHashes: project.registration.profiles.map(profile => profile.manifestHash),
              humanPreparationCompleted: preparation?.completed === true,
              savedPreparationCompleted:claimed.task.profile.authentication.kind==='SAVED_STATE'&&preparation?.completed===true,
              assertRuntimeLive: async () => {
                if (stopping || (await project.client.runtime(activeExecution, 'status')).state !== 'LIVE') throw new Error('Runtime is unavailable.');
                const liveEndpoint = await driver.endpoint(row.runtime);
                const response = await fetch(`${liveEndpoint}/cdp/json/version`, { headers: { authorization: `Bearer ${row.token}` }, signal: AbortSignal.timeout(1_000) });
                if (!response.ok) throw new Error('Managed Chrome disconnected.');
              },
              beforeSteps: async () => {
                if (stopping || (await project.client.runtime(activeExecution, 'status')).state !== 'LIVE') throw new Error('Runtime Stop requested.');
                if (preparation) await supervisor.login(activeExecution, 'start', preparation.epoch);
                if (stopping || (await project.client.runtime(activeExecution, 'status')).state !== 'LIVE') throw new Error('Runtime Stop requested.');
                journal.markStarted(activeExecution);
              }, terminate } });
        } catch (error) {
          logPreparationFailure(console,claimed.task.executionId,error);
          try {
            deferPreparationFailure(journal, claimed, error);
            await retryFailureReports({ journal, projects: [project] });
          } finally { await terminate().catch(() => {}); }
        } finally { activeExecution = undefined; }
      } catch { console.error('Managed Runner poll failed.'); }
    }
    await delay(1_000);
  }
} finally {
  await catalog?.close();
  for (const timer of keepers) clearInterval(timer);
  await supervisor.recover().catch(() => {});
  gateway.closeViewerStreams(); gateway.closeAllConnections(); gateway.close(); journal.close();
}
