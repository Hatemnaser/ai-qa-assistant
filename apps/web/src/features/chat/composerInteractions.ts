export function shouldSubmitComposerKey(event: Pick<KeyboardEvent, "key" | "shiftKey" | "ctrlKey" | "altKey" | "metaKey" | "isComposing" | "keyCode">) {
  return event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.altKey
    && !event.metaKey && !event.isComposing && event.keyCode !== 229;
}

export function pastedFiles(data: Pick<DataTransfer, "files" | "items"> | null) {
  const files = Array.from(data?.files || []);
  return files.length ? files : Array.from(data?.items || [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
}
