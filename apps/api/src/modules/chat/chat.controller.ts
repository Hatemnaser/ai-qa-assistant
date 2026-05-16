import type { NextFunction, Request, Response } from "express";

import { createChatReply } from "./chat.service.js";
import { chatRequestSchema } from "./chat.schema.js";

export async function sendChatMessage(req: Request, res: Response, next: NextFunction) {
  try {
    const input = chatRequestSchema.parse(req.body);
    const response = await createChatReply(input);

    res.json(response);
  } catch (error) {
    next(error);
  }
}
