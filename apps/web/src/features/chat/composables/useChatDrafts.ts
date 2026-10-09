import { getCurrentScope, onScopeDispose, ref, watch } from "vue";
import type { Ref } from "vue";

import { MAX_SELECTED_ATTACHMENTS, releaseSelectedAttachment } from "../chatAttachments";
import { DEFAULT_MODE, DEFAULT_MODEL } from "../constants";
import type { SelectedAttachment } from "../types";
import type { DraftPersistence } from '../draftPersistence';

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

// Memory is the default. Managed sessions opt into account-scoped IndexedDB;
// private drafts never enter persisted Chat snapshots or localStorage contracts.
export function useChatDrafts(refs: ChatDraftRefs, persistence?: DraftPersistence, onStorageError?: () => void) {
  const entries = new Map<string, DraftEntry>();
  let defaultModel = DEFAULT_MODEL;
  let activeKey = "new:";
  let active = createDraft();
  let restoring = false;
  let disposed = false;
  const hydrating = ref(false);
  let hydrationRevision = 0;
  let ownerRevision = 0;
  const pendingLoads = new Map<string, Promise<void>>();
  const failedLoads = new Set<string>();
  function persist(key = activeKey, draft = active) { void persistence?.save(key, { ...draft, attachments: [...draft.attachments] }).catch(() => onStorageError?.()); }
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
      persist();
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
    const existing = entries.has(key);
    activeKey = key;
    active = entries.get(key) || createDraft({ model: defaultModel, ...defaults });
    entries.set(key, active);
    restore();
    const token = ++hydrationRevision;
    hydrating.value = false;
    if (!existing && persistence && !disposed) {
      const entry = active;
      const revision = entry.revision;
      hydrating.value = true;
      const load = persistence.load(key).then(saved => {
        if (!saved) return;
        // A navigation can leave this entry inactive while its read finishes.
        // Hydrate that same untouched entry, but never a reset or edited draft.
        if (!entry.valid || entry.revision !== revision) { saved.attachments.forEach(releaseSelectedAttachment); return; }
        Object.assign(entry, saved);
        if (entry === active) restore();
      }).catch(failure => { if (entry.valid) failedLoads.add(key); throw failure; });
      pendingLoads.set(key, load);
      void load.catch(() => { if (entry.valid) onStorageError?.(); }).finally(() => {
        if (pendingLoads.get(key) === load) pendingLoads.delete(key);
        if (token === hydrationRevision) hydrating.value = false;
      });
    }
  }

  /** Read a destination before transferring a different private draft over it. */
  async function restoreStoredDraft(key: string) {
    const revision = ownerRevision;
    const pending = pendingLoads.get(key);
    if (pending) await pending;
    if (disposed || ownerRevision !== revision) return false;
    if (failedLoads.has(key)) throw new Error('Draft storage read failed');
    if (entries.has(key)) return true;
    if (!persistence || disposed) return false;
    const saved = await persistence.load(key);
    if (!saved) return false;
    if (disposed || ownerRevision !== revision) {
      saved.attachments.forEach(releaseSelectedAttachment);
      return false;
    }
    // Another selection may have hydrated or edited the destination while its
    // stored copy was loading. Never overwrite that newer in-memory revision.
    if (entries.has(key)) saved.attachments.forEach(releaseSelectedAttachment);
    else entries.set(key, createDraft(saved));
    return true;
  }

  async function canRelocate(from: string, to: string) {
    if (from === to) return true;
    const revision = ownerRevision;
    await Promise.all([restoreStoredDraft(from), restoreStoredDraft(to)]);
    if (disposed || revision !== ownerRevision) return false;
    const hasContent = (entry?: DraftEntry) => Boolean(entry?.message || entry?.attachments.length);
    return !hasContent(entries.get(from)) || !hasContent(entries.get(to));
  }

  async function relocate(from: string, to: string) {
    if (from === to) return true;
    const revision = ownerRevision;
    if (!await canRelocate(from, to) || revision !== ownerRevision) return false;
    const source = entries.get(from);
    const destination = entries.get(to);
    if (!source) return true;
    // An empty source must not replace a draft already saved at the destination.
    const moved = destination && (destination.message || destination.attachments.length) ? destination : source;
    entries.delete(from);
    entries.set(to, moved);
    if (activeKey === from || activeKey === to) { activeKey = to; active = moved; restore(); }
    if (source !== moved) { source.valid = false; source.attachments.forEach(releaseSelectedAttachment); }
    if (destination && destination !== moved) { destination.valid = false; destination.attachments.forEach(releaseSelectedAttachment); }
    // Rekey memory before the asynchronous write so newer typing persists to
    // the new destination rather than being deleted with the former key.
    try {
      if (persistence) await persistence.save(to, { ...moved, attachments: [...moved.attachments] });
    } catch {
      onStorageError?.();
      return !disposed && revision === ownerRevision;
    }
    if (disposed || revision !== ownerRevision) return false;
    // As with transferTo, retain the old durable copy if writing the new key fails.
    // Navigation may already have started another draft at the previous key.
    if (!entries.has(from)) await persistence?.remove(from).catch(() => onStorageError?.());
    return true;
  }

  function transferTo(key: string) {
    if (key === activeKey) return;
    const previous = activeKey;
    const entry = active;
    entries.delete(activeKey);
    activeKey = key;
    entries.set(key, active);
    ++hydrationRevision; hydrating.value = false;
    // Save the destination before clearing the old key, so a failed write never loses a draft.
    if (persistence) void persistence.save(key, { ...active, attachments: [...active.attachments] }).then(() => {
      if (entry.valid && !entries.has(previous)) return persistence.remove(previous);
    }).catch(() => onStorageError?.());
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
    const key = [...entries].find(([, entry]) => entry === draft)?.[0];
    if (key) persist(key, draft);
  }

  function appendAttachments(ticket: ChatDraftTicket, attachments: SelectedAttachment[]) {
    const draft = ticket.entry;
    if (!draft.valid) return "stale" as const;
    if (draft.attachments.length + attachments.length > MAX_SELECTED_ATTACHMENTS) return "full" as const;
    draft.attachments = [...draft.attachments, ...attachments];
    draft.revision += 1;
    if (draft === active) restore();
    const key = [...entries].find(([, entry]) => entry === draft)?.[0];
    if (key) persist(key, draft);
    return "added" as const;
  }

  function remove(key: string, persisted = true) {
    const draft = entries.get(key);
    if (!draft) return;
    draft.valid = false;
    draft.attachments.forEach(releaseSelectedAttachment);
    entries.delete(key);
    if (persisted) void persistence?.remove(key).catch(() => onStorageError?.());
  }

  function retainChats(ids: Set<string>) {
    for (const key of entries.keys()) {
      if (key.startsWith("chat:") && !ids.has(key.slice(5))) remove(key);
    }
  }

  function reset() {
    ownerRevision += 1;
    pendingLoads.clear(); failedLoads.clear();
    ++hydrationRevision; hydrating.value = false;
    for (const key of entries.keys()) remove(key, false);
    defaultModel = DEFAULT_MODEL;
    select("new:");
  }

  function setDefaultModel(model: string) {
    defaultModel = model;
    if (!active.message && !active.attachments.length && active.revision === 0) { active.model = model; restore(); }
  }

  if (getCurrentScope()) onScopeDispose(() => {
    disposed = true;
    stop();
    reset();
  });

  return { appendAttachments, capture, consume, remove, reset, retainChats, select, setDefaultModel, transferTo, restoreStoredDraft, canRelocate, relocate, hydrating };
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
