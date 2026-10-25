import { createHash } from "node:crypto";
import { Resolver } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { AppError } from "../../lib/errors.js";

export interface TargetProofProbe {
  dns(hostname: string): Promise<string[]>;
  https(url: string): Promise<string>;
}
export function challengeHash(value: string) { return createHash("sha256").update(value).digest("hex"); }

// Conservative public-address admission for the ownership probe. Browser egress
// enforcement is an independent runtime requirement, not implemented here.
export function isPublicProofAddress(address: string) {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return a! > 0 && a! < 224 && a !== 10 && a !== 127
      && !(a === 100 && b! >= 64 && b! <= 127)
      && !(a === 169 && b === 254) && !(a === 172 && b! >= 16 && b! <= 31)
      && !(a === 192 && (b === 168 || b === 0))
      && !(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      && !(a === 203 && b === 0 && c === 113);
  }
  if (isIP(address) === 6) {
    const prefix = Number.parseInt(address.split(":")[0] || "0", 16);
    return prefix >= 0x2000 && prefix <= 0x3fff && prefix !== 0x2001 && prefix !== 0x2002;
  }
  return false;
}

export function selectProofAddress(addresses: string[]) {
  if (!addresses.length || addresses.some((address) => !isPublicProofAddress(address))) throw new AppError("Target must resolve only to supported public addresses.", 400, "QA_TARGET_ADDRESS_BLOCKED");
  return { address: addresses[0]!, family: isIP(addresses[0]!) };
}

export const targetProofProbe: TargetProofProbe = {
  async dns(hostname) {
    const resolver = new Resolver({ timeout: 3_000, tries: 1 });
    const records = await resolver.resolveTxt(`_oddpath-verify.${hostname}`);
    return records.map((chunks) => chunks.join(""));
  },
  async https(rawUrl) {
    const url = new URL(rawUrl);
    const resolver = new Resolver({ timeout: 3_000, tries: 1 });
    const resolved = await Promise.allSettled([resolver.resolve4(url.hostname), resolver.resolve6(url.hostname)]);
    const addresses = resolved.flatMap((result) => result.status === "fulfilled" ? result.value : []);
    const selected = selectProofAddress(addresses);
    return new Promise<string>((resolve, reject) => {
      const req = request(url, {
        agent: false,
        method: "GET",
        signal: AbortSignal.timeout(5_000),
        lookup: (_hostname, options, callback) => {
          if (options.all) callback(null, [selected]);
          else callback(null, selected.address, selected.family);
        },
      }, (response) => {
        if (response.statusCode !== 200) { response.destroy(); reject(new Error("Ownership file unavailable; redirects are not followed.")); return; }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 4_096) { response.destroy(); reject(new Error("Ownership file exceeds limit.")); }
          else chunks.push(chunk);
        });
        response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8").trim()));
        response.on("error", reject);
      });
      req.on("error", reject);
      req.end();
    });
  },
};
