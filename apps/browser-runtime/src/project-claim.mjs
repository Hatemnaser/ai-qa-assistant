import { publishProjectRegistration, withProjectRegistration } from './project-registration.mjs';

export async function claimManagedExecution(project) {
  return withProjectRegistration(project, async () => {
    if(project.isManagedActive&&!project.isManagedActive())return null;
    const receipt = await publishProjectRegistration(project);
    if(project.isManagedActive&&!project.isManagedActive())return null;
    const registration = project.registration;
    return project.client.claimV2({ instanceId: registration.instanceId, registrationId: receipt.registrationId });
  });
}
