import assert from 'node:assert/strict';
import { afterEach, it } from 'node:test';
import { effectScope, nextTick, ref, type EffectScope } from 'vue';
import { useSessionResources, type SessionResource } from '../src/features/sessions/sessionResources';
import { SESSION_LAYOUT_KEY, clearSessionResourceLayouts, loadSessionResourceLayout, saveSessionResourceLayout } from '../src/features/sessions/sessionResourceLayout';

const effects: EffectScope[] = [];
const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
afterEach(() => { effects.splice(0).forEach(scope => scope.stop()); if (original) Object.defineProperty(globalThis, 'sessionStorage', original); else Reflect.deleteProperty(globalThis, 'sessionStorage'); });
function storage() {
  const map = new Map<string, string>();
  const store = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); } };
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: store });
  return store;
}
const identity = { ownerId: 'owner', projectId: 'project', sessionId: 'session-a' };
const layout = { openIds: ['sources', 'results:request-a', 'browser:execution-a'], pinnedIds: ['results:request-a'], selectedId: 'browser:execution-a', hidden: false };
const settle = async () => { for (let i = 0; i < 5; i++) await nextTick(); };
function mount() {
  const identityRef = ref({ ...identity }), scope = ref('owner:project:session-a'), ready = ref(true);
  const catalog = ref<SessionResource[]>(layout.openIds.map(id => ({ id, scopeKey: scope.value, kind: id.split(':')[0] as SessionResource['kind'] })));
  const effect = effectScope(); effects.push(effect);
  const state = effect.run(() => useSessionResources(scope, catalog, { persistenceScope: identityRef, ready }))!;
  return { state, effect, identityRef, scope, ready, catalog };
}
it('restores each conversation after remount/reload without retaining titles, grants or modal authority', async () => {
  const store = storage();
  const first = mount(); first.state.open('sources'); first.state.open('results:request-a'); first.state.pin('results:request-a'); first.state.open('browser:execution-a'); first.state.expanded.value = true;
  await settle(); first.effect.stop();
  const second = mount(); await settle();
  assert.deepEqual(second.state.openIds.value, layout.openIds);
  assert.deepEqual(second.state.pinnedIds.value, layout.pinnedIds);
  assert.equal(second.state.selectedId.value, 'browser:execution-a');
  assert.equal(second.state.expanded.value, false);
  const saved = store.getItem(SESSION_LAYOUT_KEY)!;
  assert.doesNotMatch(saved, /viewer|https:|token|grant|title|expanded|GO|approval/);
});
it('keeps sessions isolated on navigation, including delayed catalogs and failed loading', async () => {
  storage(); saveSessionResourceLayout(identity, layout);
  const one = mount(); await settle();
  one.ready.value = false; one.scope.value = 'owner:project:session-b'; one.identityRef.value = { ...identity, sessionId: 'session-b' }; one.catalog.value = [];
  assert.deepEqual(one.state.openIds.value, []); await settle();
  one.catalog.value = [{ id: 'activity', kind: 'activity', scopeKey: one.scope.value }]; one.ready.value = true; await settle();
  one.state.open('activity'); await settle();
  one.ready.value = false; one.scope.value = 'owner:project:session-a'; one.identityRef.value = { ...identity }; one.catalog.value = []; await settle();
  assert.deepEqual(loadSessionResourceLayout(identity)?.openIds, layout.openIds);
  one.catalog.value = layout.openIds.slice(0, 2).map(id => ({ id, kind: id.split(':')[0] as SessionResource['kind'], scopeKey: one.scope.value }));
  one.ready.value = true; await settle();
  assert.deepEqual(one.state.openIds.value, layout.openIds.slice(0, 2));
  assert.equal(one.state.selectedId.value, 'sources'); // Removed browser cannot be resurrected.
  assert.deepEqual(loadSessionResourceLayout({ ...identity, sessionId: 'session-b' })?.openIds, ['activity']);
});
it('serializes a strict bounded allowlist and refuses foreign/expired/malformed or unavailable storage', () => {
  const store = storage();
  saveSessionResourceLayout({ ...identity, token: 'SENTINEL' } as typeof identity, { ...layout, viewerUrl: 'SENTINEL', openIds: [...layout.openIds, 'https://evil/open#SENTINEL'] } as typeof layout, store, 100);
  assert.doesNotMatch(store.getItem(SESSION_LAYOUT_KEY)!, /SENTINEL|https/);
  assert.equal(loadSessionResourceLayout({ ...identity, ownerId: 'other' }, store, 100), null);
  assert.equal(loadSessionResourceLayout(identity, store, 86_400_100), null);
  for (let i = 0; i < 30; i++) saveSessionResourceLayout({ ...identity, sessionId: `s-${i}` }, layout, store, 101);
  assert.equal(JSON.parse(store.getItem(SESSION_LAYOUT_KEY)!).entries.length, 24);
  store.setItem(SESSION_LAYOUT_KEY, '{bad'); assert.equal(loadSessionResourceLayout(identity), null);
  assert.equal(saveSessionResourceLayout(identity, layout, null), false);
  const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); }, removeItem: () => { throw new Error('denied'); } };
  assert.equal(loadSessionResourceLayout(identity, throwing), null); assert.equal(saveSessionResourceLayout(identity, layout, throwing), false);
});
it('clears only the departing/deleted owner and rejects a guest scope', () => {
  const store = storage(); saveSessionResourceLayout(identity, layout);
  const other = { ...identity, ownerId: 'other' }; saveSessionResourceLayout(other, layout);
  assert.equal(clearSessionResourceLayouts('owner'), true);
  assert.equal(loadSessionResourceLayout(identity), null); assert.ok(loadSessionResourceLayout(other));
  clearSessionResourceLayouts('other'); assert.equal(store.getItem(SESSION_LAYOUT_KEY), null);
  assert.equal(saveSessionResourceLayout({ ...identity, ownerId: 'guest' }, layout), false);
});
