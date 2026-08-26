import type {
  ProjectDocumentAssetImportFileInput,
  ProjectDocumentImportFileInput,
  ProjectDocumentInlineImportFileInput,
} from "./types";
import { uploadPrivateAsset } from "../assets/assetUploader";
import { cancelAssetBestEffort, isPrivateAssetStorageDisabled } from "../assets/assetsApi";
import type { PrivateAssetUploadOptions } from "../assets/assetUploader";
import type { UploadedAsset } from "../assets/types";
import { t } from "../../i18n/useI18n";
import {
  getProjectDocumentFileExtension,
  getProjectDocumentTypeByFileName,
  PROJECT_DOCUMENT_SUPPORTED_EXTENSIONS,
} from "./projectDocumentTypes";

export const PROJECT_DOCUMENT_FILE_POLICY = Object.freeze({
  maxFiles: 4,
  maxFileBytes: 250_000,
  supportedExtensions: PROJECT_DOCUMENT_SUPPORTED_EXTENSIONS,
});

export const PROJECT_DOCUMENT_FILE_ACCEPT = PROJECT_DOCUMENT_FILE_POLICY.supportedExtensions
  .map((extension) => `.${extension}`)
  .join(",");

const supportedExtensions = new Set<string>(PROJECT_DOCUMENT_FILE_POLICY.supportedExtensions);

export async function prepareProjectDocumentFiles(files: File[]): Promise<ProjectDocumentInlineImportFileInput[]> {
  assertProjectDocumentFiles(files);

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

export async function uploadProjectDocumentFiles(
  projectId: string,
  files: File[],
  upload: (file: File, options: PrivateAssetUploadOptions) => Promise<UploadedAsset> = uploadPrivateAsset
): Promise<ProjectDocumentImportFileInput[]> {
  assertProjectDocumentFiles(files);
  const uploadedFiles: ProjectDocumentAssetImportFileInput[] = [];

  try {
    for (const file of files) {
      await assertProjectDocumentFileHasContent(file);
      const asset = await upload(file, {
        declaredMimeType: getProjectDocumentMimeType(file),
        projectId,
        purpose: "PROJECT_DOCUMENT_SOURCE",
      });
      uploadedFiles.push({ sourceAssetId: asset.asset.id });
    }
  } catch (error) {
    await cancelProjectDocumentFileUploads(uploadedFiles);

    if (isPrivateAssetStorageDisabled(error)) {
      return prepareProjectDocumentFiles(files);
    }

    throw error;
  }

  return uploadedFiles;
}

export async function cancelProjectDocumentFileUploads(files: ProjectDocumentImportFileInput[]) {
  await Promise.all(
    files.map((file) => "sourceAssetId" in file ? cancelAssetBestEffort(file.sourceAssetId) : Promise.resolve())
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

function assertProjectDocumentFiles(files: File[]) {
  if (files.length > PROJECT_DOCUMENT_FILE_POLICY.maxFiles) {
    throw new Error(t("projects.documents.file.tooMany", { count: PROJECT_DOCUMENT_FILE_POLICY.maxFiles }));
  }
}

async function assertProjectDocumentFileHasContent(file: File) {
  const error = getProjectDocumentFileError(file);

  if (error) {
    throw new Error(error);
  }

  if (!(await file.text()).trim()) {
    throw new Error(t("projects.documents.file.empty", { file: file.name }));
  }
}
