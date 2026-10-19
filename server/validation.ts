export const ROLES = ["admin", "camarero", "cocina", "bar"] as const;
export const STATIONS = ["cocina", "bar"] as const;
export const ORDER_STATUSES = ["pendiente", "en_preparacion", "listo", "servido", "cancelado"] as const;
export const TABLE_STATUSES = ["libre", "ocupada", "pendiente_pago"] as const;

export type Role = (typeof ROLES)[number];
export type Station = (typeof STATIONS)[number];
export type OrderStatusValue = (typeof ORDER_STATUSES)[number];

export function text(value: unknown, maxLength = 160): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

export function requiredText(value: unknown, maxLength = 160): string | null {
  const parsed = text(value, maxLength);
  return parsed.length > 0 ? parsed : null;
}

export function integer(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

export function decimal(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed * 100) / 100));
}

export function booleanValue(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") return ["1", "true", "si", "sí", "yes"].includes(value.toLowerCase());
  return fallback;
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function isStation(value: unknown): value is Station {
  return typeof value === "string" && (STATIONS as readonly string[]).includes(value);
}

export function isOrderStatus(value: unknown): value is OrderStatusValue {
  return typeof value === "string" && (ORDER_STATUSES as readonly string[]).includes(value);
}

export function isTableStatus(value: unknown): boolean {
  return typeof value === "string" && (TABLE_STATUSES as readonly string[]).includes(value);
}

export function pickDefined<T extends Record<string, unknown>>(source: T, allowed: readonly string[]): Partial<T> {
  const result: Record<string, unknown> = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined) {
      result[key] = source[key];
    }
  }
  return result as Partial<T>;
}

export function normalizeAllergen(value: unknown): string {
  return text(value, 40).toLowerCase().replace(/\s+/g, "_");
}
