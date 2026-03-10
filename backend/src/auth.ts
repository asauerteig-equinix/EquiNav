import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import { config } from "./config.js";
import type { AuthUser } from "./types.js";

type TokenPayload = {
  sub: string;
  username: string;
  role: "admin" | "editor" | "viewer";
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const signAuthToken = (user: AuthUser): string =>
  jwt.sign(
    {
      sub: String(user.id),
      username: user.username,
      role: user.role,
    } satisfies TokenPayload,
    config.jwtSecret,
    {
      expiresIn: config.jwtTtl as jwt.SignOptions["expiresIn"],
    } as jwt.SignOptions,
  );

const parseBearerToken = (authHeader: string | undefined): string | null => {
  if (!authHeader) {
    return null;
  }

  const [scheme, token] = authHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
};

export const requireAuth = (request: Request, response: Response, next: NextFunction): void => {
  const token = parseBearerToken(request.headers.authorization);
  if (!token) {
    response.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret) as TokenPayload;
    request.user = {
      id: Number(payload.sub),
      username: payload.username,
      role: payload.role,
    };
    next();
  } catch {
    response.status(401).json({ error: "Invalid or expired token" });
  }
};

export const requireRole = (...roles: Array<AuthUser["role"]>) => {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (!request.user) {
      response.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (!roles.includes(request.user.role)) {
      response.status(403).json({ error: "Forbidden" });
      return;
    }

    next();
  };
};
