/** Historical message metadata is independent from the next draft's model. */
export function recordedMessageMetadata(message: { model: string | null; metadata: unknown }) {
  const metadata = isRecord(message.metadata) ? message.metadata : undefined;
  // Older external imports stored the draft model in the row, and retained
  // the original (possibly unknown) model in their import metadata.
  const imported = metadata?.imported;
  // Native account archives use this envelope too, but keep the recorded
  // model in the row. Only explicit original-model provenance overrides it.
  const model = isRecord(imported) && Object.hasOwn(imported, "originalModel")
    ? imported.originalModel : message.model;
  return {
    model: typeof model === "string" ? model.trim() : "",
    ...(metadata?.isError ? { isError: true } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
