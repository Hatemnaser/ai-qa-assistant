import { setTimeout as delay } from 'node:timers/promises';
import { loadSupervisorConfig } from './config.mjs';
import { DockerRuntimeDriver } from './docker-driver.mjs';
import { RuntimeJournal } from './journal.mjs';
import { BrowserSupervisor } from './supervisor.mjs';
import {managedRuntimeClient} from './managed-projects.mjs';

const config = await loadSupervisorConfig();
const journal = new RuntimeJournal('/var/lib/oddpath/runtime.sqlite');
const driver = new DockerRuntimeDriver(config), supervisor = new BrowserSupervisor({ driver, journal });
const runtimeProject=projectId=>config.discovery?{client:managedRuntimeClient(config,projectId)}:config.projects.find(entry=>entry.projectId===projectId);
let stopping = false;
process.on('SIGTERM', () => { stopping = true; }); process.on('SIGINT', () => { stopping = true; });
try {
  while (!stopping) {
    try {
      await supervisor.reap();
      for (const row of journal.active()) {
        const project = runtimeProject(row.project);
        if (!project) { await supervisor.stop(row.execution); continue; }
        try { if ((await project.client.runtime(row.execution, 'status')).state !== 'LIVE') await supervisor.stop(row.execution); }
        catch { /* Local watchdog and persisted lease remain the authority. */ }
      }
      for (const row of journal.unreported()) {
        journal.attemptReport(row.execution);
        const project = runtimeProject(row.project);
        if (!project) continue;
        try {
          await project.client.runtime(row.execution, 'stop');
          // Observe again after the API Stop request, even if a crash/previous
          // watchdog already ended the container. A missing daemon is no proof.
          const proof = await driver.stop(row.runtime);
          await project.client.runtime(row.execution, 'exit', { runtimeId: row.runtime, processExited: true, observedAt: new Date(proof.observedAt).toISOString() });
          journal.reported(row.execution);
        } catch (error) {
          // Failed allocation before API begin, or deleted execution/project:
          // no API runtime exists to receive proof. Preserve local history but
          // do not let these rows starve later exit reports in the bounded page.
          if (error.status === 404 && error.code === 'BROWSER_RUNTIME_NOT_FOUND') journal.reported(row.execution);
          // Other errors retain the durable observation for later recovery.
        }
      }
    } catch { console.error('Browser reaper pass failed.'); }
    await delay(2_000);
  }
} finally { journal.close(); }
