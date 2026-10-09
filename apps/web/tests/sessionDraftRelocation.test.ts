import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import * as vue from 'vue';
import * as drafts from '../src/features/chat/composables/useChatDrafts';
import type { DraftPersistence, SavedDraft } from '../src/features/chat/draftPersistence';
import type { createSessionDraftRelocator } from '../src/features/sessions/sessionDraftRelocation';
import type { TestSessionDetail } from '../src/features/test-sessions/types';

const source = await readFile(new URL('../src/features/sessions/sessionDraftRelocation.ts', import.meta.url), 'utf8');
const compiled = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText;
function mount(persistence: DraftPersistence, owner: () => string | undefined = () => 'owner') {
  const modules: Record<string, unknown> = { vue,
    '../chat/composables/useChatDrafts': drafts,
    '../chat/draftPersistence': { accountDraftPersistence: () => persistence },
  };
  const exports = {} as { createSessionDraftRelocator: typeof createSessionDraftRelocator };
  new Function('require', 'exports', compiled)((id: string) => { assert.ok(id in modules); return modules[id]; }, exports);
  return exports.createSessionDraftRelocator(owner, 'draft conflict', 'storage failed');
}
const saved: SavedDraft = { message: 'Stored before opening settings', mode: 'general', model: 'model', quickAction: null, attachments: [] };
const moved = { id: 's1', projectId: 'p2' } as TestSessionDetail;

describe('session move before an editor has mounted', () => {
  it('revokes local preview URLs when the temporary store is disposed', async () => {
    const file = new File(['image'], 'context.png', { type: 'image/png' });
    const released: string[] = [];
    const revoke = URL.revokeObjectURL;
    URL.revokeObjectURL = value => { released.push(value); };
    const helper = mount({ async load(key) { return key === 'p1:s1' ? { ...saved, attachments: [{ file, name: file.name, mimeType: file.type, type: 'image', previewUrl: 'blob:temporary-preview' }] } : null; }, async save() {}, async remove() {} });
    try {
      await helper.checkProjectMove('s1', 'p1', 'p2');
      await helper.applyProjectMove(moved, 'p1');
      assert.deepEqual(released, []);
      helper.dispose();
      assert.deepEqual(released, ['blob:temporary-preview']);
    } finally { helper.dispose(); URL.revokeObjectURL = revoke; }
  });
  it('relocates the persisted draft without creating another session or clearing it on disposal', async () => {
    const rows = new Map<string, SavedDraft>([['p1:s1', saved]]);
    const helper = mount({ async load(key) { return rows.get(key) || null; }, async save(key, value) { rows.set(key, value); }, async remove(key) { rows.delete(key); } });
    try {
      await helper.checkProjectMove('s1', 'p1', 'p2');
      await helper.applyProjectMove(moved, 'p1');
      assert.equal(rows.has('p1:s1'), false);
      assert.equal(rows.get('p2:s1')?.message, saved.message);
    } finally { helper.dispose(); }
    assert.equal(rows.get('p2:s1')?.message, saved.message);
  });
  it('does not overwrite a persisted destination or delete the source on a failed write', async () => {
    for (const conflict of [true, false]) {
      const helper = mount({ async load(key) { return key === 'p1:s1' || conflict ? saved : null; },
        async save() { throw new Error('Disk unavailable'); }, async remove() { assert.fail('Source must remain recoverable'); } });
      try {
        if (conflict) await assert.rejects(helper.checkProjectMove('s1', 'p1', 'p2'), /draft conflict/);
        else { await helper.checkProjectMove('s1', 'p1', 'p2'); await assert.rejects(helper.applyProjectMove(moved, 'p1'), /storage failed/); }
      } finally { helper.dispose(); }
    }
  });
  it('does not persist or remove anything after the account guard is invalidated', async () => {
    let current = true;
    let complete!: (value: SavedDraft | null) => void;
    const helper = mount({ async load(key) { return key === 'p1:s1' ? new Promise(resolve => { complete = resolve; }) : null; },
      async save() { assert.fail('No stale save'); }, async remove() { assert.fail('No stale delete'); } }, () => current ? 'owner' : undefined);
    try {
      const moving = helper.checkProjectMove('s1', 'p1', 'p2');
      current = false; complete(saved);
      await assert.rejects(moving, /draft conflict/);
    } finally { helper.dispose(); }
  });
});
