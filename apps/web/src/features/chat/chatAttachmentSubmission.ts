import { uploadPrivateAsset } from "../assets/assetUploader";
import { cancelAssetBestEffort, isPrivateAssetStorageDisabled } from "../assets/assetsApi";
import type { PrivateAssetUploadOptions } from "../assets/assetUploader";
import type { UploadedAsset } from "../assets/types";
import {
  createAttachment,
  createLegacyDisplayAttachments,
  createLegacyRequestAttachments,
} from "./chatAttachments";
import type { ChatAttachment, RequestAttachment, SelectedAttachment } from "./types";

export interface PreparedChatAttachments {
  displayAttachments: ChatAttachment[] | undefined;
  requestAttachments: RequestAttachment[] | null;
}

export interface ChatAttachmentSubmissionDependencies {
  cancel: (assetId: string) => Promise<void>;
  upload: (
    file: File,
    options: PrivateAssetUploadOptions
  ) => Promise<UploadedAsset>;
}

const defaultDependencies: ChatAttachmentSubmissionDependencies = {
  cancel: cancelAssetBestEffort,
  upload: uploadPrivateAsset,
};

export async function prepareChatAttachmentsForSubmit(
  attachments: SelectedAttachment[],
  options: { isAuthenticated: boolean; projectId?: string | null },
  dependencies: ChatAttachmentSubmissionDependencies = defaultDependencies
): Promise<PreparedChatAttachments> {
  if (attachments.length === 0) {
    return { displayAttachments: undefined, requestAttachments: null };
  }

  if (!options.isAuthenticated) {
    const requestAttachments = await createLegacyRequestAttachments(attachments);

    return {
      displayAttachments: createLegacyDisplayAttachments(attachments, requestAttachments),
      requestAttachments,
    };
  }

  const displayAttachments: ChatAttachment[] = [];
  const requestAttachments: RequestAttachment[] = [];
  const uploadedAssetIds: string[] = [];

  try {
    for (const attachment of attachments) {
      const uploaded = await dependencies.upload(attachment.file, {
        declaredMimeType: attachment.mimeType,
        projectId: options.projectId || null,
        purpose: "CHAT_ATTACHMENT",
      });

      uploadedAssetIds.push(uploaded.asset.id);
      requestAttachments.push({ assetId: uploaded.asset.id });
      displayAttachments.push(createAttachment(attachment, { assetId: uploaded.asset.id }));
    }
  } catch (error) {
    await Promise.allSettled(uploadedAssetIds.map(dependencies.cancel));

    if (isPrivateAssetStorageDisabled(error)) {
      const legacyRequests = await createLegacyRequestAttachments(attachments);

      return {
        displayAttachments: createLegacyDisplayAttachments(attachments, legacyRequests),
        requestAttachments: legacyRequests,
      };
    }

    throw error;
  }

  return { displayAttachments, requestAttachments };
}
