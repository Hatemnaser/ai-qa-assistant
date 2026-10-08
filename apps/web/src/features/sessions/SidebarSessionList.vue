<script setup lang="ts">
import type { SessionListEntry } from "./sessionListPresentation";
import type { Project } from "../projects/types";
import type { SidebarTestItem } from "../test-sessions/navigation";
import SidebarChatItem from "../chat/components/SidebarChatItem.vue";
import SidebarSessionItem from "./SidebarSessionItem.vue";

defineProps<{
  entries: SessionListEntry[]; projects: Project[]; activeChatId: string | null;
  activeSessionId?: string | null; renamingChatId: string | null; isChatRoute: boolean;
  isWorkspaceRoute?: boolean; beforeAdopt?: (id: string) => Promise<void>;
  moveSession?: (id: string, from: string, to: string) => Promise<void>;
}>();
const emit = defineEmits<{
  "select-chat": [id: string]; "select-session": [item: SidebarTestItem];
  "cancel-rename": []; "rename-chat": [id: string, title: string];
  "open-chat-menu": [event: MouseEvent, id: string]; "session-updated": [];
}>();
</script>

<template>
  <div class="sidebar-session-list">
    <template v-for="entry in entries" :key="entry.id">
      <SidebarChatItem v-if="entry.kind === 'chat'" :chat="entry.chat" :active="isChatRoute && entry.id === activeChatId" :renaming="entry.id === renamingChatId"
        @select="emit('select-chat', $event)" @cancel-rename="emit('cancel-rename')" @rename="(id, title) => emit('rename-chat', id, title)" @open-menu="(event, id) => emit('open-chat-menu', event, id)" />
      <SidebarSessionItem v-else :item="entry.item" :projects="projects" :before-adopt="beforeAdopt" :move-session="moveSession" :active="Boolean(isWorkspaceRoute && entry.id === activeSessionId)"
        @select="emit('select-session', $event)" @updated="emit('session-updated')" />
    </template>
  </div>
</template>
