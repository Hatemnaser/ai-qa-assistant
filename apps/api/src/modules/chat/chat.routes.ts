import { Router } from "express";

import { sendChatMessage } from "./chat.controller.js";

export const chatRouter = Router();

chatRouter.post("/", sendChatMessage);
