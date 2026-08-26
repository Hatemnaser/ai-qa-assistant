import type { TranslationKey } from "../../i18n/messages";
import { t } from "../../i18n/useI18n";

export const PROJECT_IMPORT_WARNING_TRANSLATION_KEYS = {
  "Chat attachment metadata is included, but original attachment files are not included in this archive.":
    "projects.portability.import.warning.attachments",
  "Private object-storage binaries are not included in this legacy version 1 archive. Export again with available private assets to create a version 2 archive.":
    "projects.portability.import.warning.privateAssetsLegacy",
  "Project documents were imported, but one or more documents are still pending or failed indexing. The canonical document content remains available for retry.":
    "projects.portability.import.warning.documentIndexing",
  "Some chat attachment metadata is included without the corresponding original attachment file.":
    "projects.portability.import.warning.partialAttachments",
} as const satisfies Record<string, TranslationKey>;

export function localizeProjectImportWarning(warning: string) {
  const translationKey = (
    PROJECT_IMPORT_WARNING_TRANSLATION_KEYS as Record<string, TranslationKey>
  )[warning];

  return translationKey ? t(translationKey) : warning;
}
