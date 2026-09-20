import { getCurrentScope, onScopeDispose, watch } from "vue";
import type { Ref } from "vue";

import { MAX_SELECTED_ATTACHMENTS, releaseSelectedAttachment } from "../chatAttachments";
import { DEFAULT_MODE, DEFAULT_MODEL } from "../constants";
import type { SelectedAttachment } from "../types";

interface DraftValues {
  message: string;
  mode: string;
  model: string;
  quickAction: string | null;
  attachments: SelectedAttachment[];
}

interface DraftEntry extends DraftValues {
  revision: number;
  valid: boolean;
}

export interface ChatDraftTicket {
  readonly entry: DraftEntry;
  readonly revision: number;
}

export interface ChatDraftRefs {
  messageInput: Ref<string>;
  selectedMode: Ref<string>;
  selectedModel: Ref<string>;
  quickActionMode: Ref<string | null>;
  selectedAttachments: Ref<SelectedAttachment[]>;
}

// This store deliberately lives only for the current account session. File objects
// and private unsent text never enter the persisted Chat or localStorage contracts.
export function useChatDrafts(refs: ChatDraftRefs) {
  const entries = new Map<string, DraftEntry>();
  let defaultModel = DEFAULT_MODEL;
  let activeKey = "new:";
  let active = createDraft();
  let restoring = false;
  entries.set(activeKey, active);

  const stop = watch(
    [refs.messageInput, refs.selectedMode, refs.selectedModel, refs.quickActionMode, refs.selectedAttachments],
    () => {
      if (restoring) return;
      Object.assign(active, {
        message: refs.messageInput.value,
        mode: refs.selectedMode.value,
        model: refs.selectedModel.value,
        quickAction: refs.quickActionMode.value,
        attachments: [...refs.selectedAttachments.value],
      });
      active.revision += 1;
    },
    { flush: "sync" }
  );

  function restore() {
    restoring = true;
    refs.messageInput.value = active.message;
    refs.selectedMode.value = active.mode;
    refs.selectedModel.value = active.model;
    refs.quickActionMode.value = active.quickAction;
    refs.selectedAttachments.value = [...active.attachments];
    // Mode/model compatibility watchers may normalize the model synchronously.
    active.model = refs.selectedModel.value;
    restoring = false;
  }

  function select(key: string, defaults: Partial<DraftValues> = {}) {
    activeKey = key;
    active = entries.get(key) || createDraft({ model: defaultModel, ...defaults });
    entries.set(key, active);
    restore();
  }

  function transferTo(key: string) {
    entries.delete(activeKey);
    activeKey = key;
    entries.set(key, active);
  }

  function capture(): ChatDraftTicket {
    return { entry: active, revision: active.revision };
  }

  function consume(ticket: ChatDraftTicket, resetQuickAction: boolean) {
    const draft = ticket.entry;
    if (!draft.valid || draft.revision !== ticket.revision) return;
    draft.attachments.forEach(releaseSelectedAttachment);
    draft.attachments = [];
    draft.message = "";
    draft.quickAction = null;
    if (resetQuickAction) draft.mode = DEFAULT_MODE;
    draft.revision += 1;
    if (draft === active) restore();
  }

  function appendAttachments(ticket: ChatDraftTicket, attachments: SelectedAttachment[]) {
    const draft = ticket.entry;
    if (!draft.valid) return "stale" as const;
    if (draft.attachments.length + attachments.length > MAX_SELECTED_ATTACHMENTS) return "full" as const;
    draft.attachments = [...draft.attachments, ...attachments];
    draft.revision += 1;
    if (draft === active) restore();
    return "added" as const;
  }

  function remove(key: string) {
    const draft = entries.get(key);
    if (!draft) return;
    draft.valid = false;
    draft.attachments.forEach(releaseSelectedAttachment);
    entries.delete(key);
  }

  function retainChats(ids: Set<string>) {
    for (const key of entries.keys()) {
      if (key.startsWith("chat:") && !ids.has(key.slice(5))) remove(key);
    }
  }

  function reset() {
    for (const key of entries.keys()) remove(key);
    defaultModel = DEFAULT_MODEL;
    select("new:");
  }

  function setDefaultModel(model: string) {
    defaultModel = model;
  }

  if (getCurrentScope()) onScopeDispose(() => {
    stop();
    reset();
  });

  return { appendAttachments, capture, consume, remove, reset, retainChats, select, setDefaultModel, transferTo };
}

function createDraft(defaults: Partial<DraftValues> = {}): DraftEntry {
  return {
    message: "",
    mode: DEFAULT_MODE,
    model: DEFAULT_MODEL,
    quickAction: null,
    attachments: [],
    ...defaults,
    revision: 0,
    valid: true,
  };
}
