import type { NextFunction, Request, Response } from "express";

import { AppError } from "../../lib/errors.js";
import {
  projectDocumentImportInputSchema,
  projectDocumentInputSchema,
} from "./project-documents.schema.js";
import { projectDocumentsService } from "./project-documents.service.js";

export async function listProjectDocuments(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({
      documents: await projectDocumentsService.listProjectDocuments(req.authUser!.id, getProjectIdParam(req)),
    });
  } catch (error) {
    next(error);
  }
}

export async function createProjectDocument(req: Request, res: Response, next: NextFunction) {
  try {
    const document = await projectDocumentsService.createProjectDocument(
      req.authUser!.id,
      getProjectIdParam(req),
      projectDocumentInputSchema.parse(req.body)
    );

    res.status(201).json({
      document,
    });
  } catch (error) {
    next(error);
  }
}

export async function importProjectDocuments(req: Request, res: Response, next: NextFunction) {
  try {
    const documents = await projectDocumentsService.importProjectDocuments(
      req.authUser!.id,
      getProjectIdParam(req),
      projectDocumentImportInputSchema.parse(req.body)
    );

    res.status(201).json({
      documents,
    });
  } catch (error) {
    next(error);
  }
}

export async function updateProjectDocument(req: Request, res: Response, next: NextFunction) {
  try {
    const document = await projectDocumentsService.updateProjectDocument(
      req.authUser!.id,
      getProjectIdParam(req),
      getDocumentIdParam(req),
      projectDocumentInputSchema.parse(req.body)
    );

    res.json({
      document,
    });
  } catch (error) {
    next(error);
  }
}

export async function deleteProjectDocument(req: Request, res: Response, next: NextFunction) {
  try {
    await projectDocumentsService.deleteProjectDocument(req.authUser!.id, getProjectIdParam(req), getDocumentIdParam(req));

    res.json({
      ok: true,
    });
  } catch (error) {
    next(error);
  }
}

function getProjectIdParam(req: Request) {
  const projectId = req.params.projectId;

  if (typeof projectId !== "string" || !projectId) {
    throw new AppError("Project id is required.", 400, "PROJECT_ID_REQUIRED");
  }

  return projectId;
}

function getDocumentIdParam(req: Request) {
  const documentId = req.params.documentId;

  if (typeof documentId !== "string" || !documentId) {
    throw new AppError("Project document id is required.", 400, "PROJECT_DOCUMENT_ID_REQUIRED");
  }

  return documentId;
}
