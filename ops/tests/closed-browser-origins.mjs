import assert from 'node:assert/strict';

/** Synthetic private rehearsal only; this does not expose or provision DNS. */
export function closedRehearsalOrigins(env={}) {
 const keys=['ODDPATH_CLOSED_APP_ORIGIN','ODDPATH_CLOSED_API_ORIGIN','ODDPATH_CLOSED_VIEWER_ORIGIN'];
 const supplied=keys.filter(k=>env[k]!==undefined);
 assert(supplied.length===0||supplied.length===3,'Supply all three private rehearsal origins together');
 const values=supplied.length?keys.map(k=>env[k]):['https://app.oddpath.test:8443','https://api.oddpath.test:8443','https://browser.oddpath.test:8443'];
 for(const value of values){const u=new URL(value);assert(u.protocol==='https:'&&u.origin===value&&u.port==='8443'&&/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(u.hostname),'Exact HTTPS hostname origin on the private 8443 listener required');}
 assert.equal(new Set(values.map(v=>new URL(v).hostname)).size,3,'Distinct app/API/viewer hostnames required');
 return Object.fromEntries(['app','api','viewer'].map((key,i)=>[key,values[i]]));
}
