import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {it} from 'node:test';
import {Pool} from 'pg';
import {assertPostgresIntegrationTarget} from './helpers/postgresIntegrationTarget.ts';
const target=assertPostgresIntegrationTarget(process.env);
if(process.env.ODDPATH_AUTH_UPGRADE_TEST!=='1')throw Error('Requires a separate EMPTY auth-upgrade database');
it('additive auth migration preserves every populated pre-06C table and does not recreate deleted users',async()=>{
 const pool=new Pool({connectionString:target.connectionString});
 try {
  assert.equal((await pool.query(`SELECT to_regclass('public."User"') AS relation`)).rows[0].relation,null);
  const directory=new URL('../prisma/migrations/',import.meta.url),migration='20261016000100_shared_auth_abuse';
  const entries=(await readdir(directory,{withFileTypes:true})).filter(e=>e.isDirectory()).map(e=>e.name).sort();
  for(const e of entries.filter(e=>e<migration))await pool.query(await readFile(new URL(e+'/migration.sql',directory),'utf8'));
  const id=randomUUID();await pool.query('INSERT INTO "User" (id,email,"passwordHash","updatedAt") VALUES ($1,$2,$3,NOW())',[id,id+'@example.test','fixture-hash']);
  await pool.query('INSERT INTO "Session" (id,"userId","tokenHash","expiresAt","updatedAt") VALUES ($1,$2,$3,NOW()+interval \'1 day\',NOW())',[randomUUID(),id,randomUUID()]);
  const deleted=randomUUID();await pool.query('INSERT INTO "User" (id,email,"updatedAt") VALUES ($1,$2,NOW())',[deleted,deleted+'@example.test']);await pool.query('DELETE FROM "User" WHERE id=$1',[deleted]);
  const tables=(await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(r=>r.tablename);
  async function fingerprints(){const result:Record<string,string>={};for(const name of tables){assert.match(name,/^[A-Za-z_][A-Za-z0-9_]*$/);result[name]=(await pool.query(`SELECT md5(COALESCE(string_agg(row_to_json(t)::text,',' ORDER BY row_to_json(t)::text),'')) AS digest FROM "${name}" t`)).rows[0].digest;}return result;}
  const before=await fingerprints();await pool.query(await readFile(new URL(migration+'/migration.sql',directory),'utf8'));assert.deepEqual(await fingerprints(),before);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM "User" WHERE id=$1',[deleted])).rows[0].count,0);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM "AuthAbuseBucket"')).rows[0].count,0);
  console.log('AUTH_UPGRADE_PROOF',JSON.stringify({preservedTables:tables.length,userPreserved:true,sessionPreserved:true,deletedUserAbsent:true}));
 }finally{await pool.end();}
});
