import { readFile } from 'node:fs/promises';
import { runnerRegistrationV2Schema } from '@oddpath/qa-execution-contract';
import { OddpathClient, hashCanonicalJson } from '@oddpath/runner';
import { validateBrowserStateKeys } from '@oddpath/qa-execution-contract/browser-state-crypto';

export async function loadSupervisorConfig() {
  const config = JSON.parse(await readFile(process.env.ODDPATH_SUPERVISOR_CONFIG || '/run/secrets/supervisor_config', 'utf8'));
  const key = (await readFile(process.env.ODDPATH_VIEWER_KEY_FILE || '/run/secrets/browser_viewer_key', 'utf8')).trim();
  const managed=Boolean(config.discovery);
  let routingKey;
  if(managed){
    if(config.allowSavedLogin===true&&config.allowManualLogin!==true)throw new Error('Managed saved discovery requires manual profile capability.');
    const discovery=config.discovery;
    if(!discovery||typeof discovery!=='object'||Object.keys(discovery).some(k=>!['serverUrl','keyFile'].includes(k))
      ||typeof discovery.serverUrl!=='string'||new URL(discovery.serverUrl).origin!==discovery.serverUrl
      ||new URL(discovery.serverUrl).protocol!=='https:'||typeof discovery.keyFile!=='string'
      ||(config.projects&&config.projects.length))throw new Error('Invalid managed discovery configuration.');
    routingKey=(await readFile(discovery.keyFile,'utf8')).trim();
    if(!/^[a-f0-9]{64}$/.test(routingKey)||routingKey===key)throw new Error('A separate managed routing key is required.');
  }
  const transferKeys=config.allowSavedLogin===true?validateBrowserStateKeys(JSON.parse(await readFile(config.vaultTransferKeyFile,'utf8'))):null;
  if (config.viewerFrameOrigin && (new URL(config.viewerFrameOrigin).origin !== config.viewerFrameOrigin
    || new URL(config.viewerFrameOrigin).protocol !== 'https:' || config.viewerFrameOrigin === config.publicOrigin)) throw new Error('Invalid viewer frame origin.');
  if (!/^[a-f0-9]{64}$/u.test(key) || new URL(config.publicOrigin).origin !== config.publicOrigin
    || new URL(config.publicOrigin).protocol !== 'https:' || (!managed&&(!Array.isArray(config.projects) || !config.projects.length || config.projects.length > 20))) throw new Error('Invalid supervisor configuration.');
  const projects = (config.projects||[]).map(project => {
    const url = new URL(project.serverUrl);
    if (!project.projectId || url.protocol !== 'https:' || url.origin !== project.serverUrl || !project.token) throw new Error('Invalid project control configuration.');
    const registration = runnerRegistrationV2Schema.parse(project.registration);
    registration.profiles = registration.profiles.map(profile => {
      const { manifestHash, ...manifest } = profile, expected = hashCanonicalJson(manifest);
      if (manifestHash && manifestHash !== expected) throw new Error('Invalid configured profile hash.');
      return { ...manifest, manifestHash: expected };
    });
    if (registration.profiles.some(profile => (profile.authentication.kind === 'SAVED_STATE'&&!transferKeys)
      || (profile.authentication.kind === 'MANUAL' && config.allowManualLogin !== true) || profile.valueReferences.length)) throw new Error('Authentication capability or value references are not active.');
    return { ...project, registration, baseRegistration:structuredClone(registration), client: new OddpathClient({ serverUrl: project.serverUrl, token: project.token, protocolVersion: 2, requestTimeoutMs: 3_000 }) };
  });
  return { ...config, key, projects,transferKeys,routingKey };
}
