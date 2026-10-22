import crypto from "crypto";
import net from "net";

const isProduction = process.env.NODE_ENV === "production";

function requireSecret(name: string): string {
  const value = process.env[name];
  if (value && value.length >= 32) return value;
  if (isProduction) {
    throw new Error(`[Security] ${name} es obligatorio y debe tener al menos 32 caracteres en producción.`);
  }
  return crypto.randomBytes(48).toString("base64url");
}

export const JWT_SECRET = requireSecret("JWT_SECRET");
export const TABLE_TOKEN_SECRET = process.env.TABLE_TOKEN_SECRET || deriveTableSecret(JWT_SECRET);
export const TOKEN_TTL_SECONDS = Number(process.env.TOKEN_TTL_SECONDS || 28800);

function deriveTableSecret(jwtSecret: string): string {
  return crypto.createHmac("sha256", jwtSecret).update("gastro-os-table-token-v1").digest("hex");
}

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

function legacySha256(password: string): string {
  return crypto.createHash("sha256").update(password).digest("hex");
}

export function isLegacyHash(stored: string): boolean {
  return /^[a-f0-9]{64}$/i.test(stored);
}

export function verifyPassword(password: string, stored: string): boolean {
  if (!stored) return false;
  if (isLegacyHash(stored)) {
    const expected = Buffer.from(stored, "hex");
    const actual = Buffer.from(legacySha256(password), "hex");
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  }
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = parts[1];
  const expected = Buffer.from(parts[2], "hex");
  const actual = crypto.scryptSync(password, salt, expected.length, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export interface SessionPayload {
  sub: string;
  role: string;
  ver: number;
  jti: string;
  iat: number;
  exp: number;
}

export function signSessionToken(user: { id: string; role: string; tokenVersion?: number }): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    sub: user.id,
    role: user.role,
    ver: user.tokenVersion ?? 1,
    jti: crypto.randomUUID(),
    iat: now,
    exp: now + TOKEN_TTL_SECONDS
  };
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, body, signature] = parts;
    const expected = crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest("base64url");
    const expectedBuffer = Buffer.from(expected);
    const signatureBuffer = Buffer.from(signature);
    if (expectedBuffer.length !== signatureBuffer.length || !crypto.timingSafeEqual(expectedBuffer, signatureBuffer)) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as SessionPayload;
    if (!payload.sub || !payload.role || !payload.jti) return null;
    if (!Number.isFinite(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function signTableToken(tableId: string): string {
  return crypto.createHmac("sha256", TABLE_TOKEN_SECRET).update(`table:${tableId}`).digest("base64url");
}

export function verifyTableToken(tableId: string, token: string | undefined | null): boolean {
  if (!tableId || !token) return false;
  const expected = signTableToken(tableId);
  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function extractBearerToken(req: { headers: Record<string, unknown>; query?: Record<string, unknown> }, allowQuery = false): string | null {
  const header = req.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) return header.slice(7);
  if (allowQuery) {
    const queryToken = req.query?.token;
    if (typeof queryToken === "string" && queryToken.length > 0) return queryToken;
  }
  return null;
}

export function extractTableToken(req: { headers: Record<string, unknown>; query?: Record<string, unknown> }): string | null {
  const header = req.headers["x-table-token"];
  if (typeof header === "string" && header.length > 0) return header;
  const queryToken = req.query?.t;
  if (typeof queryToken === "string" && queryToken.length > 0) return queryToken;
  return null;
}

export function taxFromGross(gross: number, ratePercent: number): number {
  const rate = Number.isFinite(ratePercent) && ratePercent >= 0 && ratePercent <= 100 ? ratePercent : 10;
  return Math.round((gross - gross / (1 + rate / 100)) * 100) / 100;
}

export function zplSafe(value: unknown, maxLength = 120): string {
  return String(value ?? "")
    .replace(/\^/g, " ")
    .replace(/~/g, " ")
    .replace(/[\r\n\t]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function isPrivateAddress(address: string): boolean {
  const host = address.trim().toLowerCase();
  if (!host) return false;
  if (host === "localhost") return true;
  if (net.isIPv4(host)) {
    const [a, b] = host.split(".").map(Number);
    if (a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }
  if (net.isIPv6(host)) {
    return host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80");
  }
  return false;
}

interface RateLimitOptions {
  windowMs: number;
  max: number;
  key: (req: any) => string;
  message?: string;
}

export function createRateLimiter(options: RateLimitOptions) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req: any, res: any, next: any) => {
    const now = Date.now();
    const key = options.key(req);
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + options.windowMs });
      if (hits.size > 5000) {
        for (const [k, v] of hits) {
          if (v.resetAt <= now) hits.delete(k);
        }
      }
      return next();
    }
    entry.count += 1;
    if (entry.count > options.max) {
      res.setHeader("Retry-After", Math.ceil((entry.resetAt - now) / 1000));
      return res.status(429).json({ error: options.message || "Demasiadas solicitudes. Inténtalo más tarde." });
    }
    next();
  };
}

// req.ip ya respeta "trust proxy". La primera entrada de X-Forwarded-For la controla el cliente,
// así que leerla directamente permitiría saltarse los límites enviando una cabecera falsa.
export function clientIp(req: any): string {
  return req.ip || req.socket?.remoteAddress || "unknown";
}
