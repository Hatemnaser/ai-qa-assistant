import { createHash, timingSafeEqual } from "node:crypto";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { env, type AppEnv } from "../../config/env.js";
import type {
  ImmutableStoredObjectInput,
  PresignedUploadRequest,
  StoredObjectMetadata,
  StoredObjectSample,
} from "./assets.types.js";

const IMMUTABLE_WRITE_TIMEOUT_MS = 2 * 60 * 1_000;
const OBJECT_DELETE_TIMEOUT_MS = 2 * 60 * 1_000;

export interface AssetStorage {
  createDownloadUrl(objectKey: string, expiresInSeconds: number): Promise<string>;
  createUploadUrl(input: PresignedUploadRequest): Promise<{ headers: Record<string, string>; url: string }>;
  deleteObject(objectKey: string): Promise<void>;
  inspectObject(objectKey: string): Promise<StoredObjectMetadata>;
  readObject(objectKey: string, maximumBytes: number): Promise<StoredObjectSample>;
  readObjectSample(objectKey: string, maximumBytes: number): Promise<StoredObjectSample>;
  writeObject(input: ImmutableStoredObjectInput): Promise<StoredObjectMetadata>;
}

export function createR2AssetStorage(config: Pick<
  AppEnv,
  "r2AccessKeyId" | "r2BucketName" | "r2Endpoint" | "r2Region" | "r2SecretAccessKey"
>): AssetStorage {
  const client = new S3Client({
    credentials: {
      accessKeyId: config.r2AccessKeyId,
      secretAccessKey: config.r2SecretAccessKey,
    },
    endpoint: config.r2Endpoint,
    forcePathStyle: true,
    region: config.r2Region,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const bucket = config.r2BucketName;

  return {
    async createUploadUrl(input) {
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: input.objectKey,
        ChecksumSHA256: input.checksumSha256,
        ContentLength: input.contentLength,
        ContentType: input.contentType,
        IfNoneMatch: "*",
      });
      const url = await getSignedUrl(client, command, {
        expiresIn: input.expiresInSeconds,
        signableHeaders: new Set(["content-length", "content-type", "if-none-match", "x-amz-checksum-sha256"]),
        unhoistableHeaders: new Set(["x-amz-checksum-sha256"]),
      });

      return {
        headers: {
          "content-length": String(input.contentLength),
          "content-type": input.contentType,
          "if-none-match": "*",
          "x-amz-checksum-sha256": input.checksumSha256,
        },
        url,
      };
    },

    async createDownloadUrl(objectKey, expiresInSeconds) {
      return getSignedUrl(
        client,
        new GetObjectCommand({ Bucket: bucket, Key: objectKey }),
        { expiresIn: expiresInSeconds }
      );
    },

    async deleteObject(objectKey) {
      await client.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }),
        { abortSignal: AbortSignal.timeout(OBJECT_DELETE_TIMEOUT_MS) }
      );
    },

    async inspectObject(objectKey) {
      const response = await client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: objectKey, ChecksumMode: "ENABLED" })
      );

      return toStoredObjectMetadata(response);
    },

    async readObject(objectKey, maximumBytes) {
      assertPositiveByteLimit(maximumBytes);
      const metadata = await this.inspectObject(objectKey);
      if (
        metadata.contentLength < 0 ||
        metadata.contentLength > maximumBytes
      ) {
        throw new Error("Stored object exceeds the permitted read size.");
      }

      // Request one byte beyond the limit. Together with the immutable object
      // key policy, the HEAD/GET length comparison keeps this adapter bounded
      // and detects an unexpected replacement between requests.
      const response = await client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: objectKey,
          Range: `bytes=0-${maximumBytes}`,
        })
      );
      if (
        response.ContentLength !== undefined &&
        response.ContentLength > maximumBytes
      ) {
        destroyStreamingBody(response.Body);
        throw new Error("Stored object exceeds the permitted read size.");
      }
      const bytes = await readStreamingBodyBounded(response.Body, maximumBytes);
      if (
        bytes.byteLength > maximumBytes ||
        bytes.byteLength !== metadata.contentLength
      ) {
        throw new Error("Stored object changed during the bounded read.");
      }

      return { bytes, metadata };
    },

    async readObjectSample(objectKey, maximumBytes) {
      assertPositiveByteLimit(maximumBytes);
      const response = await client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: objectKey,
          Range: `bytes=0-${Math.max(0, maximumBytes - 1)}`,
        })
      );
      if (
        response.ContentLength !== undefined &&
        response.ContentLength > maximumBytes
      ) {
        destroyStreamingBody(response.Body);
        throw new Error("Stored object exceeds the permitted read size.");
      }
      const bytes = await readStreamingBodyBounded(response.Body, maximumBytes);

      return {
        bytes,
        metadata: {
          checksumSha256: response.ChecksumSHA256 || null,
          contentLength: response.ContentLength ?? bytes.byteLength,
          contentType: response.ContentType || null,
          etag: normalizeEtag(response.ETag),
        },
      };
    },

    async writeObject(input) {
      assertImmutableWrite(input);
      const abortSignal = AbortSignal.timeout(IMMUTABLE_WRITE_TIMEOUT_MS);
      await client.send(
        new PutObjectCommand({
          Body: input.bytes,
          Bucket: bucket,
          ChecksumSHA256: input.checksumSha256,
          ContentLength: input.bytes.byteLength,
          ContentType: input.contentType,
          IfNoneMatch: "*",
          Key: input.objectKey,
        }),
        { abortSignal }
      );

      const head = await client.send(
        new HeadObjectCommand({
          Bucket: bucket,
          ChecksumMode: "ENABLED",
          Key: input.objectKey,
        }),
        { abortSignal }
      );
      const metadata = toStoredObjectMetadata(head);
      if (
        metadata.checksumSha256 !== input.checksumSha256 ||
        metadata.contentLength !== input.bytes.byteLength ||
        metadata.contentType !== input.contentType
      ) {
        try {
          await this.deleteObject(input.objectKey);
        } catch {
          // The restore staging protocol creates a durable deletion job before
          // this method is called. Preserve the original integrity failure if
          // immediate best-effort cleanup also fails.
        }
        throw new Error("Stored object did not match the immutable write request.");
      }

      return metadata;
    },
  };
}

export function createDisabledAssetStorage(): AssetStorage {
  const fail = (): never => {
    throw new Error("Private asset storage is disabled.");
  };

  return {
    createDownloadUrl: async () => fail(),
    createUploadUrl: async () => fail(),
    deleteObject: async () => fail(),
    inspectObject: async () => fail(),
    readObject: async () => fail(),
    readObjectSample: async () => fail(),
    writeObject: async () => fail(),
  };
}

// Route availability and deletion capability are intentionally separate. An
// operator may disable new uploads while the outbox still must erase existing
// private objects.
export const assetStorage = isAssetStorageConfigured(env)
  ? createR2AssetStorage(env)
  : createDisabledAssetStorage();

export function isAssetStorageConfigured(config: Pick<
  AppEnv,
  "r2AccessKeyId" | "r2BucketName" | "r2Endpoint" | "r2SecretAccessKey"
>) {
  return Boolean(
    config.r2AccessKeyId &&
    config.r2BucketName &&
    config.r2Endpoint &&
    config.r2SecretAccessKey
  );
}

function normalizeEtag(etag: string | undefined) {
  return etag?.replace(/^"|"$/g, "") || null;
}

function toStoredObjectMetadata(response: {
  ChecksumSHA256?: string;
  ContentLength?: number;
  ContentType?: string;
  ETag?: string;
}): StoredObjectMetadata {
  return {
    checksumSha256: response.ChecksumSHA256 || null,
    contentLength: response.ContentLength ?? -1,
    contentType: response.ContentType || null,
    etag: normalizeEtag(response.ETag),
  };
}

async function readStreamingBodyBounded(body: unknown, maximumBytes: number) {
  if (!body) return new Uint8Array();
  if (
    typeof body !== "object" ||
    !(Symbol.asyncIterator in body) ||
    typeof body[Symbol.asyncIterator] !== "function"
  ) {
    destroyStreamingBody(body);
    throw new Error("Stored object body is not a bounded stream.");
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for await (const value of body as AsyncIterable<unknown>) {
      if (!(value instanceof Uint8Array)) {
        throw new Error("Stored object stream returned an invalid chunk.");
      }
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        throw new Error("Stored object exceeds the permitted read size.");
      }
      chunks.push(value);
    }
  } catch (error) {
    destroyStreamingBody(body);
    throw error;
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function destroyStreamingBody(body: unknown) {
  if (!body || typeof body !== "object" || !("destroy" in body)) return;
  const destroy = (body as { destroy?: () => void }).destroy;
  if (typeof destroy === "function") destroy.call(body);
}

function assertPositiveByteLimit(maximumBytes: number) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new Error("Stored object read limit must be a positive safe integer.");
  }
}

function assertImmutableWrite(input: ImmutableStoredObjectInput) {
  if (
    !Number.isSafeInteger(input.maximumBytes) ||
    input.maximumBytes < 1 ||
    input.bytes.byteLength < 1 ||
    input.bytes.byteLength > input.maximumBytes ||
    !input.objectKey ||
    input.objectKey.length > 1_024 ||
    /[\u0000-\u001f\u007f]/u.test(input.objectKey) ||
    !input.contentType ||
    input.contentType.length > 120 ||
    /[\u0000-\u001f\u007f]/u.test(input.contentType) ||
    !/^[A-Za-z0-9+/]{43}=$/.test(input.checksumSha256)
  ) {
    throw new Error("Immutable stored object input is invalid.");
  }

  const actualChecksum = createHash("sha256").update(input.bytes).digest();
  const expectedChecksum = Buffer.from(input.checksumSha256, "base64");
  if (
    expectedChecksum.byteLength !== actualChecksum.byteLength ||
    !timingSafeEqual(expectedChecksum, actualChecksum)
  ) {
    throw new Error("Immutable stored object checksum does not match its bytes.");
  }
}
