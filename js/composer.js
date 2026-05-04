export function initComposer({ form, modeSelect }) {
  const messageInput = document.querySelector("#message");
  const composer = document.querySelector("#composer");
  const screenshotInput = document.querySelector("#screenshot-input");
  const attachmentPreview = document.querySelector("#attachment-preview");

  let selectedImage = null;

  function getInputValue() {
    return messageInput.value.trim();
  }

  function setInputValue(value) {
    messageInput.value = value;
  }

  function clearInput() {
    messageInput.value = "";
  }

  function autoResizeTextarea() {
    messageInput.style.height = "auto";
    messageInput.style.height = `${messageInput.scrollHeight}px`;
  }

  function hasSelectedImage() {
    return Boolean(selectedImage);
  }

  function getRequestImage() {
    return selectedImage
      ? {
          mimeType: selectedImage.mimeType,
          data: selectedImage.data,
        }
      : null;
  }

  function getDisplayAttachment() {
    return selectedImage
      ? {
          type: "image",
          name: selectedImage.name,
          mimeType: selectedImage.mimeType,
          previewUrl: selectedImage.previewUrl,
        }
      : null;
  }

  function clearSelectedImage() {
    selectedImage = null;
    screenshotInput.value = "";
    renderAttachmentPreview();
  }

  messageInput.addEventListener("input", autoResizeTextarea);

  messageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  screenshotInput.addEventListener("change", async () => {
    const file = screenshotInput.files[0];
    await handleImageFile(file);
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    composer.addEventListener(eventName, (event) => {
      event.preventDefault();
      composer.classList.add("drag-over");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    composer.addEventListener(eventName, (event) => {
      event.preventDefault();
      composer.classList.remove("drag-over");
    });
  });

  composer.addEventListener("drop", async (event) => {
    const file = event.dataTransfer.files[0];
    await handleImageFile(file);
  });

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => {
        const result = reader.result;
        const base64Data = result.split(",")[1];

        resolve({
          name: file.name,
          mimeType: file.type,
          data: base64Data,
          previewUrl: result,
        });
      };

      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function renderAttachmentPreview() {
    attachmentPreview.innerHTML = "";

    if (!selectedImage) {
      attachmentPreview.classList.add("d-none");
      return;
    }

    attachmentPreview.classList.remove("d-none");

    const card = document.createElement("div");
    card.className = "attachment-preview-card";

    const image = document.createElement("img");
    image.src = selectedImage.previewUrl;
    image.alt = selectedImage.name;

    const info = document.createElement("div");
    info.className = "attachment-preview-info";

    const name = document.createElement("div");
    name.className = "attachment-preview-name";
    name.textContent = selectedImage.name;

    const type = document.createElement("div");
    type.className = "attachment-preview-type";
    type.textContent = "Image";

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "attachment-remove-btn";
    removeButton.textContent = "×";
    removeButton.setAttribute("aria-label", "Remove attachment");
    removeButton.addEventListener("click", clearSelectedImage);

    info.appendChild(name);
    info.appendChild(type);

    card.appendChild(image);
    card.appendChild(info);
    card.appendChild(removeButton);

    card.addEventListener("click", (event) => {
      if (event.target === removeButton) return;
      window.open(selectedImage.previewUrl, "_blank");
    });

    attachmentPreview.appendChild(card);
  }

  async function handleImageFile(file) {
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      alert("Please upload an image file.");
      return;
    }

    const maxSizeInMB = 4;
    const maxSizeInBytes = maxSizeInMB * 1024 * 1024;

    if (file.size > maxSizeInBytes) {
      alert(`Image is too large. Please upload an image smaller than ${maxSizeInMB}MB.`);
      return;
    }

    selectedImage = await fileToBase64(file);
    modeSelect.value = "screenshot_review";
    renderAttachmentPreview();
  }

  return {
    messageInput,
    getInputValue,
    setInputValue,
    clearInput,
    autoResizeTextarea,
    hasSelectedImage,
    getRequestImage,
    getDisplayAttachment,
    clearSelectedImage,
  };
}
