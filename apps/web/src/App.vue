<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, ref, watch } from "vue";

import { useAuthSession } from "./features/auth/composables/useAuthSession";
import type { AuthUser } from "./features/auth/types";
import { clearAssetDownloadUrlCache } from "./features/assets/assetsApi";
import { clearChats, getUserChatStorageScope, loadChatSyncState } from "./features/chat/chatStorage";
import { fetchSessionIndex, fetchTestSession, updateTestSession } from "./features/sessions/sessionApi";
import { fetchUsageSummary } from "./features/usage/usageApi";
import { canRestoreLastWork, readWorkspaceNavigation, resolveLastWork, saveWorkspaceNavigation, type LastWork, type WorkspaceNavigation, type WorkView } from "./router/lastWork";
import type { SidebarTestItem } from "./features/test-sessions/navigation";
import type { TestSessionDetail } from "./features/test-sessions/types";
import ProjectFormModal from "./features/projects/components/ProjectFormModal.vue";
import { createProject, fetchProjects } from "./features/projects/projectsApi";
import { fetchProjectInstruction } from "./features/project-instructions/projectInstructionsApi";
import { fetchQaRequest } from "./features/qa/qaApi";
import type { Project, ProjectInput } from "./features/projects/types";
import { fetchUserSettings, updateUserSettings } from "./features/settings/settingsApi";
import type { UserSettings } from "./features/settings/types";
import ChatComposer from "./features/chat/components/ChatComposer.vue";
import SessionComposerDock from "./features/chat/components/SessionComposerDock.vue";
import SessionToolsPanel from "./features/sessions/SessionToolsPanel.vue";
import { buildSessionSources, type SessionSource } from "./features/sessions/sessionSources";
import { createSessionDraftRelocator } from "./features/sessions/sessionDraftRelocation";
import type { ChatAttachment } from "./features/chat/types";
import ChatHome from "./features/chat/components/ChatHome.vue";
import ChatContextMenus from "./features/chat/components/ChatContextMenus.vue";
import ChatDeleteModal from "./features/chat/components/ChatDeleteModal.vue";
import GuestLimitModal from "./features/chat/components/GuestLimitModal.vue";
import ChatMessages from "./features/chat/components/ChatMessages.vue";
import ChatSidebar from "./features/chat/components/ChatSidebar.vue";
import ChatTopbar from "./features/chat/components/ChatTopbar.vue";
import { useTheme } from "./features/chat/chatTheme";
import { useAccountChatSync } from "./features/chat/composables/useAccountChatSync";
import { useChatController } from "./features/chat/composables/useChatController";
import { useI18n } from "./i18n/useI18n";
import { parseProjectRouteScope, parseTestRouteScope, useAppRoute, type AuthView, type TestRouteScope } from "./router/useAppRoute";

const ForgotPasswordPage = defineAsyncComponent(() => import("./features/auth/pages/ForgotPasswordPage.vue"));
const LoginPage = defineAsyncComponent(() => import("./features/auth/pages/LoginPage.vue"));
const ProjectsPage = defineAsyncComponent(() => import("./features/projects/ProjectsPage.vue"));
const QaWorkspacePage = defineAsyncComponent(() => import("./features/qa/QaWorkspacePage.vue"));
const SessionPage = defineAsyncComponent(() => import("./features/sessions/SessionPage.vue"));
const RegisterPage = defineAsyncComponent(() => import("./features/auth/pages/RegisterPage.vue"));
const ResetPasswordPage = defineAsyncComponent(() => import("./features/auth/pages/ResetPasswordPage.vue"));
const SettingsPage = defineAsyncComponent(() => import("./features/settings/SettingsPage.vue"));
const UsagePage = defineAsyncComponent(() => import("./features/usage/UsagePage.vue"));
const VerifyEmailPage = defineAsyncComponent(() => import("./features/auth/pages/VerifyEmailPage.vue"));

const {
  currentRoute,
  testScope,
  projectScope,
  navigateToAuth: navigateToAuthRoute,
  navigateToChat,
  navigateToHome,
  navigateToProjects,
  navigateToSettings,
  navigateToUsage,
  navigateToWorkspace,
} = useAppRoute();
const { authLoading, authReadError, clearCurrentUser, currentUser, loadCurrentUser, logoutCurrentUser, setAuthenticatedUser } = useAuthSession();
const isGuestLimitModalOpen = ref(false);
const accountSettings = ref<UserSettings | null>(null);
const accountProjects = ref<Project[]>([]);
const isLoadingProjects = ref(false);
const projectLoadError = ref("");
const projectToOpenId = ref<string | null>(null);
const chatPendingProjectCreate = ref<string | null>(null);
const isProjectCreateModalOpen = ref(false);
const isCreatingProject = ref(false);
const projectCreateModalError = ref("");
type SidebarTestRecord = SidebarTestItem;
const testSessions = ref<SidebarTestRecord[]>([]);
const isLoadingTests = ref(false);
const testLoadError = ref("");
const workView = ref<"conversations" | "tests">(currentRoute.value === "workspace" ? "tests" : "conversations");
const lastTestScope = ref<TestRouteScope>(testScope.value);
const navigationState = ref<WorkspaceNavigation>({ activeView: "conversations" });
const qaProjectFilter = ref("");
const chatPanelToggleTarget = ref<HTMLElement | null>(null);
const projectCreateForTest = ref(false);
const restoringView = ref<WorkView | null>(null);
const restoreError = ref("");
let restoreRevision = 0;
const isSessionReady = ref(false);
const startupHash = window.location.hash;
const startupPath = window.location.pathname;
let requestedWorkHash: string | null = null;
let testLoadRevision = 0;
let testIndexPromise: Promise<SidebarTestRecord[]> | null = null;
let testIndexOwner: string | null = null;
let navigationRevision = 0;
let accountSettingsLoadRevision = 0;
let projectLoadRevision = 0;
let themeSaveRevision = 0;
let composerRevision = 0;
let sessionMoveIdentityRevision = 0;

function navigateToAuth(view: AuthView) {
  if (["workspace", "chat", "home", "projects"].includes(currentRoute.value)) requestedWorkHash = window.location.hash;
  isGuestLimitModalOpen.value = false;
  navigateToAuthRoute(view);
}

function handleAuthenticated(user: AuthUser) {
  clearAssetDownloadUrlCache();
  setAuthenticatedUser(user);
  setChatStorageOwner(user.id, { adoptGuestChats: true });
  prepareNewChat();
  clearGuestLimitReached();
  isGuestLimitModalOpen.value = false;
  void finishAuthenticatedStartup(user, requestedWorkHash);
}

function handleNewChat() {
  cancelRestoration();
  workView.value = "conversations";
  chatToResumeId.value = null;
  startNewChat();
  navigateToChat();
}

function handleOpenHome() {
  cancelRestoration();
  rememberCurrentWork();
  if (currentRoute.value === "chat") chatToResumeId.value = activeChatId.value;
  workView.value = "conversations";
  navigateToHome();
}

function handleHomeSubmit() {
  if (!canSubmitGuestChat.value || isSending.value || (!messageInput.value.trim() && !selectedAttachments.value.length)) return;
  void handleSubmit();
  navigateToChat();
}

async function handleImportedChat(event: Event) {
  const imported = await handleImportChat(event);
  if (imported) {
    workView.value = "conversations";
    if (currentUser.value) { await persistAccountChats(); await loadTestIndex(true); navigateToChat({ sessionId: imported.id }); }
    else navigateToChat();
  }
}

function handleSidebarChatSelected(chatId: string) {
  cancelRestoration();
  workView.value = "conversations";
  if (currentUser.value) {
    const item = testSessions.value.find(item => item.id === chatId);
    navigateToChat({ sessionId: chatId, projectId: item?.projectId || undefined });
  } else { selectChat(chatId); navigateToChat(); }
}

function handleOpenProjects() {
  cancelRestoration();
  chatPendingProjectCreate.value = null;
  projectToOpenId.value = null;
  navigateToProjects();
}

function handleOpenWorkspace() {
  void restoreWorkspace("tests");
}

function handleOpenConversations() {
  void restoreWorkspace("conversations");
}

function handleNewTest() {
  cancelRestoration();
  workView.value = "tests";
  const projectId = qaProjectFilter.value;
  lastTestScope.value = projectId ? { projectId } : {};
  navigateToChat(lastTestScope.value);
}

function handleTestSelected(item: SidebarTestRecord) {
  cancelRestoration();
  workView.value = "tests";
  const scope = { projectId: item.projectId, ...(item.id.startsWith("request:") ? { requestId: item.requestId } : { sessionId: item.id }) };
  lastTestScope.value = scope;
  navigateToChat(scope);
}

function handleTestScopeChange(scope: TestRouteScope) {
  lastTestScope.value = scope;
  if (isUnifiedSession.value || isProjectSessionDraft.value) navigateToChat(scope);
}

function handleNewProject() {
  projectCreateForTest.value = false;
  openGlobalProjectCreateModal(null);
}

function handleCreateProjectForTest() {
  projectCreateForTest.value = true;
  openGlobalProjectCreateModal(null);
}

function handleOpenProject(projectId: string) {
  cancelRestoration();
  chatPendingProjectCreate.value = null;
  projectToOpenId.value = projectId;
  navigateToProjects({ projectId });
}

function handleProjectDestinationChanged(projectId: string | null) {
  projectToOpenId.value = projectId;
  if (currentRoute.value === "projects" && (projectScope.value.projectId || null) !== projectId)
    navigateToProjects({ projectId: projectId || undefined, view: workView.value });
}

function handleProjectNewTest(projectId: string) {
  cancelRestoration();
  workView.value = "tests";
  navigateToChat({ projectId });
}

function handleOtherProjectWorkspace(projectId: string) {
  cancelRestoration();
  rememberCurrentWork();
  workView.value = workView.value === "tests" ? "conversations" : "tests";
  navigateToProjects({ projectId, view: workView.value });
}

function handleCreateProjectForChat(chatId: string) {
  closeChatMenus();
  openGlobalProjectCreateModal(chatId);
}

async function handleLogout() {
  try {
    await logoutCurrentUser(async () => {
      clearScheduledChatPersist();

      if (currentUser.value) {
        await persistAccountChats();
      }
    });
  } catch (error) {
    console.warn(error instanceof Error ? error.message : "Could not sign out.");
    return;
  }

  // A newer login can supersede an in-flight logout. Never clear that newer
  // account's local state after the older request settles.
  if (currentUser.value) return;

  clearAssetDownloadUrlCache();
  setChatStorageOwner(null);
  clearGuestLimitReached();
}

function handleAccountDeleted(userId: string) {
  clearAssetDownloadUrlCache();
  clearScheduledChatPersist();
  clearChats(getUserChatStorageScope(userId));
  clearCurrentUser();
  setChatStorageOwner(null);
  accountSettings.value = null;
  accountProjects.value = [];
  closeGlobalProjectCreateModal();
  projectLoadError.value = "";
  clearGuestLimitReached();
  navigateToWorkspace();
}

const {
  activeChat,
  activeChatId,
  activeMessages,
  applyQuickAction,
  assignActiveChatProject,
  assignChatProject,
  beginRenameChat,
  cancelDeleteChat,
  cancelRenameChat,
  chatPendingDelete,
  chats,
  closeChatMenus,
  clearGuestLimitReached,
  confirmDeleteChat,
  copyAnswer,
  exportActiveChat,
  exportAnswer,
  exportChat,
  handleAttachmentsSelected,
  handleImportChat,
  handleSubmit: submitGuestChat,
  guestLimitReached,
  isSending,
  loadAiModelCatalog,
  messageInput,
  modelOptions,
  openChatMenu,
  openChatMenuForChat,
  openExportMenu,
  openExportMenuChat,
  openExportSubmenu,
  openMenuChat,
  openProjectMenu,
  openProjectMenuChat,
  openProjectSubmenu,
  prepareNewChatForProject,
  prepareNewChat,
  renamingChatId,
  requestDeleteChat,
  replaceChats,
  removeSelectedAttachment,
  selectChat,
  selectedAttachments,
  selectedMode,
  selectedModel,
  selectedProjectId,
  sendingChatId,
  setChatStorageOwner,
  setDefaultModel,
  submitRenameChat,
  startNewChat,
  usageSummary,
} = useChatController(currentUser);

const { clearScheduledChatPersist, deletePersistedChat, persistAccountChats, syncAccountChats } =
  useAccountChatSync({
    chats,
    currentUser,
    replaceChats,
    strictReconciliation: true,
  });
async function settleLegacySession(id: string) {
  const owner = currentUser.value?.id;
  if (!owner) throw new Error(t('testSessions.errors.scope'));
  clearScheduledChatPersist();
  await persistAccountChats();
  if (currentUser.value?.id !== owner) throw new Error(t('testSessions.errors.scope'));
  const pending = loadChatSyncState(getUserChatStorageScope(owner));
  if ([...pending.pendingCreates, ...pending.pendingUpserts, ...pending.pendingDeletes].includes(id)) throw new Error(t('sessions.syncConflict'));
}
const { setTheme, theme, themeToggleLabel, toggleTheme } = useTheme();
const { locale, setLocale, t } = useI18n();
const isGuestLimitBlocked = computed(() => !currentUser.value && guestLimitReached.value);
const guestAccountDestination = computed(() => !currentUser.value && (
  (["chat", "workspace"].includes(currentRoute.value) && Boolean(testScope.value.sessionId || testScope.value.requestId || testScope.value.projectId))
  || (currentRoute.value === "projects" && Boolean(projectScope.value.projectId))
));
// A null identity during bootstrap or a failed read is not a confirmed guest.
// Owned links must never silently fall through to the legacy guest transport.
const authGateVisible = computed(() => authLoading.value || authReadError.value || guestAccountDestination.value);
const canSubmitGuestChat = computed(() => !currentUser.value && !authGateVisible.value);
async function handleSubmit() {
  if (!canSubmitGuestChat.value) return;
  await submitGuestChat();
}
const isUnifiedSession = computed(() => Boolean(currentUser.value && ["workspace", "chat", "home"].includes(currentRoute.value)));
const isProjectSessionDraft = computed(() => Boolean(currentUser.value && currentRoute.value === "projects" && projectToOpenId.value));
const isSessionControllerActive = computed(() => isUnifiedSession.value || isProjectSessionDraft.value);
const projectSessionComposerTarget = ref<HTMLElement | null>(null);
const sessionPageScope = computed(() => currentRoute.value === "projects" ? { projectId: projectToOpenId.value || undefined } : testScope.value);
const sessionRefreshRevision = ref(0);
const sessionPage = ref<{
  exportTranscript(format: import('./features/chat/types').ExportFormat): void;
  checkProjectMove(id: string, from: string, to: string): Promise<void>;
  applyProjectMove(value: TestSessionDetail, from: string): Promise<void>;
} | null>(null);
let retainedSessionPage: NonNullable<typeof sessionPage.value> | null = null;
watch(sessionPage, value => { if (value) retainedSessionPage = value; }, { flush: 'sync' });
const guestSourceId = ref<string | null>(null);
const guestSourcesOpen = ref(false);
const guestSourceOpener = ref<HTMLElement | null>(null);
const guestSourceScope = computed(() => `guest:${currentRoute.value}:${activeChatId.value || selectedProjectId.value || 'new'}`);
const guestSources = computed(() => buildSessionSources(activeMessages.value, selectedAttachments.value));
watch([guestSourceScope, () => currentUser.value?.id], () => { guestSourcesOpen.value = false; guestSourceId.value = null; guestSourceOpener.value = null; });
function openGuestSource(source: SessionSource | undefined) {
  if (currentUser.value || !source) return;
  guestSourceOpener.value = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  guestSourceId.value = source.id;
  guestSourcesOpen.value = true;
}
function openGuestAttachment(attachment: ChatAttachment) {
  openGuestSource(guestSources.value.find(source => attachment.assetId ? source.assetId === attachment.assetId : source.name === attachment.name && source.mimeType === attachment.mimeType));
}
function openGuestDraftAttachment(index: number) {
  openGuestSource(guestSources.value.find(source => source.file === selectedAttachments.value[index]?.file));
}
async function locateGuestSourceMessage(id: string) {
  const scope = guestSourceScope.value;
  guestSourcesOpen.value = false;
  await nextTick(); await nextTick();
  if (currentUser.value || guestSourceScope.value !== scope) return;
  const element = [...document.querySelectorAll<HTMLElement>('.chat-area [data-message-id]')].find(item => item.dataset.messageId === id);
  element?.focus({ preventScroll: true }); element?.scrollIntoView({ block: 'center' });
}
function handleExportSession(format: import('./features/chat/types').ExportFormat) {
  if (isSessionControllerActive.value) sessionPage.value?.exportTranscript(format);
  else exportActiveChat(format);
}
function handleSidebarSessionUpdated() { sessionRefreshRevision.value += 1; void handleSessionUpdated(); }
const sidebarActiveProjectId = computed(() => isUnifiedSession.value ? sessionPageScope.value.projectId || null : currentRoute.value === "projects" ? projectToOpenId.value : selectedProjectId.value);
const activeTestId = computed(() => testScope.value.sessionId || (testScope.value.requestId ? `request:${testScope.value.requestId}` : null));
const chatToResumeId = ref(activeChatId.value);
const activeProject = computed(() => accountProjects.value.find((project) => project.id === selectedProjectId.value) || null);

function syncComposerSurface() {
  if (!canSubmitGuestChat.value) return;
  if (currentRoute.value === "home") prepareNewChat();
  else if (currentRoute.value === "projects" && workView.value === "conversations" && projectToOpenId.value) prepareNewChatForProject(projectToOpenId.value);
  else if (currentRoute.value === "chat") {
    if (activeChatId.value) chatToResumeId.value = activeChatId.value;
    else if (chatToResumeId.value) selectChat(chatToResumeId.value);
  }
}

watch([currentRoute, projectToOpenId, workView], syncComposerSurface, { immediate: true });
watch(activeChatId, (id) => { if (currentRoute.value === "chat") chatToResumeId.value = id; }, { flush: "sync" });
watch([currentRoute, activeChatId, selectedProjectId, messageInput, selectedMode, selectedModel, selectedAttachments], () => { composerRevision += 1; }, { deep: true, flush: "sync" });

onMounted(() => {
  void loadAiModelCatalog();
  void initializeSession();
});

watch(isGuestLimitBlocked, (isBlocked) => {
  if (isBlocked) {
    isGuestLimitModalOpen.value = true;
  }
});

watch(
  () => currentUser.value?.id || null,
  () => {
    resetAccountScopedState();
    void loadAccountProjects();
  },
  { flush: "sync" }
);

watch(currentRoute, (route, previousRoute) => {
  navigationRevision += 1;
  restoreRevision += 1;
  restoringView.value = null;
  restoreError.value = "";
  if (route === "workspace") workView.value = "tests";
  if (route === "chat" || route === "home") workView.value = "conversations";
  // Canonicalizing an old Tests link is still the same open session. Re-reading
  // projects here would transiently hide (and invalidate) its exact approval.
  if (["chat", "workspace", "home"].includes(route) && !["chat", "workspace", "home", "projects"].includes(previousRoute)) {
    void loadAccountProjects();
  }
});
watch(testScope, (scope) => {
  navigationRevision += 1;
  cancelRestoration();
  if (currentRoute.value === "workspace") lastTestScope.value = scope;
});
watch([currentRoute, projectScope], () => {
  if (currentRoute.value !== "projects") return;
  navigationRevision += 1;
  cancelRestoration();
  workView.value = projectScope.value.view || "conversations";
  projectToOpenId.value = projectScope.value.projectId || null;
}, { immediate: true });
watch(() => accountProjects.value.map((project) => project.id).sort().join("|"), () => { void loadTestIndex(); });
watch([currentRoute, testScope, projectToOpenId, activeChatId, selectedProjectId, isSessionReady], rememberCurrentWork, { deep: true });
watch(qaProjectFilter, persistNavigation);

async function initializeSession() {
  const user = await loadCurrentUser();
  if (authReadError.value) return;

  setChatStorageOwner(user?.id || null);
  syncComposerSurface();

  if (user) {
    const explicit = startupHash || (startupPath !== "/" ? `#${startupPath}` : null);
    await finishAuthenticatedStartup(user, explicit);
  }
  syncComposerSurface();
}

async function finishAuthenticatedStartup(user: AuthUser, explicitHash: string | null) {
  const revision = navigationRevision;
  const accountRevision = sessionMoveIdentityRevision;
  const currentOwner = () => currentUser.value?.id === user.id && sessionMoveIdentityRevision === accountRevision;
  await Promise.all([syncAccountChats(), applyAccountSettings(), loadAccountProjects()]);
  if (!currentOwner()) return;
  await Promise.all([loadTestIndex(), refreshUsage()]);
  if (!currentOwner()) return;
  if (navigationRevision !== revision) { isSessionReady.value = true; return; }
  try { navigationState.value = readWorkspaceNavigation(window.localStorage, user.id); } catch { /* Optional storage. */ }
  if (!["workspace", "home", "chat", "projects"].includes(currentRoute.value)) workView.value = navigationState.value.activeView;
  qaProjectFilter.value = navigationState.value.qaProjectFilter || "";
  if (!projectLoadError.value && !accountProjects.value.some(project => project.id === qaProjectFilter.value)) qaProjectFilter.value = "";
  const isWorkLink = explicitHash && /^#\/(?:tests(?:\?|$)|chat(?:\?|$)|home(?:\?|$)|projects(?:\?|$)|$)/.test(explicitHash);
  if (isWorkLink) {
    const isTestLink = /^#\/(?:tests(?:\?|$)|$)/.test(explicitHash);
    const scope = parseTestRouteScope(explicitHash);
    const projectDestination = parseProjectRouteScope(explicitHash);
    // Canonical session links are authorized by the owner-scoped detail read,
    // not absence from a capped sidebar index or the legacy Tests project rule.
    if (projectDestination.projectId && !projectLoadError.value && !accountProjects.value.some(project => project.id === projectDestination.projectId)) {
      openDestination({ view: projectDestination.view || "conversations", page: "home" });
    } else if (isTestLink) {
      const current = () => currentOwner() && navigationRevision === revision;
      try {
        const resolved = await resolveLastWork({ view: "tests", ...scope }, {
          session: id => fetchTestSession("", id), request: fetchQaRequest,
          project: fetchProjectInstruction, current,
        });
        if (!current()) return;
        if (!resolved) navigateToChat();
        else if (!scope.projectId && resolved.projectId) openDestination(resolved);
        else { lastTestScope.value = scope; window.location.hash = explicitHash.slice(1); }
      } catch {
        if (!current()) return;
        // Keep the explicit destination. The session's normal scoped read/retry
        // presents the failure; a failed read must not discard the old link.
        lastTestScope.value = scope;
        window.location.hash = explicitHash.slice(1);
      }
    } else {
      window.location.hash = explicitHash.slice(1);
    }
  } else if (!explicitHash || currentRoute.value === "login" || currentRoute.value === "register") {
    await restoreWorkspace(navigationState.value.activeView, false);
  }
  if (!currentOwner()) return;
  requestedWorkHash = null;
  isSessionReady.value = true;
}

function persistNavigation() {
  const userId = currentUser.value?.id;
  if (!userId || !isSessionReady.value) return;
  try { saveWorkspaceNavigation(window.localStorage, userId, navigationState.value); }
  catch { /* Optional storage. */ }
}

function rememberCurrentWork() {
  if (!currentUser.value || !isSessionReady.value || restoringView.value) return;
  let destination: LastWork | undefined;
  if (currentRoute.value === "workspace") {
    destination = { view: "tests", ...testScope.value };
    if (projectLoadError.value || testLoadError.value || !canRestoreLastWork(destination, {
      projectIds: new Set(accountProjects.value.map(project => project.id)), chats: [], tests: testSessions.value,
    })) return;
  }
  else if (currentRoute.value === "chat") destination = { view: "conversations", page: "chat",
    ...(testScope.value.projectId ? { projectId: testScope.value.projectId } : {}),
    ...(testScope.value.sessionId ? { chatId: testScope.value.sessionId } : {}),
    ...(testScope.value.requestId ? { requestId: testScope.value.requestId } : {}) };
  // Home, project management and settings never erase the last working session.
  if (destination) {
    navigationState.value.last = destination;
    navigationState.value[destination.view] = destination;
    navigationState.value.activeView = destination.view;
  }
  persistNavigation();
}

function openDestination(destination: LastWork) {
  workView.value = destination.view;
  if (destination.view === "tests") { lastTestScope.value = destination; navigateToChat(destination); }
  else if (destination.page === "home") navigateToHome();
  else if (destination.page === "projects") {
    projectToOpenId.value = destination.projectId || null;
    navigateToProjects({ projectId: destination.projectId });
  } else {
    navigateToChat({ projectId: destination.projectId, sessionId: destination.sessionId || destination.chatId, requestId: destination.requestId });
  }
}

function cancelRestoration() {
  restoreRevision += 1;
  restoringView.value = null;
  restoreError.value = "";
}

async function restoreWorkspace(view: WorkView, remember = true) {
  if (remember && !restoringView.value) rememberCurrentWork();
  const revision = ++restoreRevision;
  const routeRevision = navigationRevision;
  const userId = currentUser.value?.id;
  let destination = navigationState.value.last || navigationState.value[view] || { view, ...(view === "conversations" ? { page: "home" as const } : {}) };
  const current = () => currentUser.value?.id === userId && revision === restoreRevision && routeRevision === navigationRevision;
  restoringView.value = destination.view;
  restoreError.value = "";
  try {
    if (userId) {
      const resolved = await resolveLastWork(destination, {
        session: id => fetchTestSession("", id),
        request: fetchQaRequest,
        // There is no project-detail GET. This existing read verifies current
        // project access even when the project is outside the sidebar list.
        project: fetchProjectInstruction,
        current,
      });
      if (!current()) return;
      if (!resolved) {
        const home: LastWork = { view: "conversations", page: "home" };
        navigationState.value = { activeView: "conversations", last: home };
        persistNavigation();
        openDestination(home);
        return;
      }
      destination = resolved;
    }
    if (revision !== restoreRevision || routeRevision !== navigationRevision) return;
    openDestination(destination);
  } catch {
    if (currentUser.value?.id === userId && revision === restoreRevision && routeRevision === navigationRevision)
      restoreError.value = t("workspaces.restoreError");
  } finally {
    if (revision === restoreRevision && !restoreError.value) restoringView.value = null;
  }
}

function loadTestIndex(force = false): Promise<SidebarTestRecord[]> {
  const userId = currentUser.value?.id;
  if (!userId) return Promise.resolve([]);
  const indexOwner = userId;
  if (!force && testIndexPromise && testIndexOwner === indexOwner) return testIndexPromise;
  const revision = ++testLoadRevision;
  isLoadingTests.value = true;
  testLoadError.value = "";
  const promise = fetchSessionIndex().then(result => {
    return [
      ...result.sessions.map((item): SidebarTestRecord => ({ ...item })),
      ...result.unlinkedRequests.map((item): SidebarTestRecord => ({ ...item, id: `request:${item.id}`, requestId: item.id })),
    ];
  }).then((items) => {
    if (currentUser.value?.id !== userId || revision !== testLoadRevision) return [];
    testSessions.value = items.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    rememberCurrentWork();
    return testSessions.value;
  }).catch((error: unknown) => {
    if (currentUser.value?.id === userId && revision === testLoadRevision) {
      // A failed read is not a deletion. Keep this owner's last successful list.
      testLoadError.value = error instanceof Error ? error.message : t("testSessions.nav.loadError");
    }
    return [];
  }).finally(() => {
    if (revision === testLoadRevision) { isLoadingTests.value = false; testIndexPromise = null; testIndexOwner = null; }
  });
  testIndexPromise = promise;
  testIndexOwner = indexOwner;
  return promise;
}

let usageRevision = 0;
const usageLoading = ref(false);
const usageError = ref("");
async function refreshUsage() {
  const owner = currentUser.value?.id;
  const revision = ++usageRevision;
  if (!owner) return;
  usageLoading.value = true;
  usageError.value = "";
  try {
    const value = await fetchUsageSummary();
    if (currentUser.value?.id === owner && revision === usageRevision && [value.limit, value.remaining, value.used].every(Number.isFinite)) usageSummary.value = value;
  } catch {
    // Keep this owner's last authoritative value; never estimate a local debit.
    if (currentUser.value?.id === owner && revision === usageRevision) usageError.value = t('sessionTools.usage.unavailable');
  } finally {
    if (currentUser.value?.id === owner && revision === usageRevision) usageLoading.value = false;
  }
}
function handleSessionUpdated() { void loadTestIndex(true); void refreshUsage(); }

function confirmDeleteChatAndSync() {
  const deletedChatId = chatPendingDelete.value?.id;

  confirmDeleteChat();

  void deletePersistedChat(deletedChatId);
}

async function applyAccountSettings() {
  const userId = currentUser.value?.id;
  const requestRevision = ++accountSettingsLoadRevision;
  const draftRevision = composerRevision;
  if (!userId) return;

  try {
    const settings = await fetchUserSettings();

    if (currentUser.value?.id === userId && accountSettingsLoadRevision === requestRevision) {
      applySavedSettings(settings, composerRevision === draftRevision);
    }
  } catch {
    // Settings should not block chat startup.
  }
}

function handleSettingsSaved(settings: UserSettings) {
  applySavedSettings(settings);
}

async function handleAccountImported() {
  await Promise.all([syncAccountChats(), loadAccountProjects()]);
}

function handleProjectsChanged(projects: Project[]) {
  accountProjects.value = [...projects];
  projectLoadError.value = "";
  reconcileProjectListFilter(projects);
}

function openGlobalProjectCreateModal(chatId: string | null) {
  if (!currentUser.value) {
    chatPendingProjectCreate.value = null;
    navigateToAuth("login");
    return;
  }

  chatPendingProjectCreate.value = chatId;
  projectCreateModalError.value = "";
  isProjectCreateModalOpen.value = true;
}

function closeGlobalProjectCreateModal() {
  if (isCreatingProject.value) return;

  isProjectCreateModalOpen.value = false;
  chatPendingProjectCreate.value = null;
  projectCreateModalError.value = "";
  projectCreateForTest.value = false;
}

async function handleGlobalProjectCreate(input: ProjectInput) {
  const userId = currentUser.value?.id;
  if (!userId) {
    closeGlobalProjectCreateModal();
    navigateToAuth("login");
    return;
  }

  isCreatingProject.value = true;
  projectCreateModalError.value = "";

  try {
    const project = await createProject(input);
    if (currentUser.value?.id !== userId) return;

    const pendingChatId = chatPendingProjectCreate.value;
    const forTest = projectCreateForTest.value;

    accountProjects.value = [project, ...accountProjects.value.filter((item) => item.id !== project.id)];

    if (pendingChatId) {
      assignChatProject(pendingChatId, project.id);
    }

    isProjectCreateModalOpen.value = false;
    chatPendingProjectCreate.value = null;
    projectCreateForTest.value = false;
    if (forTest) { navigateToChat({ projectId: project.id }); return; }
    projectToOpenId.value = project.id;
    if (workView.value === "tests" && !pendingChatId) {
      lastTestScope.value = { projectId: project.id };
      navigateToWorkspace(lastTestScope.value);
    } else navigateToProjects({ projectId: project.id, view: "conversations" });
  } catch (error) {
    if (currentUser.value?.id === userId) {
      projectCreateModalError.value = error instanceof Error ? error.message : "Could not create this project.";
    }
  } finally {
    if (currentUser.value?.id === userId) {
      isCreatingProject.value = false;
    }
  }
}

function handleProjectChatSelected(chatId: string) {
  handleSidebarChatSelected(chatId);
}

async function handleAddChatsToProject(chatIds: string[], projectId: string) {
  const ids = [...new Set(chatIds)];
  const owner = currentUser.value?.id;
  if (!owner) {
    for (const id of ids) assignChatProject(id, projectId);
    projectToOpenId.value = projectId;
    return;
  }
  const identity = sessionMoveIdentityRevision;
  const isCurrent = () => currentUser.value?.id === owner && sessionMoveIdentityRevision === identity;
  const assertCurrent = () => { if (!isCurrent()) throw new Error(t('testSessions.errors.scope')); };
  try {
    for (const id of ids) {
      assertCurrent();
      if (id.startsWith('request:')) throw new Error(t('projects.addChats.notMovable'));
      const item = testSessions.value.find(item => item.id === id);
      let value = await fetchTestSession(item?.projectId || '', id);
      assertCurrent();
      if (value.managed === false) {
        await settleLegacySession(id);
        assertCurrent();
        value = await fetchTestSession(value.projectId, id);
        assertCurrent();
      }
      if (value.requests.length || value.archivedAt) throw new Error(t('projects.addChats.notMovable'));
      if (value.projectId === projectId) continue;
      // KeepAlive clears its template ref while deactivated. Its draft store
      // still owns unsent edits and must remain the source of truth for moves.
      const page = sessionPage.value || retainedSessionPage;
      const fallback = page ? null : createSessionDraftRelocator(() => isCurrent() ? owner : undefined,
        t('sessions.draftMoveConflict'), t('sessions.draftStorage'));
      const relocator = page || fallback!;
      const routeRevision = navigationRevision;
      try {
        await relocator.checkProjectMove(id, value.projectId, projectId);
        assertCurrent();
        const moved = await updateTestSession(value.projectId, id, {
          projectId, expectedSessionVersion: value.version, expectedUpdatedAt: value.updatedAt,
        });
        assertCurrent();
        // Keep successful moves visible even when another selection or the index refresh fails.
        testSessions.value = testSessions.value.map(entry => entry.id === id ? {
          ...entry, projectId: moved.projectId, updatedAt: moved.updatedAt, archivedAt: moved.archivedAt,
          requestIds: moved.requests.map(request => request.id),
        } : entry);
        await relocator.applyProjectMove(moved, value.projectId);
        assertCurrent();
        // Keep a currently open explicit link canonical, without pulling a user
        // back after they navigated elsewhere while the server move was pending.
        if (routeRevision === navigationRevision && isUnifiedSession.value
          && testScope.value.sessionId === id && (testScope.value.projectId || '') === value.projectId) {
          navigateToChat({ ...testScope.value, projectId: moved.projectId });
        }
      } finally { fallback?.dispose(); }
    }
  } finally {
    if (isCurrent()) {
      sessionRefreshRevision.value++;
      await loadTestIndex(true);
    }
  }
}

async function handleMoveSession(id: string, _from: string, to: string) {
  await handleAddChatsToProject([id], to);
}

function handleProjectMessageSubmit(projectId: string) {
  if (!canSubmitGuestChat.value) return;
  const hasDraft = Boolean(messageInput.value.trim() || selectedAttachments.value.length);

  if (!hasDraft || isSending.value) {
    void handleSubmit();
    return;
  }

  prepareNewChatForProject(projectId);
  void handleSubmit();
  navigateToChat();
}

async function loadAccountProjects(): Promise<Project[]> {
  const userId = currentUser.value?.id || null;
  const requestRevision = ++projectLoadRevision;
  projectLoadError.value = "";

  if (!userId) {
    accountProjects.value = [];
    isLoadingProjects.value = false;
    return [];
  }

  isLoadingProjects.value = true;

  try {
    const projects = await fetchProjects();

    if (currentUser.value?.id !== userId || projectLoadRevision !== requestRevision) return [];

    accountProjects.value = projects;
    reconcileProjectListFilter(projects);
    return projects;
  } catch (error) {
    if (currentUser.value?.id === userId && projectLoadRevision === requestRevision) {
      projectLoadError.value = error instanceof Error ? error.message : "Could not load projects.";
    }

    return [];
  } finally {
    if (currentUser.value?.id === userId && projectLoadRevision === requestRevision) {
      isLoadingProjects.value = false;
    }
  }
}

function resetAccountScopedState() {
  sessionMoveIdentityRevision += 1;
  retainedSessionPage = null;
  usageRevision += 1;
  usageSummary.value = null;
  usageLoading.value = false;
  usageError.value = "";
  restoreRevision += 1;
  restoringView.value = null;
  restoreError.value = "";
  navigationState.value = { activeView: "tests" };
  qaProjectFilter.value = "";
  testLoadRevision += 1;
  testIndexPromise = null;
  testIndexOwner = null;
  testSessions.value = [];
  testLoadError.value = "";
  isLoadingTests.value = false;
  isSessionReady.value = false;
  lastTestScope.value = {};
  chatToResumeId.value = null;
  accountSettingsLoadRevision += 1;
  projectLoadRevision += 1;
  themeSaveRevision += 1;
  accountSettings.value = null;
  accountProjects.value = [];
  isLoadingProjects.value = false;
  projectLoadError.value = "";
  isProjectCreateModalOpen.value = false;
  isCreatingProject.value = false;
  chatPendingProjectCreate.value = null;
  projectCreateModalError.value = "";
  projectToOpenId.value = null;
}

function reconcileProjectListFilter(projects: Project[]) {
  const projectIds = new Set(projects.map((project) => project.id));
  if (qaProjectFilter.value && !projectIds.has(qaProjectFilter.value)) qaProjectFilter.value = "";
  // A capped/unavailable project list is not authority to move saved sessions.
  // Preserve membership for the sidebar recovery group; explicit mutations
  // remain responsible for changing it.
}

function applySavedSettings(settings: UserSettings, applyComposerDefault = true) {
  accountSettings.value = settings;
  setDefaultModel(settings.defaultModel);
  if (applyComposerDefault) selectedModel.value = settings.defaultModel;
  setLocale(settings.language);
  setTheme(settings.theme);
}

function handleToggleTheme() {
  toggleTheme();
  void persistThemeSetting();
}

async function persistThemeSetting() {
  const userId = currentUser.value?.id;
  const requestRevision = ++themeSaveRevision;
  if (!userId) return;

  try {
    const settings = await updateUserSettings({
      defaultModel: accountSettings.value?.defaultModel || selectedModel.value,
      language: accountSettings.value?.language || locale.value,
      theme: theme.value,
    });

    if (currentUser.value?.id === userId && themeSaveRevision === requestRevision) {
      accountSettings.value = settings;
    }
  } catch {
    // Local theme changes should still work if the account settings save fails.
  }
}
</script>

<template>
  <LoginPage
    v-if="currentRoute === 'login'"
    :theme-toggle-label="themeToggleLabel"
    @authenticated="handleAuthenticated"
    @back-to-chat="navigateToChat"
    @navigate="navigateToAuth"
    @toggle-theme="toggleTheme"
  />

  <RegisterPage
    v-else-if="currentRoute === 'register'"
    :theme-toggle-label="themeToggleLabel"
    @back-to-chat="navigateToChat"
    @navigate="navigateToAuth"
    @toggle-theme="toggleTheme"
  />

  <VerifyEmailPage
    v-else-if="currentRoute === 'verify-email'"
    :theme-toggle-label="themeToggleLabel"
    @back-to-chat="navigateToChat"
    @navigate="navigateToAuth"
    @toggle-theme="toggleTheme"
  />

  <ForgotPasswordPage
    v-else-if="currentRoute === 'forgot-password'"
    :theme-toggle-label="themeToggleLabel"
    @back-to-chat="navigateToChat"
    @navigate="navigateToAuth"
    @toggle-theme="toggleTheme"
  />

  <ResetPasswordPage
    v-else-if="currentRoute === 'reset-password'"
    :theme-toggle-label="themeToggleLabel"
    @back-to-chat="navigateToChat"
    @navigate="navigateToAuth"
    @toggle-theme="toggleTheme"
  />

  <div v-else class="app">
    <ChatSidebar
      :active-chat-id="activeChatId"
      :active-project-id="sidebarActiveProjectId"
      :chats="currentUser ? [] : chats"
      :current-user="currentUser"
      :is-chat-route="currentRoute === 'chat'"
      :is-home-route="currentRoute === 'home'"
      :is-projects-route="currentRoute === 'projects'"
      :is-workspace-route="isUnifiedSession"
      :projects="accountProjects"
      :renaming-chat-id="renamingChatId"
      :theme-toggle-label="themeToggleLabel"
      :usage-summary="usageSummary"
      :usage-loading="usageLoading"
      :usage-error="usageError"
      :project-load-error="projectLoadError"
      :is-loading-projects="isLoadingProjects"
      @reload-usage="refreshUsage"
      :before-adopt="settleLegacySession"
      :move-session="handleMoveSession"
      @session-updated="handleSidebarSessionUpdated"
      :work-view="workView"
      :test-sessions="testSessions"
      :active-test-id="activeTestId"
      :is-loading-tests="isLoadingProjects || isLoadingTests"
      :test-load-error="projectLoadError || testLoadError"
      :qa-project-filter="qaProjectFilter"
      @update:qa-project-filter="qaProjectFilter = $event"
      @cancel-rename="cancelRenameChat"
      @export-active-chat="handleExportSession"
      @import-chat="handleImportedChat"
      @logout="handleLogout"
      @new-chat="handleNewChat"
      @new-test="handleNewTest"
      @select-test="handleTestSelected"
      @open-conversations="handleOpenConversations"
      @reload-tests="loadAccountProjects().then(() => loadTestIndex(true))"
      @open-home="handleOpenHome"
      @new-project="handleNewProject"
      @open-project="handleOpenProject"
      @open-projects="handleOpenProjects"
      @open-settings="navigateToSettings"
      @open-usage="navigateToUsage"
      @open-workspace="handleOpenWorkspace"
      @select-chat="handleSidebarChatSelected"
      @sign-in="navigateToAuth('login')"
      @open-chat-menu="openChatMenuForChat"
      @rename-chat="submitRenameChat"
      @toggle-theme="handleToggleTheme"
    />

    <div v-if="restoringView" class="workspace-restore-notice workspace-surface" :role="restoreError ? 'alert' : 'status'">
      {{ restoreError || t('workspaces.restoring') }}
      <button v-if="restoreError" type="button" class="btn btn-secondary" @click="restoreWorkspace(restoringView!, false)">{{ t('testSessions.retry') }}</button>
    </div>

    <main v-if="authGateVisible" class="chat-layout focused-layout workspace-surface">
      <div class="workspace-feedback" :role="authReadError ? 'alert' : 'status'">
        <p>{{ authLoading ? t('testSessions.loading') : authReadError ? t('errors.connectBackend') : t('auth.login.subtitle') }}</p>
        <button v-if="authReadError" type="button" class="btn btn-secondary" @click="initializeSession">{{ t('testSessions.retry') }}</button>
        <button v-if="!authLoading" type="button" class="btn btn-secondary" @click="navigateToAuth('login')">{{ t('app.actions.signIn') }}</button>
      </div>
    </main>

    <main v-else-if="currentRoute === 'home' && !currentUser" class="chat-layout focused-layout workspace-surface">
      <ChatHome :chats="chats" :projects="accountProjects" @select-chat="handleSidebarChatSelected" />
      <SessionComposerDock scroll-selector=".chat-area">
      <ChatComposer
        v-model:message="messageInput" v-model:mode="selectedMode" v-model:model="selectedModel"
        :model-options="modelOptions" :show-starters="true"
        :disabled="isGuestLimitBlocked" :disabled-message="t('errors.guestLimit')"
        :is-sending="isSending" :selected-attachments="selectedAttachments"
        @attachments-selected="handleAttachmentsSelected" @disabled-click="isGuestLimitModalOpen = true"
        @open-selected-attachment="openGuestDraftAttachment" @remove-selected-attachment="removeSelectedAttachment"
        @quick-action="applyQuickAction" @submit="handleHomeSubmit"
      />
      </SessionComposerDock>
    </main>

    <main v-else-if="currentRoute === 'workspace' && !currentUser" class="chat-layout">
      <QaWorkspacePage
        :current-user="currentUser"
        :is-loading-projects="isLoadingProjects"
        :project-load-error="projectLoadError"
        :project-to-open-id="projectToOpenId"
        :projects="accountProjects"
        @new-project="handleNewProject"
        @open-chat="handleNewChat"
        @reload-projects="loadAccountProjects"
        @sign-in="navigateToAuth('login')"
      />
    </main>

    <main v-else-if="currentRoute === 'usage'" class="chat-layout">
      <UsagePage
        :identity-key="currentUser ? `user:${currentUser.id}` : 'guest'"
        @back-to-chat="navigateToChat"
      />
    </main>

    <main v-else-if="currentRoute === 'projects' && !isUnifiedSession" class="chat-layout workspace-surface">
      <ProjectsPage
        work-view="tests"
        :test-sessions="testSessions"
        :is-loading-tests="isLoadingTests"
        :test-load-error="testLoadError"
        @select-test="handleTestSelected"
        @new-test="handleProjectNewTest"
        @reload-tests="loadTestIndex(true)"
        v-model:message="messageInput"
        :chats="currentUser ? [] : chats"
        :current-user="currentUser"
        :disabled="isGuestLimitBlocked"
        :disabled-message="t('errors.guestLimit')"
        :is-loading-projects="isLoadingProjects"
        :is-sending="isSending"
        :mode="selectedMode"
        :project-load-error="projectLoadError"
        :project-to-open-id="projectToOpenId"
        :projects="accountProjects"
        :refresh-chats="syncAccountChats"
        :refresh-projects="loadAccountProjects"
        :selected-attachments="selectedAttachments"
        @active-project-changed="handleProjectDestinationChanged"
        :add-chats-to-project="handleAddChatsToProject"
        @attachments-selected="handleAttachmentsSelected"
        @disabled-click="isGuestLimitModalOpen = true"
        @open-chat="handleProjectChatSelected"
        @open-selected-attachment="openGuestDraftAttachment"
        @projects-changed="handleProjectsChanged"
        @quick-action="applyQuickAction"
        @remove-selected-attachment="removeSelectedAttachment"
        @sign-in="navigateToAuth('login')"
        @submit-project-message="handleProjectMessageSubmit"
      >
        <template #composer="{ projectId }">
          <div v-if="currentUser" ref="projectSessionComposerTarget" class="project-session-composer-host" />
          <ChatComposer
            v-else
            v-model:message="messageInput" v-model:mode="selectedMode" v-model:model="selectedModel"
            :model-options="modelOptions" :show-starters="true"
            :disabled="isGuestLimitBlocked" :disabled-message="t('errors.guestLimit')"
            :is-sending="isSending" :selected-attachments="selectedAttachments"
            @attachments-selected="handleAttachmentsSelected" @disabled-click="isGuestLimitModalOpen = true"
            @open-selected-attachment="openGuestDraftAttachment" @remove-selected-attachment="removeSelectedAttachment"
            @quick-action="applyQuickAction" @submit="handleProjectMessageSubmit(projectId)"
          />
        </template>
      </ProjectsPage>
    </main>

    <main v-else-if="currentRoute === 'settings'" class="chat-layout">
      <SettingsPage
        :current-user="currentUser"
        :model-options="modelOptions"
        :refresh-imported-account-data="handleAccountImported"
        @account-deleted="handleAccountDeleted"
        @back-to-chat="navigateToChat"
        @settings-saved="handleSettingsSaved"
        @sign-in="navigateToAuth('login')"
      />
    </main>

    <main v-else-if="currentRoute === 'chat' && !currentUser" class="chat-layout focused-layout workspace-surface">
      <ChatTopbar
        :chat-title="activeChat?.title"
        :is-loading-projects="isLoadingProjects"
        :model-options="modelOptions"
        :project-error="projectLoadError"
        :project-id="selectedProjectId"
        :projects="accountProjects"
        :usage-summary="usageSummary"
        @open-projects="handleOpenProjects"
        @open-project="handleOpenProject"
        @update:project-id="assignActiveChatProject"
      ><template #actions><span ref="chatPanelToggleTarget" /></template></ChatTopbar>

      <div class="chat-workspace" :class="{ 'chat-workspace--project': currentUser && activeProject }">
      <div class="chat-workspace__main">
      <ChatMessages
        :copy-answer="copyAnswer"
        :is-sending="isSending && sendingChatId === activeChatId"
        :messages="activeMessages"
        @export-answer="exportAnswer"
        @open-attachment="openGuestAttachment"
        @quick-action="applyQuickAction"
      />

      <SessionComposerDock scroll-selector=".chat-area">

      <ChatComposer
        v-model:message="messageInput"
        v-model:mode="selectedMode"
        v-model:model="selectedModel"
        :model-options="modelOptions"
        :show-starters="activeMessages.length === 0"
        :disabled="isGuestLimitBlocked"
        :disabled-message="t('errors.guestLimit')"
        :is-sending="isSending"
        :selected-attachments="selectedAttachments"
        @attachments-selected="handleAttachmentsSelected"
        @disabled-click="isGuestLimitModalOpen = true"
        @open-selected-attachment="openGuestDraftAttachment"
        @quick-action="applyQuickAction"
        @remove-selected-attachment="removeSelectedAttachment"
        @submit="handleSubmit"
      />
      </SessionComposerDock>
      </div>
      </div>
    </main>

    <main v-if="currentUser" v-show="isUnifiedSession" :key="currentUser.id" class="chat-layout focused-layout workspace-surface test-session-shell">
      <KeepAlive>
      <SessionPage
          ref="sessionPage"
        v-if="isSessionControllerActive"
        :active="isSessionControllerActive"
        :composer-target="isProjectSessionDraft ? projectSessionComposerTarget : null"
          :key="currentUser.id"
          :current-user="currentUser"
          :projects="accountProjects"
          :is-loading-projects="isLoadingProjects"
          :project-load-error="projectLoadError"
          :preferred-project-id="sessionPageScope.projectId"
          :session-id="sessionPageScope.sessionId"
          :request-id="sessionPageScope.requestId"
          :model-options="modelOptions" :preferred-model="accountSettings?.defaultModel"
          :before-adopt="settleLegacySession"
          :refresh-revision="sessionRefreshRevision"
          @scope-change="handleTestScopeChange"
          @reload-projects="loadAccountProjects"
          @session-updated="handleSessionUpdated"
          @open-conversations="handleOpenConversations"
          @open-project="handleOpenProject"
          @open-projects="handleOpenProjects"
        />
      </KeepAlive>
    </main>

    <SessionToolsPanel v-if="!currentUser && guestSourcesOpen" :scope-key="guestSourceScope" current-tool="sources" :force-drawer="true" :sources="guestSources" :selected-source-id="guestSourceId" :opener-element="guestSourceOpener" @close="guestSourcesOpen = false" @select-source="guestSourceId = $event" @focus-message="locateGuestSourceMessage" />

    <ChatContextMenus
      :export-menu="openExportMenu"
      :export-menu-chat="openExportMenuChat"
      :menu-chat="openMenuChat"
      :menu-position="openChatMenu"
      :project-menu="openProjectMenu"
      :project-menu-chat="openProjectMenuChat"
      :projects="accountProjects"
      @assign-chat-project="assignChatProject"
      @create-project-for-chat="handleCreateProjectForChat"
      @delete-chat="requestDeleteChat"
      @export-chat="exportChat"
      @open-export-submenu="openExportSubmenu"
      @open-project-submenu="openProjectSubmenu"
      @rename-chat="beginRenameChat"
    />

    <ProjectFormModal
      :error-message="projectCreateModalError"
      :is-open="isProjectCreateModalOpen"
      :is-saving="isCreatingProject"
      :project="null"
      @cancel="closeGlobalProjectCreateModal"
      @save="handleGlobalProjectCreate"
    />
    <ChatDeleteModal :chat="chatPendingDelete" @cancel="cancelDeleteChat" @confirm="confirmDeleteChatAndSync" />
    <GuestLimitModal
      v-if="isGuestLimitBlocked && isGuestLimitModalOpen"
      @close="isGuestLimitModalOpen = false"
      @export-chat="exportActiveChat('json')"
      @register="navigateToAuth('register')"
      @sign-in="navigateToAuth('login')"
    />
  </div>
</template>
