import { getCurrentScope, onScopeDispose, ref } from "vue";
import type { Ref } from "vue";

import { getAssetDownloadUrl } from "../../assets/assetsApi";
import { useI18n } from "../../../i18n/useI18n";
import {
  fileToSelectedAttachment,
  formatAttachmentByteLimit,
  getAttachmentFileError,
  MAX_SELECTED_ATTACHMENTS,
  releaseSelectedAttachment,
} from "../chatAttachments";
import type { AttachmentFileError } from "../chatAttachments";
import type { ChatAttachment, SelectedAttachment } from "../types";
import type { useChatDrafts } from "./useChatDrafts";

interface ChatAttachmentOptions {
  selectedAttachments?: Ref<SelectedAttachment[]>;
  drafts?: Pick<ReturnType<typeof useChatDrafts>, "capture" | "appendAttachments">;
  getIdentity?: () => string | null;
}

export interface ChatAttachmentDependencies {
  prepare: typeof fileToSelectedAttachment;
}

export function useChatAttachments(
  options: ChatAttachmentOptions = {},
  dependencies: ChatAttachmentDependencies = { prepare: fileToSelectedAttachment }
) {
  const selectedAttachments = options.selectedAttachments || ref<SelectedAttachment[]>([]);
  const { t } = useI18n();

  function clearSelectedAttachments() {
    selectedAttachments.value.forEach(releaseSelectedAttachment);
    selectedAttachments.value = [];
  }

  async function handleAttachmentsSelected(files: File[] | FileList | undefined) {
    const selectedFiles = Array.from(files || []);

    if (selectedFiles.length === 0) return;

    if (selectedAttachments.value.length + selectedFiles.length > MAX_SELECTED_ATTACHMENTS) {
      alert(t("chat.attachments.limit", { count: MAX_SELECTED_ATTACHMENTS }));
      return;
    }

    const fileError = selectedFiles.map(getAttachmentFileError).find(Boolean);

    if (fileError) {
      alert(getAttachmentFileErrorMessage(fileError));
      return;
    }

    const ticket = options.drafts?.capture();
    const identity = options.getIdentity?.();
    const prepared = await Promise.allSettled(selectedFiles.map(dependencies.prepare));
    const nextAttachments = prepared.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);

    if (identity !== options.getIdentity?.() || prepared.some((result) => result.status === "rejected")) {
      nextAttachments.forEach(releaseSelectedAttachment);
      return;
    }

    const result = ticket && options.drafts
      ? options.drafts.appendAttachments(ticket, nextAttachments)
      : selectedAttachments.value.length + nextAttachments.length > MAX_SELECTED_ATTACHMENTS ? "full" : "added";

    if (result !== "added") {
      nextAttachments.forEach(releaseSelectedAttachment);
      if (result === "full") alert(t("chat.attachments.limit", { count: MAX_SELECTED_ATTACHMENTS }));
      return;
    }

    if (!ticket) selectedAttachments.value = [...selectedAttachments.value, ...nextAttachments];
  }

  async function openAttachment(attachment: ChatAttachment) {
    if (attachment.assetId) {
      try {
        const url = await getAssetDownloadUrl(attachment.assetId);
        window.open(url, "_blank", "noopener,noreferrer");
      } catch {
        alert(t("chat.attachments.openFailed"));
      }
      return;
    }

    if (attachment.previewUrl) {
      window.open(attachment.previewUrl, "_blank", "noopener,noreferrer");
    }
  }

  function openSelectedAttachment(index: number) {
    const attachment = selectedAttachments.value[index];

    if (attachment?.previewUrl) {
      window.open(attachment.previewUrl, "_blank", "noopener,noreferrer");
    }
  }

  function removeSelectedAttachment(index: number) {
    releaseSelectedAttachment(selectedAttachments.value[index]);
    selectedAttachments.value = selectedAttachments.value.filter((_, itemIndex) => itemIndex !== index);
  }

  if (!options.drafts && getCurrentScope()) onScopeDispose(clearSelectedAttachments);

  function getAttachmentOnlyMessage(attachments: SelectedAttachment[]) {
    if (attachments.length === 0) return "";
    if (attachments.length > 1) return t("chat.attachments.uploadedMany", { count: attachments.length });

    const attachment = attachments[0];
    if (!attachment) return "";

    return attachment.type === "image"
      ? t("chat.attachments.uploadedImage")
      : t("chat.attachments.uploadedFile");
  }

  function getAttachmentFileErrorMessage(error: AttachmentFileError) {
    if (error.code === "IMAGE_TOO_LARGE") {
      return t("chat.attachments.imageTooLarge", {
        size: formatAttachmentByteLimit(error.maxBytes),
      });
    }

    if (error.code === "TEXT_FILE_TOO_LARGE") {
      return t("chat.attachments.fileTooLarge", {
        size: formatAttachmentByteLimit(error.maxBytes),
      });
    }

    if (error.code === "FUTURE_FILE_TYPE") {
      return t("chat.attachments.futureType");
    }

    return t("chat.attachments.unsupportedType");
  }

  return {
    clearSelectedAttachments,
    getAttachmentOnlyMessage,
    handleAttachmentsSelected,
    openAttachment,
    openSelectedAttachment,
    removeSelectedAttachment,
    selectedAttachments,
  };
}
