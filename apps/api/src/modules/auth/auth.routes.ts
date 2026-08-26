import { Router } from "express";

import {
  forgotPassword,
  getCsrfToken,
  getCurrentUser,
  getRegistrationConfig,
  login,
  logout,
  register,
  resendVerification,
  resetPassword,
  verifyEmail,
} from "./auth.controller.js";
import { requireAuth } from "./auth.middleware.js";
import {
  authForgotPasswordRateLimit,
  authLoginRateLimit,
  authRegisterRateLimit,
  authResendVerificationRateLimit,
  authResetPasswordRateLimit,
  authVerifyEmailRateLimit,
} from "./auth.rateLimit.js";

export const authRouter = Router();

authRouter.get("/csrf", getCsrfToken);
authRouter.get("/registration-config", getRegistrationConfig);
authRouter.post("/register", authRegisterRateLimit, register);
authRouter.post("/login", authLoginRateLimit, login);
authRouter.post("/forgot-password", authForgotPasswordRateLimit, forgotPassword);
authRouter.post("/reset-password", authResetPasswordRateLimit, resetPassword);
authRouter.post("/verify-email", authVerifyEmailRateLimit, verifyEmail);
authRouter.post("/resend-verification", authResendVerificationRateLimit, resendVerification);
authRouter.get("/me", requireAuth, getCurrentUser);
authRouter.post("/logout", logout);
