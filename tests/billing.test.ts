import fs from "fs";
import os from "os";
import path from "path";
import { beforeAll, describe, expect, it } from "vitest";
import type { Order, OrderLine } from "../src/types";

let db: typeof import("../server/db").dbInstance;

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gastro-billing-"));
  process.env.DB_PATH = path.join(dir, "test.db");
  process.env.SEED_DEMO = "true";
  db = (await import("../server/db")).dbInstance;
});

let counter = 0;
function line(productId: string, name: string, quantity: number, priceUnit: number, destination: "cocina" | "bar", taxRate: number): OrderLine {
  counter += 1;
  return {
    id: `line-test-${counter}`,
    productId,
    name,
    quantity,
    priceUnit,
    priceTotal: Math.round(priceUnit * quantity * 100) / 100,
    notes: "",
    selectedExtras: [],
    destination,
    taxRate,
    stationStatus: "pendiente"
  };
}

function order(tableId: string, items: OrderLine[]): Order {
  counter += 1;
  const table = db.getTableById(tableId)!;
  return {
    id: `ord-test-${counter}`,
    tableId,
    tableName: table.name,
    sessionId: table.activeSessionId || `sess-test-${counter}`,
    timestamp: new Date().toISOString(),
    status: "pendiente",
    items,
    totalAmount: Math.round(items.reduce((sum, item) => sum + item.priceTotal, 0) * 100) / 100
  };
}

describe("cobro de mesas", () => {
  it("tres pagos a partes iguales cierran la cuenta exacta, sin duplicar ingresos", () => {
    db.createOrderAtomic(order("table-1", [line("p-a", "Plato", 2, 20, "cocina", 10), line("p-b", "Vino", 3, 20, "bar", 21)]), []);
    expect(db.getTableById("table-1")!.currentBillTotal).toBe(100);

    const share = Math.round((100 / 3) * 100) / 100;
    const first = db.closeTableSession("table-1", undefined, "partes_iguales", { amount: share }) as any;
    expect(first.total).toBe(33.33);
    expect(db.getTableById("table-1")!.status).toBe("pendiente_pago");

    const second = db.closeTableSession("table-1", undefined, "partes_iguales", { amount: share }) as any;
    const third = db.closeTableSession("table-1", undefined, "partes_iguales", { amount: share }) as any;
    expect(Math.round((first.total + second.total + third.total) * 100) / 100).toBe(100);
    expect(third.total).toBe(33.34);

    const table = db.getTableById("table-1")!;
    expect(table.status).toBe("libre");
    expect(table.activeSessionId).toBeNull();
  });

  it("cerrar completa tras un pago a cuenta solo cobra el resto", () => {
    db.createOrderAtomic(order("table-2", [line("p-a", "Plato", 1, 50, "cocina", 10)]), []);
    db.closeTableSession("table-2", undefined, "partes_iguales", { amount: 20 });
    const rest = db.closeTableSession("table-2", undefined, "completa", {}) as any;
    expect(rest.total).toBe(30);
    expect(rest.items.some((item: any) => item.priceTotal === -20)).toBe(true);
    expect(db.getTableById("table-2")!.status).toBe("libre");
  });

  it("no acepta un pago a cuenta mayor que lo pendiente", () => {
    db.createOrderAtomic(order("table-3", [line("p-a", "Plato", 1, 10, "cocina", 10)]), []);
    const receipt = db.closeTableSession("table-3", undefined, "partes_iguales", { amount: 999 }) as any;
    expect(receipt.total).toBe(10);
    expect(db.getTableById("table-3")!.status).toBe("libre");
  });

  it("por líneas ignora precios y cantidades inventados por el cliente", () => {
    db.createOrderAtomic(order("table-4", [line("p-a", "Plato", 2, 12, "cocina", 10), line("p-b", "Vino", 1, 4, "bar", 21)]), []);
    const receipt = db.closeTableSession("table-4", [
      { productId: "p-a", quantity: 99, priceUnit: 0.01, priceTotal: 0.01, notes: "", selectedExtras: [] },
      { productId: "p-b", quantity: -5, priceTotal: -100 },
      { productId: "no-existe", quantity: 1, priceTotal: 5 }
    ], "por_lineas", {}) as any;
    expect(receipt.total).toBe(24);
    expect(receipt.items).toHaveLength(1);
    expect(receipt.items[0].quantity).toBe(2);
    expect(receipt.taxAmount).toBe(2.18);

    const table = db.getTableById("table-4")!;
    expect(table.status).toBe("pendiente_pago");
    expect(table.currentBillTotal).toBe(4);
    expect(() => db.closeTableSession("table-4", [{ productId: "p-a", quantity: 1 }], "por_lineas", {})).toThrow();
  });

  it("un pedido a 0 € no libera la mesa por sí solo", () => {
    db.createOrderAtomic(order("table-5", [line("p-z", "Agua del grifo", 1, 0, "bar", 10)]), []);
    const table = db.getTableById("table-5")!;
    expect(table.status).toBe("ocupada");
    expect(table.activeSessionId).not.toBeNull();
  });

  it("anular el único pedido libera la mesa", () => {
    const created = db.createOrderAtomic(order("table-6", [line("p-a", "Plato", 1, 9, "cocina", 10)]), []);
    db.updateOrderStatus(created.id, "cancelado");
    expect(db.getTableById("table-6")!.status).toBe("libre");
  });
});
