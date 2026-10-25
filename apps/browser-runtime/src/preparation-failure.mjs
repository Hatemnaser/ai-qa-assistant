// Only fixed, non-content diagnostics cross the private runtime boundary.
const stages = new Set(['UNKNOWN','CDP','NAVIGATION','INPUT','STATE','BOUNDARY']);
const messages = Object.freeze({
  UNAVAILABLE: 'Managed browser preparation or execution was interrupted.',
  NETWORK_TIMEOUT: 'Target navigation timed out.',
  NETWORK_PROXY: 'The browser could not connect through its network proxy.',
  NETWORK_DNS: 'The target host could not be resolved.',
  NETWORK_TLS: 'The target secure connection failed.',
  NETWORK_CONNECTION: 'The target connection failed.',
  TIMEOUT: 'Browser preparation timed out.',
  BROWSER_CLOSED: 'The browser closed during preparation.',
  INPUT_UNCONFIRMED: 'Browser input mode could not be confirmed.',
  AUTHORITY_LOST: 'Browser preparation authority ended.',
});
const unknown = () => ({stage:'UNKNOWN',reason:'UNAVAILABLE'});
function validated(value) {
  if (!value || typeof value !== 'object' || Object.keys(value).length !== 2
    || typeof value.stage!=='string' || typeof value.reason!=='string'
    || !stages.has(value.stage) || !Object.hasOwn(messages,value.reason)) return null;
  return {stage:value.stage,reason:value.reason};
}
export function preparationDiagnostic(error, stage = 'UNKNOWN') {
  const known = validated(error?.preparationFailure); if (known) return known;
  const text = typeof error?.message === 'string' ? error.message.slice(0,2048) : '';
  let reason = 'UNAVAILABLE';
  if (/net::ERR_TIMED_OUT\b/u.test(text)) reason='NETWORK_TIMEOUT';
  else if (/net::ERR_(?:PROXY_CONNECTION_FAILED|TUNNEL_CONNECTION_FAILED)\b/u.test(text)) reason='NETWORK_PROXY';
  else if (/net::ERR_NAME_NOT_RESOLVED\b/u.test(text)) reason='NETWORK_DNS';
  else if (/net::ERR_(?:CERT_[A-Z_]+|SSL_[A-Z_]+)\b/u.test(text)) reason='NETWORK_TLS';
  else if (/net::ERR_CONNECTION_(?:REFUSED|CLOSED|RESET|FAILED)\b/u.test(text)) reason='NETWORK_CONNECTION';
  else if (error?.name==='TimeoutError' || ['ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT'].includes(error?.code)) reason='TIMEOUT';
  else if (error?.code==='QA_EXECUTION_LEASE_LOST' || /^(?:Runtime lease lost|Human preparation lost authority|Login authority expired)\./u.test(text)) reason='AUTHORITY_LOST';
  else if (/Target (?:page, context or browser|browser) has been closed|Browser has been closed/u.test(text)) reason='BROWSER_CLOSED';
  else if (stage==='INPUT') reason='INPUT_UNCONFIRMED';
  return {stage:stages.has(stage)?stage:'UNKNOWN',reason};
}
function failureError(diagnostic) {
  return Object.assign(new Error(messages[diagnostic.reason]),{preparationFailure:diagnostic});
}
export async function preparationStep(stage, operation) {
  try { return await operation(); }
  catch (error) { throw failureError(preparationDiagnostic(error,stage)); }
}
export function preparationFailureMessage(error) { return messages[preparationDiagnostic(error).reason]; }
export function logPreparationFailure(logger, executionId, error) {
  const event={event:'BROWSER_PREPARATION_FAILURE',...preparationDiagnostic(error)};
  if(typeof executionId==='string'&&/^[A-Za-z0-9_-]{1,120}$/u.test(executionId))event.executionId=executionId;
  // Reporting and physical Stop must still proceed if the logging sink fails.
  try { logger.error(JSON.stringify(event)); } catch {}
}
export async function preparationErrorFromResponse(response) {
  const reader=response.body?.getReader(); if(!reader)return failureError(unknown());
  const chunks=[];let length=0;
  try {
    while(true){
      const {done,value}=await reader.read();if(done)break;
      length+=value.byteLength;
      if(length>1024){void reader.cancel().catch(()=>{});return failureError(unknown());}
      chunks.push(value);
    }
    const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    const body=JSON.parse(new TextDecoder().decode(bytes));
    return failureError(validated(body?.failure)||unknown());
  } catch { return failureError(unknown()); }
  finally { reader.releaseLock(); }
}
