import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type {
  R2SmokeGateway,
  R2SmokeGatewayConfig,
} from "./types.js";

export function createR2SmokeGateway(
  config: R2SmokeGatewayConfig
): R2SmokeGateway {
  const client = new S3Client({
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    endpoint: config.endpoint,
    forcePathStyle: true,
    region: config.region,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const bucket = config.bucketName;

  return {
    async createDownloadUrl(objectKey, expiresInSeconds) {
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: bucket,
          ChecksumMode: "ENABLED",
          Key: objectKey,
        }),
        { expiresIn: expiresInSeconds }
      );
    },

    async createUploadUrl(input) {
      const command = new PutObjectCommand({
        Bucket: bucket,
        ChecksumSHA256: input.checksumSha256,
        ContentLength: input.contentLength,
        ContentType: input.contentType,
        IfNoneMatch: "*",
        Key: input.objectKey,
      });
      const url = await getSignedUrl(client, command, {
        expiresIn: input.expiresInSeconds,
        signableHeaders: new Set([
          "content-length",
          "content-type",
          "if-none-match",
          "x-amz-checksum-sha256",
        ]),
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

    async deleteObject(objectKey, signal) {
      await client.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }),
        { abortSignal: signal }
      );
    },

    async getObjectRange(objectKey, start, end, maximumBytes, signal) {
      assertRange(start, end, maximumBytes);
      const response = await client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: objectKey,
          Range: `bytes=${start}-${end}`,
        }),
        { abortSignal: signal }
      );
      const bytes = await readBodyBounded(response.Body, maximumBytes);

      return {
        bytes,
        contentLength: response.ContentLength ?? -1,
        contentRange: response.ContentRange || null,
        contentType: response.ContentType || null,
      };
    },

    async inspectObject(objectKey, signal) {
      try {
        const response = await client.send(
          new HeadObjectCommand({
            Bucket: bucket,
            ChecksumMode: "ENABLED",
            Key: objectKey,
          }),
          { abortSignal: signal }
        );

        return {
          checksumSha256: response.ChecksumSHA256 || null,
          contentLength: response.ContentLength ?? -1,
          contentType: response.ContentType || null,
        };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
  };
}

function assertRange(start: number, end: number, maximumBytes: number) {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    !Number.isSafeInteger(maximumBytes) ||
    start < 0 ||
    end < start ||
    maximumBytes < 1 ||
    end - start + 1 > maximumBytes
  ) {
    throw new Error("Invalid bounded R2 smoke range.");
  }
}

async function readBodyBounded(body: unknown, maximumBytes: number) {
  if (
    !body ||
    typeof body !== "object" ||
    !(Symbol.asyncIterator in body) ||
    typeof body[Symbol.asyncIterator] !== "function"
  ) {
    destroyBody(body);
    throw new Error("R2 smoke response body is not a stream.");
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for await (const chunk of body as AsyncIterable<unknown>) {
      if (!(chunk instanceof Uint8Array)) {
        throw new Error("R2 smoke response contains an invalid chunk.");
      }
      totalBytes += chunk.byteLength;
      if (totalBytes > maximumBytes) {
        throw new Error("R2 smoke response exceeded its byte limit.");
      }
      chunks.push(chunk);
    }
  } catch (error) {
    destroyBody(body);
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

function destroyBody(body: unknown) {
  if (!body || typeof body !== "object" || !("destroy" in body)) return;
  const destroy = (body as { destroy?: () => void }).destroy;
  if (typeof destroy === "function") destroy.call(body);
}

function isNotFound(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    $metadata?: { httpStatusCode?: number };
    name?: string;
  };

  return (
    candidate.$metadata?.httpStatusCode === 404 ||
    candidate.name === "NoSuchKey" ||
    candidate.name === "NotFound"
  );
}
