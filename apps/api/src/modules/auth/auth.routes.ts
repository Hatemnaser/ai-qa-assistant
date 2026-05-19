import { Router } from "express";

import { forgotPassword, getCurrentUser, login, logout, register } from "./auth.controller.js";
import { requireAuth } from "./auth.middleware.js";

export const authRouter = Router();

authRouter.post("/register", register);
authRouter.post("/login", login);
authRouter.post("/forgot-password", forgotPassword);
authRouter.get("/me", requireAuth, getCurrentUser);
authRouter.post("/logout", logout);
