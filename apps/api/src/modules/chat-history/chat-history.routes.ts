import { Router } from "express";

import { requireAuth } from "../auth/auth.middleware.js";
import { deleteChat, listChats, saveChat } from "./chat-history.controller.js";

export const chatHistoryRouter = Router();

chatHistoryRouter.use(requireAuth);
chatHistoryRouter.get("/", listChats);
chatHistoryRouter.put("/:chatId", saveChat);
chatHistoryRouter.delete("/:chatId", deleteChat);
