import { runnerRegistrationV2Schema } from '@oddpath/qa-execution-contract';
import { hashCanonicalJson } from '@oddpath/runner';

const pendingRegistrations = new WeakMap();
const unconfirmedRegistrations = new WeakMap();

// Renewal and claim share this queue for the configured project object. Keep
// the queue through publication, local acknowledgement and the claim request.
export async function withProjectRegistration(project, action) {
  const previous = pendingRegistrations.get(project) || Promise.resolve();
  let release;
  const turn = new Promise(resolve => { release = resolve; });
  pendingRegistrations.set(project, turn);
  await previous;
  try { return await action(); }
  finally {
    release();
    if (pendingRegistrations.get(project) === turn) pendingRegistrations.delete(project);
  }
}

function savedLabel(label, stateId) {
  const suffix = ' · ' + stateId.slice(0, 8), limit = 120 - suffix.length;
  let prefix = '';
  for (const character of label) {
    if (prefix.length + character.length > limit) break;
    prefix += character;
  }
  return prefix + suffix;
}

export function savedLoginRegistration(baseRegistration, states, now = Date.now()) {
  const profiles = [...baseRegistration.profiles];
  const available = states.filter(state => !state.revoked && Date.parse(state.expiresAt) > now);
  for (const base of baseRegistration.profiles.filter(profile => profile.authentication.kind === 'MANUAL')) {
    for (const state of available) {
      if (profiles.length >= 20 || state.targetRevisionId !== base.target.revisionId || state.targetHash !== base.target.targetHash) continue;
      const { manifestHash, ...manifest } = base;
      // Hash the entire base key: truncating its prefix aliases distinct profiles.
      const saved = { ...manifest,
        profileKey: 'saved-' + hashCanonicalJson({ profileKey: base.profileKey, stateId: state.id }).slice(0, 58),
        label: savedLabel(base.label, state.id),
        authentication: { kind: 'SAVED_STATE', id: state.id, revision: state.revision, targetRevisionId: state.targetRevisionId },
      };
      profiles.push({ ...saved, manifestHash: hashCanonicalJson(saved) });
    }
  }
  return runnerRegistrationV2Schema.parse({ ...baseRegistration, profiles });
}

// Called under the shared project queue. A failed response cannot establish
// whether publication committed, so retain this exact candidate until an
// acknowledged, project-bound registration replaces the confirmed cache.
export async function publishProjectRegistration(project, registration = unconfirmedRegistrations.get(project) || project.registration) {
  unconfirmedRegistrations.set(project, registration);
  const receipt = await project.client.registerV2(registration);
  if (receipt.projectId !== project.projectId) throw new Error('Project configuration mismatch.');
  project.registration = registration;
  unconfirmedRegistrations.delete(project);
  return receipt;
}

export async function renewProjectRegistration(project, savedLoginsEnabled) {
  return withProjectRegistration(project, async () => {
    if (unconfirmedRegistrations.has(project)) await publishProjectRegistration(project);
    const candidate = savedLoginsEnabled
      ? savedLoginRegistration(project.baseRegistration, (await project.client.savedLogins()).states)
      : runnerRegistrationV2Schema.parse(project.managedRegistration?project.baseRegistration:project.registration);
    return publishProjectRegistration(project, candidate);
  });
}
