import { effectScope, ref } from 'vue';
import { useChatDrafts } from '../chat/composables/useChatDrafts';
import { accountDraftPersistence } from '../chat/draftPersistence';
import type { SelectedAttachment } from '../chat/types';
import type { TestSessionDetail } from '../test-sessions/types';

/** Persisted-only fallback before a session editor has mounted in this account. */
export function createSessionDraftRelocator(owner: () => string | undefined, conflictMessage: string, storageMessage: string) {
  const identity = owner();
  let storageFailed = false;
  const scope = effectScope();
  const drafts = scope.run(() => useChatDrafts({
    messageInput: ref(''), selectedMode: ref('general'), selectedModel: ref(''),
    quickActionMode: ref<string | null>(null), selectedAttachments: ref<SelectedAttachment[]>([]),
  }, accountDraftPersistence(owner), () => { storageFailed = true; }))!;
  function assertCurrent() { if (!identity || owner() !== identity) throw new Error(conflictMessage); }
  return {
    async checkProjectMove(id: string, from: string, to: string) {
      assertCurrent();
      const allowed = await drafts.canRelocate(`${from}:${id}`, `${to}:${id}`);
      assertCurrent();
      if (!allowed) throw new Error(conflictMessage);
    },
    async applyProjectMove(value: TestSessionDetail, from: string) {
      assertCurrent();
      const moved = await drafts.relocate(`${from}:${value.id}`, `${value.projectId}:${value.id}`);
      assertCurrent();
      if (!moved) throw new Error(conflictMessage);
      if (storageFailed) throw new Error(storageMessage);
    },
    dispose: () => scope.stop(),
  };
}
