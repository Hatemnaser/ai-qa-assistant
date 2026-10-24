import type { QaEvidence } from "./types";
import { hasQaEvidenceContent } from "@oddpath/qa-execution-contract";
export function qaEvidenceAvailable(evidence: QaEvidence, now = Date.now()) {
    if (!hasQaEvidenceContent(evidence))
        return false;
    return evidence.assets.every(entry => entry.asset.status === "READY"
        && (!entry.asset.evidenceExpiresAt || Date.parse(entry.asset.evidenceExpiresAt) > now));
}
