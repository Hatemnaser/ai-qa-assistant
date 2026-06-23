import type { ProjectDocumentImportFileInput } from "./types";
import { t } from "../../i18n/useI18n";
import {
  getProjectDocumentFileExtension,
  getProjectDocumentTypeByFileName,
  PROJECT_DOCUMENT_SUPPORTED_EXTENSIONS,
} from "./projectDocumentTypes";

export const PROJECT_DOCUMENT_FILE_POLICY = Object.freeze({
  maxFiles: 4,
  maxFileBytes: 1_000_000,
  supportedExtensions: PROJECT_DOCUMENT_SUPPORTED_EXTENSIONS,
});

export const PROJECT_DOCUMENT_FILE_ACCEPT = PROJECT_DOCUMENT_FILE_POLICY.supportedExtensions
  .map((extension) => `.${extension}`)
  .join(",");

const supportedExtensions = new Set<string>(PROJECT_DOCUMENT_FILE_POLICY.supportedExtensions);

export async function prepareProjectDocumentFiles(files: File[]): Promise<ProjectDocumentImportFileInput[]> {
  if (files.length === 0) return [];

  if (files.length > PROJECT_DOCUMENT_FILE_POLICY.maxFiles) {
    throw new Error(t("projects.documents.file.tooMany", { count: PROJECT_DOCUMENT_FILE_POLICY.maxFiles }));
  }

  return Promise.all(
    files.map(async (file) => {
      const error = getProjectDocumentFileError(file);

      if (error) {
        throw new Error(error);
      }

      const content = await file.text();

      if (!content.trim()) {
        throw new Error(t("projects.documents.file.empty", { file: file.name }));
      }

      return {
        name: file.name,
        content,
        mimeType: getProjectDocumentMimeType(file),
        sizeBytes: file.size,
      };
    })
  );
}

export function getProjectDocumentFileError(file: File) {
  const extension = getProjectDocumentFileExtension(file.name);

  if (!supportedExtensions.has(extension)) {
    return t("projects.documents.file.unsupported", {
      file: file.name,
      types: t("projects.documents.supportedTypes"),
    });
  }

  if (file.size > PROJECT_DOCUMENT_FILE_POLICY.maxFileBytes) {
    return t("projects.documents.file.tooLarge", { file: file.name });
  }

  return "";
}

function getProjectDocumentMimeType(file: File) {
  return getProjectDocumentTypeByFileName(file.name).mimeType;
}
