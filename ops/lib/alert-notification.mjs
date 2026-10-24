import {createRequire} from 'node:module';
import {connect} from 'node:net';
import {createHash, randomUUID} from 'node:crypto';
import {isAbsolute} from 'node:path';
import {readPrivate, requireCondition} from './private-files.mjs';
import {isHealthy, jobManifest} from '../maintenance.mjs';

const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const address = value => typeof value === 'string' && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value) && value.length <= 254;
const ids = ['maintenance', 'backup', 'api'];
const timestamp = value => Number.isSafeInteger(value) && value >= 0;
const signature = values => [...values].sort().join(',');
export const ALERT_ATTEMPT_WINDOW_MS = 3600000;
export const ALERT_ATTEMPT_LIMIT = 8;

/** Operator-owned configuration only. No user-supplied URL, content or credential. */
export function validateAlertConfig(config) {
  requireCondition(config?.schemaVersion === 1 && /^[a-z][a-z0-9-]{0,39}$/.test(config.instance), 'ALERT_CONFIG_INVALID');
  requireCondition(isAbsolute(config.maintenanceState ?? '') && isAbsolute(config.backupState ?? '') && config.maintenanceState !== config.backupState, 'ALERT_STATE_PATH_INVALID');
  requireCondition(typeof config.assets === 'boolean' && ['CLOSED_DATABASE_ONLY', 'FULL_SYSTEM'].includes(config.backupScope), 'ALERT_JOBS_INVALID');
  const smtp = config.smtp;
  requireCondition(smtp && typeof smtp.host === 'string' && /^[a-zA-Z0-9.-]{1,253}$/.test(smtp.host) && Number.isInteger(smtp.port) && smtp.port >= 1 && smtp.port <= 65535, 'ALERT_SMTP_INVALID');
  requireCondition(address(smtp.from) && address(smtp.to) && typeof smtp.user === 'string' && smtp.user.length > 0 && smtp.user.length <= 256 && !/[\r\n\0]/.test(smtp.user) && isAbsolute(smtp.passwordFile ?? ''), 'ALERT_SMTP_INVALID');
  if (config.apiReadyUrl !== undefined) {
    let url; try { url = new URL(config.apiReadyUrl); } catch {}
    requireCondition(url && ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/api/health/ready', 'ALERT_API_URL_INVALID');
  }
  // Fixed small polling/delivery bounds. No tunable timeout can hide stale jobs.
  return config;
}
export const configFingerprint = config => createHash('sha256').update(JSON.stringify(config)).digest('hex');

export async function observeHealth(config, {now = Date.now, fetcher = fetch} = {}) {
  const failures = [];
  for (const role of ['maintenance', 'backup']) {
    try {
      const state = JSON.parse(await readPrivate(config[role + 'State'], 262144));
      const env = role === 'backup' ? {ODDPATH_OPS_ROLE: 'backup', ODDPATH_BACKUP_SCOPE: config.backupScope} : config.assets ? {R2_ENDPOINT:'configured', R2_BUCKET_NAME:'configured', R2_ACCESS_KEY_ID:'configured', R2_SECRET_ACCESS_KEY:'configured'} : {};
      if (state.role !== role || !isHealthy(state, jobManifest(env), now())) failures.push(role);
    } catch { failures.push(role); }
  }
  if (config.apiReadyUrl) {
    try {
      const response = await fetcher(config.apiReadyUrl, {redirect:'error', signal:AbortSignal.timeout(3000)});
      if (response.status !== 200) { await response.body?.cancel(); failures.push('api'); }
      else {
        // Read readiness only; never collect response/error bodies as telemetry.
        const reader=response.body.getReader(); let length=0, chunks=[];
        try { for (;;) { const {value,done}=await reader.read(); if(done)break; length+=value.length; requireCondition(length<=2048,'ALERT_API_BODY_LIMIT'); chunks.push(value); } }
        finally { await reader.cancel().catch(()=>{}); }
        const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (data.service !== 'oddpath-api' || data.status !== 'ready' || data.checks?.database !== 'ok') failures.push('api');
      }
    } catch { failures.push('api'); }
  }
  return {checkedAt: now(), failures};
}

export function initialAlertState(config, previous, now) {
  let attempts=[];
  if (previous) {
    requireCondition(previous.schemaVersion === 1 && previous.configFingerprint === configFingerprint(config) && timestamp(previous.heartbeatAt) && previous.heartbeatAt <= now && Array.isArray(previous.failures) && previous.failures.every(id=>ids.includes(id)), 'ALERT_SAVED_STATE_INVALID');
    if (previous.incident) requireCondition(typeof previous.incident.id === 'string' && timestamp(previous.incident.openedAt) && Array.isArray(previous.incident.affected) && previous.incident.affected.length > 0 && previous.incident.affected.every(id=>ids.includes(id)), 'ALERT_SAVED_INCIDENT_INVALID');
    if (previous.pending) requireCondition(previous.pending.incidentId === previous.incident?.id && /^[0-9a-f-]{36}$/.test(previous.pending.id) && ['FAILURE','REMINDER','RECOVERY'].includes(previous.pending.type) && timestamp(previous.pending.observedAt) && Array.isArray(previous.pending.affected) && previous.pending.affected.every(id=>ids.includes(id)), 'ALERT_SAVED_NOTICE_INVALID');
    const saved=previous.attempts===undefined?[]:previous.attempts;
    // The old hour-boundary race could persist one expired timestamp plus
    // eight live attempts. Recover only that bounded legacy shape; never drop
    // an active reservation, reset backoff or discard a pending notification.
    requireCondition(Array.isArray(saved) && saved.length <= ALERT_ATTEMPT_LIMIT+1 && saved.every((t,i)=>timestamp(t)&&t<=now&&(!i||t>=saved[i-1])) && timestamp(previous.nextAttemptAt) && Number.isSafeInteger(previous.deliveryFailures) && previous.deliveryFailures>=0, 'ALERT_SAVED_DELIVERY_INVALID');
    attempts=saved.filter(t=>now-t<ALERT_ATTEMPT_WINDOW_MS);
    requireCondition(attempts.length<=ALERT_ATTEMPT_LIMIT,'ALERT_SAVED_DELIVERY_INVALID');
  }
  return previous ? {...previous, attempts, status:'RUNNING', heartbeatAt:now} : {schemaVersion:1, configFingerprint:configFingerprint(config), status:'RUNNING', heartbeatAt:now, checkedAt:null, failures:[], incident:null, pending:null, deliveryFailures:0, nextAttemptAt:0, attempts:[]};
}

/** One bounded aggregate incident; retry payload/Message-ID survives restart. */
export function updateObservation(state, observation, now) {
  requireCondition(timestamp(now) && now >= state.heartbeatAt, 'ALERT_CLOCK_REVERSED');
  state.heartbeatAt=now; state.checkedAt=observation.checkedAt; state.failures=observation.failures;
  if (state.failures.length) {
    state.incident ??= {id:randomUUID(), openedAt:now, affected:[], alertAcceptedAt:null, notifiedSignature:'', lastAcceptedAt:0};
    state.incident.affected=[...new Set([...state.incident.affected,...state.failures])].sort();
    state.incident.resolvedAt=null;
  } else if (state.incident && !state.incident.resolvedAt) state.incident.resolvedAt=now;
  const incident=state.incident;
  // A failed RECOVERY must never be retried as recovery during a fresh failure.
  if (state.pending?.type === 'RECOVERY' && state.failures.length) {
    state.pending=null;
    // SMTP may have delivered that recovery before losing its ACK. Send a
    // fresh failure even when the affected check is unchanged; do not let the
    // operator's last possible notice remain a recovery for the next six hours.
    state.incident.notifiedSignature='';
  }
  if (!incident || state.pending) return;
  let type;
  if (incident.alertAcceptedAt === null) type='FAILURE';
  else if (incident.resolvedAt) type='RECOVERY';
  else if (signature(incident.affected) !== incident.notifiedSignature) type='FAILURE';
  else if (now - incident.lastAcceptedAt >= 6*3600000) type='REMINDER';
  if (type) state.pending={id:randomUUID(),incidentId:incident.id,type,observedAt:now,affected:[...incident.affected]};
}

export function acceptedNotice(state, now) {
  const notice=state.pending;
  requireCondition(notice && state.incident?.id === notice.incidentId, 'ALERT_NOTICE_MISMATCH');
  if (notice.type === 'RECOVERY') state.incident=null;
  else {
    state.incident.alertAcceptedAt=now;
    state.incident.lastAcceptedAt=now;
    state.incident.notifiedSignature=signature(notice.affected);
  }
  state.lastAccepted={id:notice.id,type:notice.type,at:now};
  state.pending=null; state.deliveryFailures=0; state.nextAttemptAt=0;
}

export function alertHealthy(state, now=Date.now()) {
  return state?.schemaVersion === 1 && state.status === 'RUNNING' && timestamp(state.heartbeatAt) && timestamp(state.checkedAt) && now>=state.heartbeatAt && now>=state.checkedAt && now-state.heartbeatAt<45000 && now-state.checkedAt<45000 && state.failures?.length===0 && !state.incident && !state.pending;
}

export function noticeMessage(config, notice) {
  requireCondition(['FAILURE','REMINDER','RECOVERY','TEST'].includes(notice.type) && notice.affected.every(id=>ids.includes(id)), 'ALERT_NOTICE_INVALID');
  return {from:config.smtp.from,to:config.smtp.to,messageId:`<${notice.id}@oddpath.operations>`,
    subject:`[Oddpath ${config.instance}] ${notice.type}`,
    text:[`Operational notification: ${notice.type}`,`Instance: ${config.instance}`,`Incident: ${notice.incidentId}`,`Observed at: ${new Date(notice.observedAt).toISOString()}`,`Affected checks: ${notice.affected.join(', ') || 'test'}`,
      'This describes an observed state, not release authorization or a guarantee of current availability.',
      'SMTP acceptance does not prove inbox delivery. Inspect the private operator health state.'].join('\n')};
}

/** Authenticated STARTTLS only. One envelope, no attachments, no raw logs. */
export async function sendNotice(config, notice, {signal} = {}) {
  const password=(await readPrivate(config.smtp.passwordFile,8192)).toString('utf8').replace(/\r?\n$/, '');
  requireCondition(password.length>0 && !/[\r\n\0]/.test(password), 'ALERT_SMTP_PASSWORD_INVALID');
  const nodemailer=require('nodemailer'); let socket;
  const controller=new AbortController(), abort=()=>controller.abort();
  const timer=setTimeout(abort,12000);
  signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted) abort();
  const destroy=()=>socket?.destroy(new Error('ALERT_DELIVERY_INTERRUPTED'));
  controller.signal.addEventListener('abort',destroy,{once:true});
  const transport=nodemailer.createTransport({host:config.smtp.host,port:config.smtp.port,secure:false,requireTLS:true,forceAuth:true,
    auth:{user:config.smtp.user,pass:password},tls:{rejectUnauthorized:true},logger:false,debug:false,
    connectionTimeout:5000,greetingTimeout:5000,socketTimeout:10000,disableFileAccess:true,disableUrlAccess:true,
    getSocket:(_options,callback)=>{
      if(controller.signal.aborted)return callback(new Error('ALERT_DELIVERY_INTERRUPTED'));
      socket=connect({host:config.smtp.host,port:config.smtp.port});
      const failed=error=>callback(error);
      socket.once('error',failed);
      socket.once('connect',()=>{socket.removeListener('error',failed);callback(null,{connection:socket});});
    }});
  try {
    controller.signal.throwIfAborted();
    const result=await transport.sendMail(noticeMessage(config,notice));
    requireCondition(!controller.signal.aborted && result.accepted?.length===1 && result.rejected?.length===0 && /^250\b/.test(result.response), 'ALERT_SMTP_NOT_ACCEPTED');
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort',abort); controller.signal.removeEventListener('abort',destroy);
    socket?.destroy(); transport.close();
  }
}
