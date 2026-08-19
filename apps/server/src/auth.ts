import type { AccessRole } from "@react-intelligence/shared";
import type { FastifyRequest } from "fastify";
import { createHash, timingSafeEqual } from "node:crypto";
import type { ServerConfig } from "./config.js";
import { findAccessTokenByHash, findAppIdByWriteKeyHash } from "./db/eventsRepository.js";

export interface ReadScope {
  all: boolean;
  appIds: Set<string>;
  role: AccessRole;
  actor: string;
}

export function ingestionAppId(request: FastifyRequest, config: ServerConfig): string | undefined {
  if (config.authDisabled) return "*";
  const token = bearerToken(request);
  if (!token) return undefined;
  return findAppIdByWriteKeyHash(hashWriteKey(token));
}

export function readScope(request: FastifyRequest, config: ServerConfig): ReadScope | undefined {
  if (config.authDisabled) return { all: true, appIds: new Set(), role: "owner", actor: "auth-disabled" };
  const token = bearerToken(request);
  if (!token) return undefined;
  if (secureEqual(config.dashboardToken, token)) return { all: true, appIds: new Set(), role: "owner", actor: "configured-owner" };
  const entry = Object.entries(config.readTokens).find(([candidate]) => secureEqual(candidate, token));
  if (entry) return { all: false, appIds: new Set(entry[1]), role: "viewer", actor: "configured-viewer" };
  const stored = findAccessTokenByHash(hashWriteKey(token));
  return stored ? { all: stored.role === "owner", appIds: new Set(stored.appIds), role: stored.role, actor: stored.name } : undefined;
}

export function canReadApp(scope: ReadScope, appId: string) {
  return scope.all || scope.appIds.has(appId);
}

export function canManageApp(scope: ReadScope, appId: string) {
  return scope.role !== "viewer" && canReadApp(scope, appId);
}

export function hashWriteKey(writeKey: string) {
  return createHash("sha256").update(writeKey).digest("hex");
}

function bearerToken(request: FastifyRequest) {
  const authorization = request.headers.authorization;
  return authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
}

function secureEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
