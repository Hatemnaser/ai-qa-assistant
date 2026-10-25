import {createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

/** Fail before allocation if a cached test image differs from the tested source. */
export async function assertSupervisorImageParity(docker,image){
 const directory=new URL('../src/',import.meta.url);
 const names=(await readdir(directory)).filter(n=>n.endsWith('.mjs')).sort();
 const expected=Object.fromEntries(await Promise.all(names.map(async name=>[name,createHash('sha256').update(await readFile(new URL(name,directory))).digest('hex')])));
 const script=`const fs=require('fs'),c=require('crypto');console.log(JSON.stringify(Object.fromEntries(${JSON.stringify(names)}.map(n=>[n,fs.existsSync('apps/browser-runtime/src/'+n)?c.createHash('sha256').update(fs.readFileSync('apps/browser-runtime/src/'+n)).digest('hex'):null]))));`;
 const actual=JSON.parse(await docker(['run','--rm','--pull=never','--network','none','--read-only','--entrypoint','node',image,'-e',script]));
 assert.deepEqual(actual,expected,'Supervisor test image is stale. Build the current Dockerfile.supervisor and select it with ODDPATH_SUPERVISOR_TEST_IMAGE.');
 return {image,files:names.length,sha256:expected};
}
