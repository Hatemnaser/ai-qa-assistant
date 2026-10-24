import { createHash } from 'node:crypto';
import { preparationFailureMessage } from './preparation-failure.mjs';

export function deferPreparationFailure(journal, claimed, error) {
  const executionId = claimed.task.executionId;
  const digest = createHash('sha256').update(`${executionId}\0${claimed.claim.claimId}`).digest('hex');
  journal.deferFailure({ executionId, projectId: claimed.task.projectId,
    claimId: claimed.claim.claimId, leaseToken: claimed.claim.leaseToken,
    expiry: new Date(claimed.task.deadlineAt).getTime(),
    idempotencyKey: `odp.supervisor.fail.${digest}`, failure: {
      code:'BROWSER_SESSION_UNAVAILABLE',message:preparationFailureMessage(error),
    } });
}

/** Retry only the durable terminal mutation, never claim/accept/browser work. */
export async function retryFailureReports({ journal, projects, now = Date.now, logger = console }) {
  for (const row of journal.pendingFailures()) {
    const project = projects.find(project => project.projectId === row.project);
    journal.attemptFailure(row.execution);
    try {
      if (!project) throw new Error('Project reporting authority unavailable.');
      const receipt = await project.client.fail(row.execution,
        { claimId: row.claim, leaseToken: row.leaseToken }, JSON.parse(row.failure), row.idempotencyKey);
      if (receipt.executionId !== row.execution || receipt.status !== 'FAILED') throw new Error('Failure receipt not confirmed.');
      journal.resolveFailure(row.execution);
    } catch (error) {
      // A denial/expired authority is not a successful failure receipt. Drop
      // credentials, report the limitation, and leave API lease reconciliation
      // and physical Stop/exit reporting as the existing recovery authorities.
      if (row.expiry <= now() || ['QA_EXECUTION_LEASE_LOST','QA_EXECUTION_NOT_FOUND'].includes(error.code)
        || [401,403,404].includes(error.status)) {
        journal.resolveFailure(row.execution);
        logger.error('Managed failure report unconfirmed; authority ended. API lease reconciliation required.');
      } else {
        logger.error('Managed failure report unconfirmed; retained for reporting retry.');
      }
    }
  }
}
