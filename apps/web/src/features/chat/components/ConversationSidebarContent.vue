<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { Chat } from "../types";
import type { Project } from "../../projects/types";
import { useI18n } from "../../../i18n/useI18n";
import Icon from "../../../ui/Icon.vue";
import SidebarSessionList from "../../sessions/SidebarSessionList.vue";
import { partitionSessionList } from "../../sessions/sessionListPresentation";
import SidebarNavItem from "./SidebarNavItem.vue";
import type { SidebarTestItem } from "../../test-sessions/navigation";
const props = defineProps<{
  chats: Chat[]; projects: Project[]; activeChatId: string | null; activeProjectId?: string | null;
  isChatRoute: boolean; isProjectsRoute: boolean; renamingChatId: string | null;
  tests?: SidebarTestItem[]; activeTestId?: string | null; isWorkspaceRoute?: boolean;
  beforeAdopt?: (id: string) => Promise<void>; projectLoadError?: string; isLoadingProjects?: boolean;
  moveSession?: (id: string, from: string, to: string) => Promise<void>;
}>();
const emit = defineEmits<{
  "open-projects": []; "new-project": []; "open-project": [id: string];
  "select-chat": [id: string]; "cancel-rename": []; "rename-chat": [id: string, title: string];
  "open-chat-menu": [event: MouseEvent, id: string]; "select-test": [item: SidebarTestItem]; navigate: [];
  "session-updated": []; "reload-projects": [];
}>();
const { t } = useI18n();
const areProjectsOpen = ref(true), areRecentChatsOpen = ref(true), areArchivedOpen = ref(false);
const expandedProjectIds = ref(new Set<string>());
const partition = computed(() => partitionSessionList({ chats: props.chats, sessions: props.tests, projects: props.projects }));
const projectGroups = computed(() => partition.value.projectGroups);
const recentSessions = computed(() => partition.value.standalone.active);
const archivedSessions = computed(() => partition.value.standalone.archived);
const unavailableProjectGroups = computed(() => partition.value.unavailableProjectGroups);
const activeSession = computed(() => partition.value.entries.find(entry => entry.id === (props.isWorkspaceRoute ? props.activeTestId : props.activeChatId)));
function getProjectSessions(id: string) { return projectGroups.value.find(group => group.project.id === id)?.active || []; }
function hasProjectSessions(id: string) {
  const group = projectGroups.value.find(group => group.project.id === id);
  return Boolean(group && (group.active.length || group.archived.length));
}
function isProjectExpanded(id: string) { return hasProjectSessions(id) && expandedProjectIds.value.has(id); }
function toggleProject(id: string) {
  if (!hasProjectSessions(id)) return;
  const next = new Set(expandedProjectIds.value);
  if (next.has(id)) next.delete(id); else next.add(id);
  expandedProjectIds.value = next;
}
function isProjectActive(id: string) {
  return (props.isProjectsRoute && props.activeProjectId === id) ||
    (activeSession.value?.projectId === id && !isProjectExpanded(id));
}
watch([() => props.activeProjectId, () => activeSession.value?.id, () => activeSession.value?.projectId, () => props.isProjectsRoute], ([projectId, , sessionProjectId]) => {
  const id = props.isProjectsRoute ? projectId : sessionProjectId || projectId;
  if (id) { areProjectsOpen.value = true; expandedProjectIds.value = new Set([...expandedProjectIds.value, id]); }
}, { immediate: true });
watch([() => activeSession.value?.id, () => activeSession.value?.archivedAt, () => activeSession.value?.projectId], ([, archivedAt, projectId]) => {
  if (archivedAt && !projectId) areArchivedOpen.value = true;
}, { immediate: true });
function navigate(action: () => void) { emit("navigate"); action(); }
</script>

<template>
  <div class="conversation-navigation">
    <section class="sidebar-section">
      <div class="sidebar-section-heading">
        <button class="sidebar-section-link" :class="{ active: isProjectsRoute && !activeProjectId }" type="button" @click="navigate(() => emit('open-projects'))">{{ t('sidebar.nav.projects') }}</button>
        <button class="sidebar-section-toggle sidebar-section-toggle--icon" type="button" :aria-label="t('sidebar.nav.toggleProjects')" :aria-expanded="areProjectsOpen" aria-controls="sidebar-projects" @click="areProjectsOpen = !areProjectsOpen"><span class="sidebar-section-chevron" aria-hidden="true">&rsaquo;</span></button>
      </div>
      <div v-if="areProjectsOpen" id="sidebar-projects" class="sidebar-section-body">
        <SidebarNavItem icon="plus" :label="t('sidebar.nav.newProject')" @click="navigate(() => emit('new-project'))" />
        <div v-for="group in projectGroups" :key="group.project.id" class="sidebar-project-group">
          <div class="ui-row ui-row--compact ui-row--interactive sidebar-project-row" :class="{ active: isProjectActive(group.project.id) }">
            <button class="ui-row__button sidebar-project-toggle" type="button" :aria-current="isProjectsRoute && activeProjectId === group.project.id ? 'page' : undefined" @click="navigate(() => emit('open-project', group.project.id))">
              <span class="ui-row__icon" aria-hidden="true"><Icon :name="isProjectExpanded(group.project.id) ? 'folder-open' : 'folder'" /></span><span class="ui-row__title">{{ group.project.name }}</span>
            </button>
            <div class="ui-row__action sidebar-project-actions"><button class="ui-icon-btn ui-icon-btn--xs ui-icon-btn--ghost" type="button" :aria-label="t('sidebar.project.toggleChats', { project: group.project.name })" :aria-expanded="isProjectExpanded(group.project.id)" :disabled="!hasProjectSessions(group.project.id)" @click.stop="toggleProject(group.project.id)"><span class="sidebar-section-chevron" :class="{ 'sidebar-section-chevron--closed': !isProjectExpanded(group.project.id) }" aria-hidden="true">&rsaquo;</span></button></div>
          </div>
          <div v-if="isProjectExpanded(group.project.id)" class="sidebar-project-chats">
            <SidebarSessionList :entries="group.active" :projects="projects" :before-adopt="beforeAdopt" :move-session="moveSession" :active-chat-id="activeChatId" :active-session-id="activeTestId" :renaming-chat-id="renamingChatId" :is-chat-route="isChatRoute" :is-workspace-route="isWorkspaceRoute"
              @select-chat="id => navigate(() => emit('select-chat', id))" @select-session="item => navigate(() => emit('select-test', item))" @cancel-rename="emit('cancel-rename')" @rename-chat="(id, title) => emit('rename-chat', id, title)" @open-chat-menu="(event, id) => emit('open-chat-menu', event, id)" @session-updated="emit('session-updated')" />
            <details v-if="group.archived.length" class="sidebar-archive" :open="group.archived.some(entry => entry.id === activeTestId)">
              <summary>{{ t('sessionTools.navigation.archive') }}</summary>
              <SidebarSessionList :entries="group.archived" :projects="projects" :before-adopt="beforeAdopt" :move-session="moveSession" :active-chat-id="activeChatId" :active-session-id="activeTestId" :renaming-chat-id="renamingChatId" :is-chat-route="isChatRoute" :is-workspace-route="isWorkspaceRoute"
                @select-chat="id => navigate(() => emit('select-chat', id))" @select-session="item => navigate(() => emit('select-test', item))" @cancel-rename="emit('cancel-rename')" @rename-chat="(id, title) => emit('rename-chat', id, title)" @open-chat-menu="(event, id) => emit('open-chat-menu', event, id)" @session-updated="emit('session-updated')" />
            </details>
          </div>
        </div>
      </div>
    </section>
    <section class="sidebar-section">
      <button class="sidebar-section-toggle" type="button" :aria-expanded="areRecentChatsOpen" @click="areRecentChatsOpen = !areRecentChatsOpen"><span>{{ t('sidebar.nav.recentChats') }}</span><span class="sidebar-section-chevron" aria-hidden="true">&rsaquo;</span></button>
      <template v-if="areRecentChatsOpen">
        <SidebarSessionList v-if="recentSessions.length" :entries="recentSessions" :projects="projects" :before-adopt="beforeAdopt" :move-session="moveSession" :active-chat-id="activeChatId" :active-session-id="activeTestId" :renaming-chat-id="renamingChatId" :is-chat-route="isChatRoute" :is-workspace-route="isWorkspaceRoute"
          @select-chat="id => navigate(() => emit('select-chat', id))" @select-session="item => navigate(() => emit('select-test', item))" @cancel-rename="emit('cancel-rename')" @rename-chat="(id, title) => emit('rename-chat', id, title)" @open-chat-menu="(event, id) => emit('open-chat-menu', event, id)" @session-updated="emit('session-updated')" />
        <div v-else class="sidebar-empty">{{ t('sidebar.nav.noRecentChats') }}</div>
      </template>
      <template v-if="archivedSessions.length">
        <button class="sidebar-section-toggle" type="button" :aria-expanded="areArchivedOpen" @click="areArchivedOpen = !areArchivedOpen"><span>{{ t('sessionTools.navigation.archive') }}</span><span class="sidebar-section-chevron" aria-hidden="true">&rsaquo;</span></button>
        <SidebarSessionList v-if="areArchivedOpen" :entries="archivedSessions" :projects="projects" :before-adopt="beforeAdopt" :move-session="moveSession" :active-chat-id="activeChatId" :active-session-id="activeTestId" :renaming-chat-id="renamingChatId" :is-chat-route="isChatRoute" :is-workspace-route="isWorkspaceRoute"
          @select-chat="id => navigate(() => emit('select-chat', id))" @select-session="item => navigate(() => emit('select-test', item))" @cancel-rename="emit('cancel-rename')" @rename-chat="(id, title) => emit('rename-chat', id, title)" @open-chat-menu="(event, id) => emit('open-chat-menu', event, id)" @session-updated="emit('session-updated')" />
      </template>
    </section>
    <section v-if="unavailableProjectGroups.length" class="sidebar-section sidebar-unavailable-projects">
      <h2>{{ t('sessionTools.navigation.unavailableProjects') }}</h2>
      <p v-if="isLoadingProjects" role="status">{{ t('testSessions.nav.loading') }}</p>
      <p v-else>{{ t(projectLoadError ? 'sessionTools.navigation.unavailableRead' : 'sessionTools.navigation.unavailableMissing') }}</p>
      <button v-if="projectLoadError" class="btn btn-link" type="button" @click="emit('reload-projects')">{{ t('testSessions.retry') }}</button>
      <div v-for="group in unavailableProjectGroups" :key="group.projectId">
        <SidebarSessionList :entries="group.active" :projects="projects" :before-adopt="beforeAdopt" :move-session="moveSession" :active-chat-id="activeChatId" :active-session-id="activeTestId" :renaming-chat-id="renamingChatId" :is-chat-route="isChatRoute" :is-workspace-route="isWorkspaceRoute"
          @select-chat="id => navigate(() => emit('select-chat', id))" @select-session="item => navigate(() => emit('select-test', item))" @cancel-rename="emit('cancel-rename')" @rename-chat="(id, title) => emit('rename-chat', id, title)" @open-chat-menu="(event, id) => emit('open-chat-menu', event, id)" @session-updated="emit('session-updated')" />
        <details v-if="group.archived.length" class="sidebar-archive" :open="group.archived.some(entry => entry.id === activeTestId)"><summary>{{ t('sessionTools.navigation.archive') }}</summary>
          <SidebarSessionList :entries="group.archived" :projects="projects" :before-adopt="beforeAdopt" :move-session="moveSession" :active-chat-id="activeChatId" :active-session-id="activeTestId" :renaming-chat-id="renamingChatId" :is-chat-route="isChatRoute" :is-workspace-route="isWorkspaceRoute"
            @select-chat="id => navigate(() => emit('select-chat', id))" @select-session="item => navigate(() => emit('select-test', item))" @cancel-rename="emit('cancel-rename')" @rename-chat="(id, title) => emit('rename-chat', id, title)" @open-chat-menu="(event, id) => emit('open-chat-menu', event, id)" @session-updated="emit('session-updated')" />
        </details>
      </div>
    </section>
  </div>
</template>
