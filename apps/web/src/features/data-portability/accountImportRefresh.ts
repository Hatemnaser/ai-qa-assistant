export async function refreshAccountDataAfterImport(dependencies: {
  refreshAccountMemory(): Promise<void>;
  refreshProjectsAndChats(): Promise<void>;
}) {
  await Promise.all([
    dependencies.refreshAccountMemory(),
    dependencies.refreshProjectsAndChats(),
  ]);
}
