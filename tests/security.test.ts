import { describe, expect, it } from "vitest";
import {
  hashPassword,
  isLegacyHash,
  isPrivateAddress,
  signSessionToken,
  signTableToken,
  taxFromGross,
  verifyPassword,
  verifySessionToken,
  verifyTableToken,
  zplSafe
} from "../server/security";

describe("password hashing", () => {
  it("crea hashes scrypt y verifica la contraseña correcta", () => {
    const hash = hashPassword("una-clave-segura");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(verifyPassword("una-clave-segura", hash)).toBe(true);
    expect(verifyPassword("otra-clave", hash)).toBe(false);
  });

  it("sigue aceptando hashes legacy SHA-256 para migrarlos", () => {
    const legacy = "240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9";
    expect(isLegacyHash(legacy)).toBe(true);
    expect(verifyPassword("admin123", legacy)).toBe(true);
  });
});

describe("session tokens", () => {
  it("firma y verifica una sesión", () => {
    const token = signSessionToken({ id: "usr-1", role: "admin", tokenVersion: 2 });
    const payload = verifySessionToken(token);
    expect(payload?.sub).toBe("usr-1");
    expect(payload?.role).toBe("admin");
    expect(payload?.ver).toBe(2);
    expect(payload?.jti).toBeTruthy();
  });

  it("rechaza tokens manipulados", () => {
    const token = signSessionToken({ id: "usr-1", role: "camarero", tokenVersion: 1 });
    expect(verifySessionToken(token.slice(0, -2) + "xx")).toBeNull();
  });
});

describe("table tokens", () => {
  it("acepta el token de la mesa correcta", () => {
    const token = signTableToken("table-4");
    expect(verifyTableToken("table-4", token)).toBe(true);
    expect(verifyTableToken("table-5", token)).toBe(false);
  });
});

describe("money and ZPL", () => {
  it("calcula el IVA incluido, no lo suma sobre el bruto", () => {
    expect(taxFromGross(15, 10)).toBe(1.36);
    expect(taxFromGross(121, 21)).toBe(21);
    expect(taxFromGross(0, 10)).toBe(0);
  });

  it("neutraliza comandos ZPL en texto libre", () => {
    expect(zplSafe("Mesa ^XA~HS")).toBe("Mesa XA HS");
    expect(zplSafe("linea\nnueva")).toBe("linea nueva");
  });
});

describe("printer network validation", () => {
  it("permite direcciones privadas y loopback", () => {
    expect(isPrivateAddress("192.168.1.50")).toBe(true);
    expect(isPrivateAddress("10.0.0.8")).toBe(true);
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
    expect(isPrivateAddress("localhost")).toBe(true);
  });

  it("bloquea direcciones públicas y metadatos cloud", () => {
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    expect(isPrivateAddress("169.254.169.254")).toBe(false);
    expect(isPrivateAddress("193.127.45.74")).toBe(false);
    expect(isPrivateAddress("example.com")).toBe(false);
  });
});
