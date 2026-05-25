import { ref } from "vue";

import {
  fileToSelectedAttachment,
  getAttachmentFileError,
  MAX_SELECTED_ATTACHMENTS,
} from "../chatAttachments";
import type { ChatAttachment, SelectedAttachment } from "../types";

export function useChatAttachments() {
  const selectedAttachments = ref<SelectedAttachment[]>([]);

  function clearSelectedAttachments() {
    selectedAttachments.value = [];
  }

  async function handleAttachmentsSelected(files: File[] | FileList | undefined) {
    const selectedFiles = Array.from(files || []);

    if (selectedFiles.length === 0) return;

    if (selectedAttachments.value.length + selectedFiles.length > MAX_SELECTED_ATTACHMENTS) {
      alert(`You can attach up to ${MAX_SELECTED_ATTACHMENTS} files per message.`);
      return;
    }

    const fileError = selectedFiles.map(getAttachmentFileError).find(Boolean);

    if (fileError) {
      alert(fileError);
      return;
    }

    const nextAttachments = await Promise.all(selectedFiles.map(fileToSelectedAttachment));

    selectedAttachments.value = [...selectedAttachments.value, ...nextAttachments];
  }

  function openAttachment(attachment: ChatAttachment) {
    if (attachment.previewUrl) {
      window.open(attachment.previewUrl, "_blank");
    }
  }

  function openSelectedAttachment(index: number) {
    const attachment = selectedAttachments.value[index];

    if (attachment?.previewUrl) {
      window.open(attachment.previewUrl, "_blank");
    }
  }

  function removeSelectedAttachment(index: number) {
    selectedAttachments.value = selectedAttachments.value.filter((_, itemIndex) => itemIndex !== index);
  }

  function getAttachmentOnlyMessage(attachments: SelectedAttachment[]) {
    if (attachments.length === 0) return "";
    if (attachments.length > 1) return `Uploaded ${attachments.length} attachments.`;

    const attachment = attachments[0];
    if (!attachment) return "";

    return attachment.type === "image" ? "Uploaded an image." : "Uploaded an attachment.";
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
