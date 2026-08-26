import { AppError } from "../../lib/errors.js";
import type {
  PortableAssetBinding,
  PortableBinaryAssetSource,
} from "./binary-assets.js";

interface ExportDocumentAssetPointer {
  id: string;
  sourceAssetId: string | null;
}

interface ExportMessageAssetPointer {
  id: string;
  attachments: Array<{
    assetId: string;
    ordinal: number;
  }>;
}

type ExportAssetRelationRow = Omit<
  PortableBinaryAssetSource,
  "binding"
> & {
  messageAttachment: {
    messageId: string;
    ordinal: number;
  } | null;
  sourceDocument: {
    id: string;
  } | null;
};

/**
 * Proves that every canonical relation pointer has exactly one owner-scoped
 * asset row, and that every selected asset row points back to that same
 * canonical relation. This prevents an incomplete legacy export when a
 * relation references a missing, foreign, or otherwise unselected asset.
 */
export function bindCompleteExportAssetRows(
  ownerId: string,
  assetRows: ExportAssetRelationRow[],
  documents: ExportDocumentAssetPointer[],
  messages: ExportMessageAssetPointer[]
): PortableBinaryAssetSource[] {
  const expectedBindings = collectExpectedBindings(documents, messages);

  if (assetRows.length !== expectedBindings.size) {
    throwAssetPortabilityUnavailable();
  }

  const seenAssetIds = new Set<string>();
  return assetRows.map((row) => {
    const { messageAttachment, sourceDocument, ...asset } = row;
    const actualBinding = relationBinding(messageAttachment, sourceDocument);
    const expectedBinding = expectedBindings.get(asset.id);

    if (
      asset.ownerId !== ownerId ||
      seenAssetIds.has(asset.id) ||
      !expectedBinding ||
      !bindingsEqual(actualBinding, expectedBinding)
    ) {
      throwAssetPortabilityUnavailable();
    }

    seenAssetIds.add(asset.id);
    return { ...asset, binding: actualBinding };
  });
}

function collectExpectedBindings(
  documents: ExportDocumentAssetPointer[],
  messages: ExportMessageAssetPointer[]
) {
  const bindingsByAssetId = new Map<string, PortableAssetBinding>();
  const bindingKeys = new Set<string>();

  for (const document of documents) {
    if (!document.sourceAssetId) continue;

    addExpectedBinding(
      bindingsByAssetId,
      bindingKeys,
      document.sourceAssetId,
      {
        kind: "project_document_source",
        sourceDocumentId: document.id,
      }
    );
  }

  for (const message of messages) {
    for (const attachment of message.attachments) {
      addExpectedBinding(
        bindingsByAssetId,
        bindingKeys,
        attachment.assetId,
        {
          kind: "message_attachment",
          ordinal: attachment.ordinal,
          sourceMessageId: message.id,
        }
      );
    }
  }

  return bindingsByAssetId;
}

function addExpectedBinding(
  bindingsByAssetId: Map<string, PortableAssetBinding>,
  bindingKeys: Set<string>,
  assetId: string,
  binding: PortableAssetBinding
) {
  const bindingKey = toBindingKey(binding);
  if (
    !assetId ||
    bindingsByAssetId.has(assetId) ||
    bindingKeys.has(bindingKey)
  ) {
    throwAssetPortabilityUnavailable();
  }

  bindingsByAssetId.set(assetId, binding);
  bindingKeys.add(bindingKey);
}

function relationBinding(
  messageAttachment: ExportAssetRelationRow["messageAttachment"],
  sourceDocument: ExportAssetRelationRow["sourceDocument"]
): PortableAssetBinding {
  if (messageAttachment && !sourceDocument) {
    return {
      kind: "message_attachment",
      ordinal: messageAttachment.ordinal,
      sourceMessageId: messageAttachment.messageId,
    };
  }
  if (sourceDocument && !messageAttachment) {
    return {
      kind: "project_document_source",
      sourceDocumentId: sourceDocument.id,
    };
  }

  throwAssetPortabilityUnavailable();
}

function bindingsEqual(
  actual: PortableAssetBinding,
  expected: PortableAssetBinding
) {
  return actual.kind === "message_attachment"
    ? expected.kind === "message_attachment" &&
        actual.sourceMessageId === expected.sourceMessageId &&
        actual.ordinal === expected.ordinal
    : expected.kind === "project_document_source" &&
        actual.sourceDocumentId === expected.sourceDocumentId;
}

function toBindingKey(binding: PortableAssetBinding) {
  return binding.kind === "message_attachment"
    ? `message:${binding.sourceMessageId}:${binding.ordinal}`
    : `document:${binding.sourceDocumentId}`;
}

function throwAssetPortabilityUnavailable(): never {
  throw new AppError(
    "Private asset content could not be packaged safely.",
    503,
    "ASSET_PORTABILITY_UNAVAILABLE"
  );
}
