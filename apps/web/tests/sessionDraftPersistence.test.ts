import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { effectScope, ref } from 'vue';
import { useChatDrafts } from '../src/features/chat/composables/useChatDrafts';
import type { DraftPersistence, SavedDraft } from '../src/features/chat/draftPersistence';
const saved: SavedDraft = { message: 'Saved private draft', mode: 'checklist', model: 'saved-model', quickAction: null, attachments: [] };
function harness(persistence: DraftPersistence) {
  const scope = effectScope();
  const refs = { messageInput: ref(''), selectedMode: ref('general'), selectedModel: ref('model'), quickActionMode: ref<string | null>(null), selectedAttachments: ref([]) };
  const store = scope.run(() => useChatDrafts(refs, persistence))!;
  return { scope, refs, store };
}
describe('managed session drafts use the existing draft store', () => {
  it('relocates the active unsent draft and attachments without changing their identity', async () => {
    const rows = new Map<string, SavedDraft>();
    const h = harness({ async load(key) { return rows.get(key) || null; }, async save(key, value) { rows.set(key, value); }, async remove(key) { rows.delete(key); } });
    h.store.select('p1:s1'); await Promise.resolve();
    h.refs.messageInput.value = 'Move this unsent draft';
    const ticket = h.store.capture();
    assert.equal(await h.store.relocate('p1:s1', 'p2:s1'), true);
    assert.equal(h.refs.messageInput.value, 'Move this unsent draft');
    assert.equal(h.store.capture().entry, ticket.entry);
    assert.equal(rows.has('p1:s1'), false);
    h.refs.messageInput.value = 'Continue typing';
    assert.equal(rows.get('p2:s1')?.message, 'Continue typing');
    h.scope.stop();
  });
  it('refuses a conflicting destination persisted before mounting without deleting either draft', async () => {
    const rows = new Map<string, SavedDraft>([['p1:s1', { ...saved, message: 'Source' }], ['p2:s1', { ...saved, message: 'Destination' }]]);
    const h = harness({ async load(key) { return rows.get(key) || null; }, async save() { assert.fail('No writes on conflict'); }, async remove() { assert.fail('No deletes on conflict'); } });
    h.store.select('p1:s1');
    assert.equal(await h.store.canRelocate('p1:s1', 'p2:s1'), false);
    assert.equal(await h.store.relocate('p1:s1', 'p2:s1'), false);
    assert.equal(h.refs.messageInput.value, 'Source');
    assert.equal(rows.get('p2:s1')?.message, 'Destination');
    h.scope.stop();
  });
  it('waits for an inactive source hydration before relocating and keeps the destination draft visible', async () => {
    let complete!: (value: SavedDraft) => void;
    const rows = new Map<string, SavedDraft>();
    const h = harness({ load: async key => key === 'p1:s1' ? new Promise(resolve => { complete = resolve; }) : null,
      async save(key, value) { rows.set(key, value); }, async remove(key) { rows.delete(key); } });
    h.store.select('p1:s1'); h.store.select('p2:s1');
    const moving = h.store.relocate('p1:s1', 'p2:s1');
    complete(saved);
    assert.equal(await moving, true);
    assert.equal(h.refs.messageInput.value, saved.message);
    assert.equal(rows.get('p2:s1')?.message, saved.message);
    h.scope.stop();
  });
  it('does not delete a recreated source draft while the relocation save is pending', async () => {
    let complete!: () => void;
    const deletes: string[] = [];
    const h = harness({ async load() { return null; }, async save(key) { if (key === 'p2:s1') await new Promise<void>(resolve => { complete = resolve; }); }, async remove(key) { deletes.push(key); } });
    h.store.select('p1:s1'); await Promise.resolve(); h.refs.messageInput.value = 'Original';
    const moving = h.store.relocate('p1:s1', 'p2:s1');
    for (let index = 0; index < 16 && !complete; index++) await Promise.resolve();
    assert.ok(complete);
    h.store.select('p1:s1'); h.refs.messageInput.value = 'New separate source';
    complete(); assert.equal(await moving, true);
    assert.deepEqual(deletes, []);
    assert.equal(h.refs.messageInput.value, 'New separate source');
    h.scope.stop();
  });
  it('restores a draft on refresh and does not erase it on view disposal', async () => {
    const deletes: string[] = [];
    const h = harness({ async load() { return saved; }, async save() {}, async remove(key) { deletes.push(key); } });
    h.store.select('project:session'); await Promise.resolve();
    assert.equal(h.refs.messageInput.value, saved.message); assert.equal(h.refs.selectedMode.value, 'checklist');
    h.scope.stop(); assert.deepEqual(deletes, []);
  });
  it('rejects a delayed hydration after editing or changing scope', async () => {
    let resolve!: (value: SavedDraft | null) => void;
    const h = harness({ load: () => new Promise(done => { resolve = done; }), async save() {}, async remove() {} });
    h.store.select('first'); h.refs.messageInput.value = 'Newer typing'; resolve(saved); await Promise.resolve();
    assert.equal(h.refs.messageInput.value, 'Newer typing');
    h.store.select('second'); const completeSecond = resolve;
    h.store.reset(); completeSecond(saved); await Promise.resolve();
    assert.equal(h.refs.messageInput.value, ''); h.scope.stop();
  });
  it('keeps an unsent revision and clears only an acknowledged unchanged submission', async () => {
    const writes: SavedDraft[] = [];
    const h = harness({ async load() { return null; }, async save(_key, value) { writes.push(value); }, async remove() {} });
    h.store.select('session'); await Promise.resolve(); h.refs.messageInput.value = 'Send this';
    const ticket = h.store.capture(); h.refs.messageInput.value = 'Next unsent'; h.store.consume(ticket, false);
    assert.equal(h.refs.messageInput.value, 'Next unsent');
    h.store.consume(h.store.capture(), false); assert.equal(writes.at(-1)?.message, ''); h.scope.stop();
  });
});
