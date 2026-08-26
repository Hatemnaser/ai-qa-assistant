import { createHash } from "node:crypto";

import { z } from "zod";

import { AppError } from "../../lib/errors.js";
import { assertSupportedAsset, detectAssetMime } from "../assets/assets.policy.js";
import type { AssetStorage } from "../assets/assets.storage.js";
import type { AssetRecord } from "../assets/assets.types.js";
import { CHAT_ATTACHMENT_LIMITS } from "../chat/chat.attachments.js";

export const BINARY_ASSET_PORTABILITY_LIMITS = Object.freeze({
  maxAssetBytes: 4 * 1024 * 1024,
  maxAssets: 64,
  maxPathChars: 240,
  maxTotalBytes: 8 * 1024 * 1024,
});

export interface BinaryAssetPortabilityLimits {
  maxAssetBytes: number;
  maxAssets: number;
  maxPathChars: number;
  maxTotalBytes: number;
}

export type PortableAssetBinding =
  | {
      kind: "message_attachment";
      ordinal: number;
      sourceMessageId: string;
    }
  | {
      kind: "project_document_source";
      sourceDocumentId: string;
    };

export interface PortableBinaryAssetSource extends AssetRecord {
  binding: PortableAssetBinding;
}

export interface PortableBinaryAssetDescriptor {
  binding: PortableAssetBinding;
  checksumSha256: string;
  file: {
    path: string;
    sha256: string;
    sizeBytes: number;
  };
  mimeType: string;
  originalName: string;
  purpose: AssetRecord["purpose"];
  sizeBytes: number;
  sourceAssetId: string;
  sourceProjectId: string | null;
}

export interface CollectedPortableBinaryAssets {
  assets: PortableBinaryAssetDescriptor[];
  entries: Map<string, Uint8Array>;
  totalBytes: number;
}

export interface ValidatedPortableBinaryAsset
  extends PortableBinaryAssetDescriptor {
  bytes: Uint8Array;
}

const sourceIdSchema = z
  .string()
  .min(1)
  .max(120)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));
const checksumSchema = z.string().regex(/^[A-Za-z0-9+/]{43}=$/);
const bindingSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("message_attachment"),
      ordinal: z
        .number()
        .int()
        .min(0)
        .max(CHAT_ATTACHMENT_LIMITS.maxAttachments - 1),
      sourceMessageId: sourceIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("project_document_source"),
      sourceDocumentId: sourceIdSchema,
    })
    .strict(),
]);
const descriptorSchema = z
  .object({
    binding: bindingSchema,
    checksumSha256: checksumSchema,
    file: z
      .object({
        path: z.string().min(1),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        sizeBytes: z.number().int().positive(),
      })
      .strict(),
    mimeType: z
      .string()
      .min(1)
      .max(120)
      .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value)),
    originalName: z
      .string()
      .min(1)
      .max(180)
      .refine((value) => !/[\u0000-\u001f\u007f/\\]/u.test(value)),
    purpose: z.enum(["CHAT_ATTACHMENT", "PROJECT_DOCUMENT_SOURCE"]),
    sizeBytes: z.number().int().positive(),
    sourceAssetId: sourceIdSchema,
    sourceProjectId: sourceIdSchema.nullable(),
  })
  .strict();

/**
 * Reads owner-scoped READY assets one at a time and produces archive entries.
 * Callers must obtain sources from an owner-scoped repository query; this
 * second owner check is deliberate defense in depth.
 */
export async function collectPortableBinaryAssets(
  ownerId: string,
  sources: PortableBinaryAssetSource[],
  storage: Pick<AssetStorage, "readObject">,
  limits: BinaryAssetPortabilityLimits = BINARY_ASSET_PORTABILITY_LIMITS
): Promise<CollectedPortableBinaryAssets> {
  assertLimits(limits);
  validateSourcesBeforeRead(ownerId, sources, limits);

  const assets: PortableBinaryAssetDescriptor[] = [];
  const entries = new Map<string, Uint8Array>();
  let totalBytes = 0;

  for (const [index, source] of sources.entries()) {
    let stored;
    try {
      stored = await storage.readObject(source.objectKey, limits.maxAssetBytes);
    } catch {
      throwAssetUnavailable();
    }

    const bytes = stored.bytes;
    const hashes = hashBytes(bytes);
    if (
      bytes.byteLength !== source.sizeBytes ||
      stored.metadata.contentLength !== source.sizeBytes ||
      stored.metadata.contentType !== source.declaredMimeType ||
      (stored.metadata.checksumSha256 !== null &&
        stored.metadata.checksumSha256 !== source.checksumSha256) ||
      hashes.base64 !== source.checksumSha256
    ) {
      throwAssetUnavailable();
    }

    totalBytes += bytes.byteLength;
    if (totalBytes > limits.maxTotalBytes) throwAssetsTooLarge();

    const path = createAssetPath(index, source.originalName);
    if (path.length > limits.maxPathChars) throwAssetsTooLarge();

    const descriptor: PortableBinaryAssetDescriptor = {
      binding: source.binding,
      checksumSha256: hashes.base64,
      file: {
        path,
        sha256: hashes.hex,
        sizeBytes: bytes.byteLength,
      },
      mimeType: source.detectedMimeType!,
      originalName: source.originalName,
      purpose: source.purpose,
      sizeBytes: bytes.byteLength,
      sourceAssetId: source.id,
      sourceProjectId: source.projectId,
    };

    assets.push(descriptor);
    entries.set(path, bytes);
  }

  return { assets, entries, totalBytes };
}

/**
 * Validates untrusted binary descriptors after the outer safe-ZIP reader has
 * enforced compressed/uncompressed archive limits. No object-store write or
 * database mutation should happen before this succeeds.
 */
export function validatePortableBinaryAssets(
  value: unknown,
  entries: Record<string, Uint8Array>,
  limits: BinaryAssetPortabilityLimits = BINARY_ASSET_PORTABILITY_LIMITS
): ValidatedPortableBinaryAsset[] {
  assertLimits(limits);
  const result = z.array(descriptorSchema).max(limits.maxAssets).safeParse(value);
  if (!result.success) throwInvalidAssetPackage();

  const ids = new Set<string>();
  const paths = new Set<string>();
  const bindings = new Set<string>();
  let totalBytes = 0;

  return result.data.map((descriptor) => {
    if (
      descriptor.file.path.length > limits.maxPathChars ||
      !/^assets\/[0-9]{3}-[^\u0000-\u001f\u007f<>:"|?*\/\\]+$/u.test(
        descriptor.file.path
      ) ||
      ids.has(descriptor.sourceAssetId) ||
      paths.has(descriptor.file.path) ||
      bindings.has(toBindingKey(descriptor.binding)) ||
      descriptor.sizeBytes !== descriptor.file.sizeBytes ||
      descriptor.sizeBytes > limits.maxAssetBytes ||
      (descriptor.purpose === "PROJECT_DOCUMENT_SOURCE" &&
        !descriptor.sourceProjectId) ||
      !bindingMatchesPurpose(descriptor.binding, descriptor.purpose)
    ) {
      throwInvalidAssetPackage();
    }

    const bytes = entries[descriptor.file.path];
    if (!bytes || bytes.byteLength !== descriptor.sizeBytes) {
      throwInvalidAssetPackage();
    }
    const hashes = hashBytes(bytes);
    if (
      hashes.hex !== descriptor.file.sha256 ||
      hashes.base64 !== descriptor.checksumSha256
    ) {
      throwInvalidAssetPackage();
    }

    try {
      assertSupportedAsset({
        maxImageBytes: limits.maxAssetBytes,
        maxTextBytes: limits.maxAssetBytes,
        mimeType: descriptor.mimeType,
        originalName: descriptor.originalName,
        purpose: descriptor.purpose,
        sizeBytes: descriptor.sizeBytes,
      });
      if (detectAssetMime(bytes, descriptor.mimeType) !== descriptor.mimeType) {
        throw new Error("Portable binary MIME content mismatch.");
      }
    } catch {
      throwInvalidAssetPackage();
    }

    totalBytes += bytes.byteLength;
    if (totalBytes > limits.maxTotalBytes) throwInvalidAssetPackage();
    ids.add(descriptor.sourceAssetId);
    paths.add(descriptor.file.path);
    bindings.add(toBindingKey(descriptor.binding));

    return { ...descriptor, bytes };
  });
}

function validateSourcesBeforeRead(
  ownerId: string,
  sources: PortableBinaryAssetSource[],
  limits: BinaryAssetPortabilityLimits
) {
  if (sources.length > limits.maxAssets) throwAssetsTooLarge();
  const ids = new Set<string>();
  const objectKeys = new Set<string>();
  const bindings = new Set<string>();
  let totalBytes = 0;

  for (const source of sources) {
    const sizeBytes = source.sizeBytes;
    const bindingKey = toBindingKey(source.binding);
    if (
      source.ownerId !== ownerId ||
      source.status !== "READY" ||
      !source.readyAt ||
      !source.detectedMimeType ||
      source.detectedMimeType !== source.declaredMimeType ||
      sizeBytes === null ||
      source.expectedSizeBytes !== sizeBytes ||
      !Number.isSafeInteger(sizeBytes) ||
      sizeBytes < 1 ||
      !checksumSchema.safeParse(source.checksumSha256).success ||
      !sourceIdSchema.safeParse(source.id).success ||
      !bindingSchema.safeParse(source.binding).success ||
      (source.projectId !== null &&
        !sourceIdSchema.safeParse(source.projectId).success) ||
      !source.objectKey ||
      source.objectKey.length > 1_024 ||
      /[\u0000-\u001f\u007f]/u.test(source.objectKey) ||
      source.detectedMimeType.length > 120 ||
      /[\u0000-\u001f\u007f]/u.test(source.detectedMimeType) ||
      source.originalName.length < 1 ||
      source.originalName.length > 180 ||
      /[\u0000-\u001f\u007f/\\]/u.test(source.originalName) ||
      (source.purpose === "PROJECT_DOCUMENT_SOURCE" && !source.projectId) ||
      !bindingMatchesPurpose(source.binding, source.purpose) ||
      ids.has(source.id) ||
      objectKeys.has(source.objectKey) ||
      bindings.has(bindingKey)
    ) {
      throwAssetUnavailable();
    }
    if (sizeBytes > limits.maxAssetBytes) throwAssetsTooLarge();

    totalBytes += sizeBytes;
    if (totalBytes > limits.maxTotalBytes) throwAssetsTooLarge();
    ids.add(source.id);
    objectKeys.add(source.objectKey);
    bindings.add(bindingKey);
  }
}

function createAssetPath(index: number, originalName: string) {
  const safeName = originalName
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/gu, "-")
    .replace(/\s+/gu, "-")
    .replace(/^\.+/u, "")
    .replace(/-+/gu, "-")
    .slice(0, 180);

  return `assets/${String(index + 1).padStart(3, "0")}-${safeName || "asset"}`;
}

function bindingMatchesPurpose(
  binding: PortableAssetBinding,
  purpose: AssetRecord["purpose"]
) {
  return (
    (binding.kind === "message_attachment" && purpose === "CHAT_ATTACHMENT") ||
    (binding.kind === "project_document_source" &&
      purpose === "PROJECT_DOCUMENT_SOURCE")
  );
}

function toBindingKey(binding: PortableAssetBinding) {
  return binding.kind === "message_attachment"
    ? `message:${binding.sourceMessageId}:${binding.ordinal}`
    : `document:${binding.sourceDocumentId}`;
}

function hashBytes(bytes: Uint8Array) {
  const hash = createHash("sha256").update(bytes).digest();
  return {
    base64: hash.toString("base64"),
    hex: hash.toString("hex"),
  };
}

function assertLimits(limits: BinaryAssetPortabilityLimits) {
  if (
    !Number.isSafeInteger(limits.maxAssetBytes) ||
    limits.maxAssetBytes < 1 ||
    !Number.isSafeInteger(limits.maxAssets) ||
    limits.maxAssets < 1 ||
    limits.maxAssets > 999 ||
    !Number.isSafeInteger(limits.maxPathChars) ||
    limits.maxPathChars < 32 ||
    !Number.isSafeInteger(limits.maxTotalBytes) ||
    limits.maxTotalBytes < limits.maxAssetBytes
  ) {
    throw new Error("Binary asset portability limits are invalid.");
  }
}

function throwAssetsTooLarge(): never {
  throw new AppError(
    "Private assets are too large to package safely.",
    413,
    "ASSET_PORTABILITY_TOO_LARGE"
  );
}

function throwAssetUnavailable(): never {
  throw new AppError(
    "Private asset content could not be packaged safely.",
    503,
    "ASSET_PORTABILITY_UNAVAILABLE"
  );
}

function throwInvalidAssetPackage(): never {
  throw new AppError(
    "Portable private asset data is invalid.",
    400,
    "ASSET_PORTABILITY_PACKAGE_INVALID"
  );
}
