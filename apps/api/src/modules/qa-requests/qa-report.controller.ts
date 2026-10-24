import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { projectAccessService } from "../projects/project-access.service.js";
import { assetStorage } from "../assets/assets.storage.js";
import { qaReportRepository } from "./qa-report.repository.js";
import { collectQaReportBinaries, createQaReportDownload } from "./qa-report.package.js";
import { qaRequestParamsSchema } from "./qa-requests.schema.js";
const bodySchema = z.object({ format: z.enum(['JSON', 'MARKDOWN', 'ZIP']), runId: z.string().min(1).max(120).optional() }).strict();
export async function exportQaReport(req: Request, res: Response, next: NextFunction) {
    try {
        const { projectId, requestId } = qaRequestParamsSchema.parse(req.params), { format, runId } = bodySchema.parse(req.body), ownerId = req.authUser!.id;
        await projectAccessService.assertProjectAccess(ownerId, projectId);
        const source = await qaReportRepository.read(ownerId, projectId, new Date(), requestId);
        if (runId) {
            const request = source.history.requests[0], selected = request?.runs.find(run => run.id === runId);
            if (!request || !selected) {
                res.status(404).json({ code: 'QA_RUN_NOT_FOUND' });
                return;
            }
            request.runs = [selected];
        }
        const bundle = format === 'ZIP' ? await collectQaReportBinaries(ownerId, source.history, source.sources, assetStorage) : { history: source.history, entries: new Map<string, Uint8Array>(), totalBytes: 0 };
        const download = createQaReportDownload(bundle, format);
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Disposition', `attachment; filename="${download.filename}"`);
        res.type(download.mimeType).send(download.bytes);
    }
    catch (error) {
        next(error);
    }
}
