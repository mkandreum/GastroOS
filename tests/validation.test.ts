import { describe, expect, it } from "vitest";
import { decimal, integer, isOrderStatus, isRole, isStation, pickDefined, requiredText, text } from "../server/validation";

describe("validation primitives", () => {
  it("normaliza texto y limita longitud", () => {
    expect(text("  hola  ")).toBe("hola");
    expect(text("abcdef", 3)).toBe("abc");
    expect(requiredText("   ")).toBeNull();
  });

  it("acota enteros y decimales", () => {
    expect(integer("12", 1, 10, 1)).toBe(10);
    expect(integer("0", 1, 10, 5)).toBe(1);
    expect(decimal("12.345", 0, 100, 0)).toBe(12.35);
    expect(decimal("nope", 0, 100, 9)).toBe(9);
  });

  it("valida roles, estaciones y estados", () => {
    expect(isRole("admin")).toBe(true);
    expect(isRole("root")).toBe(false);
    expect(isStation("bar")).toBe(true);
    expect(isStation("postres")).toBe(false);
    expect(isOrderStatus("listo")).toBe(true);
    expect(isOrderStatus("volando")).toBe(false);
  });

  it("filtra campos no permitidos", () => {
    const input = { name: "Mesa", price: 10, evil: "DROP TABLE" };
    expect(pickDefined(input, ["name", "price"])).toEqual({ name: "Mesa", price: 10 });
  });
});
