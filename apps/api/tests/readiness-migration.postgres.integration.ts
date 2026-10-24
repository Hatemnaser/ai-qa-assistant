import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { it } from 'node:test';
import { Pool } from 'pg';
import { assertPostgresIntegrationTarget } from './helpers/postgresIntegrationTarget.ts';
const target = assertPostgresIntegrationTarget(process.env);
it('additive readiness migration preserves all old tables and deleted-account absence, with cascading request ownership', async () => {
  const pool = new Pool({ connectionString: target.connectionString });
  try {
    assert.equal((await pool.query(`SELECT to_regclass('public."User"') AS relation`)).rows[0].relation, null);
    const directory = new URL('../prisma/migrations/', import.meta.url), latest = '20261017000100_readiness_candidates';
    for (const name of (await readdir(directory, { withFileTypes: true })).filter(e=>e.isDirectory()).map(e=>e.name).sort().filter(n=>n<latest)) await pool.query(await readFile(new URL(name+'/migration.sql',directory),'utf8'));
    const owner = randomUUID(), deleted = randomUUID(), project = randomUUID(), request = randomUUID();
    await pool.query('INSERT INTO "User" (id,email,"updatedAt") VALUES ($1,$2,NOW()),($3,$4,NOW())',[owner,owner+'@example.test',deleted,deleted+'@example.test']);
    await pool.query('DELETE FROM "User" WHERE id=$1',[deleted]);
    await pool.query('INSERT INTO "Project" (id,"ownerId",name,"updatedAt") VALUES ($1,$2,$3,NOW())',[project,owner,'Migration fixture']);
    await pool.query('INSERT INTO "QaRequest" (id,"projectId",title,objective,"updatedAt") VALUES ($1,$2,$3,$4,NOW())',[request,project,'Request','Check']);
    const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(r=>r.tablename as string);
    async function fingerprints() { const result: Record<string,string> = {}; for(const table of tables){assert.match(table,/^[A-Za-z_][A-Za-z0-9_]*$/);result[table]=(await pool.query(`SELECT md5(COALESCE(string_agg(row_to_json(t)::text,',' ORDER BY row_to_json(t)::text),'')) AS hash FROM "${table}" t`)).rows[0].hash;}return result; }
    const before = await fingerprints(); await pool.query(await readFile(new URL(latest+'/migration.sql',directory),'utf8')); assert.deepEqual(await fingerprints(),before);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM "User" WHERE id=$1',[deleted])).rows[0].n,0);
    const c=randomUUID();await pool.query('INSERT INTO "QaReadinessCandidate" (id,"requestId",revision,definition,"definitionHash","initialDeployment") VALUES ($1,$2,1,$3,$4,$5)',[c,request,'{}','fixture','{}']);
    await pool.query('INSERT INTO "QaReadinessEvaluation" (id,"candidateId",snapshot,"snapshotHash") VALUES ($1,$2,$3,$4)',[randomUUID(),c,'{}','fixture']);
    await pool.query('DELETE FROM "Project" WHERE id=$1',[project]);assert.equal((await pool.query('SELECT count(*)::int AS n FROM "QaReadinessEvaluation"')).rows[0].n,0);
    console.log('READINESS_UPGRADE_PROOF',JSON.stringify({preservedTables:tables.length,deletedUserAbsent:true,requestPreserved:true,projectDeletionCascades:true}));
  } finally { await pool.end(); }
});
