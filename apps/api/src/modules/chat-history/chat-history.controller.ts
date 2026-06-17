import type { NextFunction, Request, Response } from "express";

import { AppError } from "../../lib/errors.js";
import { conversationSummaryRefreshService } from "../conversation-summary/conversation-summary-refresh.service.js";
import { saveStoredChatRequestSchema } from "./chat-history.schema.js";
import { chatHistoryService } from "./chat-history.service.js";

export async function listChats(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({
      chats: await chatHistoryService.listUserChats(req.authUser!.id),
    });
  } catch (error) {
    next(error);
  }
}

export async function saveChat(req: Request, res: Response, next: NextFunction) {
  try {
    const { chat } = saveStoredChatRequestSchema.parse(req.body);
    const chatId = getChatIdParam(req);

    if (chatId !== chat.id) {
      throw new AppError("Chat id does not match the request path.", 400, "CHAT_ID_MISMATCH");
    }

    const userId = req.authUser!.id;
    const savedChat = await chatHistoryService.saveUserChat(userId, chat);

    res.json({
      chat: savedChat,
    });

    void conversationSummaryRefreshService.requestRefresh(userId, savedChat.id);
  } catch (error) {
    next(error);
  }
}

export async function deleteChat(req: Request, res: Response, next: NextFunction) {
  try {
    await chatHistoryService.deleteUserChat(req.authUser!.id, getChatIdParam(req));

    res.json({
      ok: true,
    });
  } catch (error) {
    next(error);
  }
}

function getChatIdParam(req: Request) {
  const chatId = req.params.chatId;

  if (typeof chatId !== "string" || !chatId) {
    throw new AppError("Chat id is required.", 400, "CHAT_ID_REQUIRED");
  }

  return chatId;
}
