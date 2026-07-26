import type { TranslationKey } from "../../i18n/messages";
import { t } from "../../i18n/useI18n";

export const ACCOUNT_IMPORT_WARNING_TRANSLATION_KEYS = {
  "Account data was imported, but one or more Project Documents are still pending or failed indexing. Canonical document content remains available for retry.":
    "portability.import.warning.documentIndexing",
  "Account identity, sign-in credentials, sessions, and settings are not replaced. Portable records are imported as new local data.":
    "portability.import.warning.accountIdentity",
  "Attachment references from the external service are not imported because original attachment file mapping is not supported yet.":
    "portability.import.warning.attachments",
  "Chat attachment metadata is included, but original attachment files are unavailable because chat file persistence is not implemented.":
    "portability.import.warning.attachments",
  "One or more ChatGPT conversations did not expose an active branch; messages were imported in timestamp order.":
    "portability.import.warning.chatBranch",
  "Projects and chats are created as new copies. Exact Account Memory duplicates are skipped.":
    "portability.import.warning.newCopies",
  "Some conversations without supported text messages were skipped.":
    "portability.import.warning.skippedContent",
  "Some non-user/assistant or unsupported message content was skipped.":
    "portability.import.warning.skippedContent",
  "The migration/conversations.json file is a provider-neutral reference file. External AI services may accept it as chat context, but it does not guarantee restoration of their native chat history or account settings.":
    "portability.import.warning.migrationReference",
} as const satisfies Record<string, TranslationKey>;

export function localizeAccountImportWarning(warning: string) {
  const translationKey = (
    ACCOUNT_IMPORT_WARNING_TRANSLATION_KEYS as Record<string, TranslationKey>
  )[warning];

  return translationKey ? t(translationKey) : warning;
}
