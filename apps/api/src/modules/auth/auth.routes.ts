import { Router } from "express";

import { forgotPassword, getCurrentUser, login, logout, register } from "./auth.controller.js";
import { requireAuth } from "./auth.middleware.js";
import {
  authForgotPasswordRateLimit,
  authLoginRateLimit,
  authRegisterRateLimit,
} from "./auth.rateLimit.js";

export const authRouter = Router();

authRouter.post("/register", authRegisterRateLimit, register);
authRouter.post("/login", authLoginRateLimit, login);
authRouter.post("/forgot-password", authForgotPasswordRateLimit, forgotPassword);
authRouter.get("/me", requireAuth, getCurrentUser);
authRouter.post("/logout", logout);
