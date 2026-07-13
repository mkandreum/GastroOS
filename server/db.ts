/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import Database from "better-sqlite3";
import { 
  User, Table, Category, Product, Order, OrderLine, PrintLog, PrinterConfig, AdminStats, OrderStatus, TicketTemplate, WaiterCall
} from "../src/types";

// Carpeta y archivo de base de datos SQLite
const DB_DIR = path.join(process.cwd(), "data");
const DB_FILE = path.join(DB_DIR, "restaurante.db");

// Asegurar que exista la carpeta de datos
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

// Inicializar la conexión SQLite con reintentos para entornos multi-contenedor
function createDbConnection(): Database.Database {
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const d = new Database(DB_FILE);
      d.pragma("journal_mode = WAL");
      d.pragma("busy_timeout = 5000");
      return d;
    } catch (err: any) {
      lastErr = err;
      console.error(`[DB] Intento ${attempt}/5 falló: ${err.message}`);
      if (attempt < 5) {
        // Espera progresiva bloqueante (evita crash en módulo sin async)
        const ms = attempt * 1000;
        const deadline = Date.now() + ms;
        while (Date.now() < deadline) { /* busy wait */ }
      }
    }
  }
  throw lastErr || new Error("No se pudo abrir la base de datos");
}

const db = createDbConnection();

// Función auxiliar para cifrar contraseñas con SHA256 nativo
export function hashPassword(passwd: string): string {
  return crypto.createHash("sha256").update(passwd).digest("hex");
}

// Datos semilla iniciales (Seed Data)
const initialSeed = () => {
  const users = [
    { id: "usr-admin", username: "admin", role: "admin" as const, name: "Administrador General", passwordHash: hashPassword("admin123") }
  ];

  const printerConfig: PrinterConfig = {
    ip: "192.168.1.100",
    port: 9100,
    name: "Impresora Cocina Seiko",
    enabled: false
  };

  const ticketPrinterConfig: PrinterConfig = {
    ip: "192.168.1.101",
    port: 9100,
    name: "Impresora Tickets Epson",
    enabled: false
  };

  return {
    users,
    tables: [],
    categories: [],
    products: [],
    printerConfig,
    ticketPrinterConfig,
    closedReceiptsHistory: []
  };
};

class LocalDatabase {
  constructor() {
    this.init();
  }

  private init() {
    try {
      // Crear tablas necesarias en SQLite
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          username TEXT UNIQUE,
          name TEXT,
          role TEXT,
          passwordHash TEXT
        );

        CREATE TABLE IF NOT EXISTS tables (
          id TEXT PRIMARY KEY,
          number INTEGER UNIQUE,
          name TEXT,
          status TEXT,
          activeSessionId TEXT,
          qrCodeData TEXT,
          currentBillTotal REAL,
          posX INTEGER,
          posY INTEGER,
          width INTEGER,
          height INTEGER
        );

        CREATE TABLE IF NOT EXISTS categories (
          id TEXT PRIMARY KEY,
          name TEXT,
          description TEXT,
          icon TEXT
        );

        CREATE TABLE IF NOT EXISTS products (
          id TEXT PRIMARY KEY,
          categoryId TEXT,
          name TEXT,
          description TEXT,
          price REAL,
          image TEXT,
          allergens TEXT,
          iva INTEGER,
          available INTEGER,
          stock INTEGER,
          modifierGroups TEXT
        );

        CREATE TABLE IF NOT EXISTS orders (
          id TEXT PRIMARY KEY,
          tableId TEXT,
          tableName TEXT,
          sessionId TEXT,
          timestamp TEXT,
          status TEXT,
          totalAmount REAL
        );

        CREATE TABLE IF NOT EXISTS order_items (
          id TEXT PRIMARY KEY,
          orderId TEXT,
          productId TEXT,
          name TEXT,
          quantity INTEGER,
          priceUnit REAL,
          priceTotal REAL,
          notes TEXT,
          selectedExtras TEXT,
          destination TEXT
        );

        CREATE TABLE IF NOT EXISTS printer_configs (
          key TEXT PRIMARY KEY,
          ip TEXT,
          port INTEGER,
          name TEXT,
          enabled INTEGER
        );

        CREATE TABLE IF NOT EXISTS print_logs (
          id TEXT PRIMARY KEY,
          orderId TEXT,
          zpl TEXT,
          status TEXT,
          errorMessage TEXT,
          retries INTEGER,
          timestamp TEXT
        );

        CREATE TABLE IF NOT EXISTS closed_receipts (
          id TEXT PRIMARY KEY,
          tableId TEXT,
          tableName TEXT,
          sessionId TEXT,
          subtotal REAL,
          taxAmount REAL,
          total REAL,
          timestamp TEXT,
          items TEXT,
          splitMethod TEXT
        );

        CREATE TABLE IF NOT EXISTS waiter_calls (
          id TEXT PRIMARY KEY,
          tableId TEXT,
          tableName TEXT,
          reason TEXT,
          status TEXT,
          timestamp TEXT
        );

        CREATE TABLE IF NOT EXISTS push_subscriptions (
          id TEXT PRIMARY KEY,
          userId TEXT,
          role TEXT,
          endpoint TEXT UNIQUE,
          p256dh TEXT,
          auth TEXT,
          createdAt TEXT
        );
      `);

      // Tabla de plantilla de ticket personalizable
      db.exec(`
        CREATE TABLE IF NOT EXISTS ticket_template (
          id INTEGER PRIMARY KEY DEFAULT 1,
          business_name TEXT NOT NULL DEFAULT 'GASTRO-OS',
          header_title TEXT NOT NULL DEFAULT 'TICKET DE CUENTA',
          footer_thanks TEXT NOT NULL DEFAULT '!Muchas gracias por su visita!',
          footer_url TEXT NOT NULL DEFAULT 'GastroOS - GastroOS.com',
          kitchen_header TEXT NOT NULL DEFAULT 'COMANDA DE COCINA',
          kitchen_footer TEXT NOT NULL DEFAULT 'Servicio de Comanda Unificado',
          label_cant TEXT NOT NULL DEFAULT 'CANT',
          label_descripcion TEXT NOT NULL DEFAULT 'DESCRIPCION',
          label_total TEXT NOT NULL DEFAULT 'TOTAL',
          label_factura TEXT NOT NULL DEFAULT 'Factura',
          label_mesa TEXT NOT NULL DEFAULT 'Mesa',
          label_ticket TEXT NOT NULL DEFAULT 'Ticket #',
          label_metodo_pago TEXT NOT NULL DEFAULT 'Metodo Pago',
          label_subtotal TEXT NOT NULL DEFAULT 'Subtotal',
          label_iva TEXT NOT NULL DEFAULT 'IVA Incluido',
          label_total_final TEXT NOT NULL DEFAULT 'TOTAL',
          paper_width REAL NOT NULL DEFAULT 10.45,
          paper_height REAL NOT NULL DEFAULT 14.50
        );
      `);

      // Asegurar fila por defecto
      const tmplCount = db.prepare("SELECT count(*) as count FROM ticket_template").get() as { count: number };
      if (tmplCount && tmplCount.count === 0) {
        db.prepare("INSERT INTO ticket_template (id) VALUES (1)").run();
      }

      // Migración: agregar columna print_mode a printer_configs
      try {
        db.exec("ALTER TABLE printer_configs ADD COLUMN print_mode TEXT DEFAULT 'browser'");
      } catch {
        // La columna ya existe, ignorar
      }

      // Verificar si hay que insertar la semilla
      const userCount = db.prepare("SELECT count(*) as count FROM users").get() as { count: number };
      if (userCount && userCount.count === 0) {
        console.log("[SQLite] Sembrando base de datos inicial...");
        const seed = initialSeed();
        
        // Insertar usuarios
        const insertUser = db.prepare("INSERT INTO users (id, username, name, role, passwordHash) VALUES (?, ?, ?, ?, ?)");
        for (const u of seed.users) {
          insertUser.run(u.id, u.username, u.name, u.role, u.passwordHash);
        }

        // Insertar mesas
        const insertTable = db.prepare("INSERT INTO tables (id, number, name, status, activeSessionId, qrCodeData, currentBillTotal, posX, posY) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
        for (const t of seed.tables) {
          insertTable.run(t.id, t.number, t.name, t.status, t.activeSessionId, t.qrCodeData, t.currentBillTotal, t.posX, t.posY);
        }

        // Insertar categorías
        const insertCategory = db.prepare("INSERT INTO categories (id, name, description, icon) VALUES (?, ?, ?, ?)");
        for (const c of seed.categories) {
          insertCategory.run(c.id, c.name, c.description, c.icon);
        }

        // Insertar productos
        const insertProduct = db.prepare("INSERT INTO products (id, categoryId, name, description, price, image, allergens, iva, available, stock, modifierGroups) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
        for (const p of seed.products) {
          insertProduct.run(
            p.id,
            p.categoryId,
            p.name,
            p.description,
            p.price,
            p.image,
            JSON.stringify(p.allergens || []),
            p.iva,
            p.available ? 1 : 0,
            p.stock,
            JSON.stringify(p.modifierGroups || [])
          );
        }

        // Insertar configuración de impresoras
        const insertPrinter = db.prepare("INSERT INTO printer_configs (key, ip, port, name, enabled) VALUES (?, ?, ?, ?, ?)");
        insertPrinter.run("kitchen", seed.printerConfig.ip, seed.printerConfig.port, seed.printerConfig.name, seed.printerConfig.enabled ? 1 : 0);
        insertPrinter.run("ticket", seed.ticketPrinterConfig.ip, seed.ticketPrinterConfig.port, seed.ticketPrinterConfig.name, seed.ticketPrinterConfig.enabled ? 1 : 0);

        // Insertar historial de cobros cerrados
        const insertReceipt = db.prepare("INSERT INTO closed_receipts (id, tableId, tableName, sessionId, subtotal, taxAmount, total, timestamp, items, splitMethod) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
        for (const r of seed.closedReceiptsHistory) {
          insertReceipt.run(r.id, r.tableId, r.tableName, r.sessionId, r.subtotal, r.taxAmount, r.total, r.timestamp, JSON.stringify(r.items), r.splitMethod);
        }
        console.log("[SQLite] Semilla cargada exitosamente.");
      }
    } catch (error) {
      console.error("Error al inicializar la base de datos SQLite:", error);
    }
  }

  // Métodos de acceso para Usuarios
  public getUsers(): User[] {
    const rows = db.prepare("SELECT * FROM users").all() as any[];
    return rows.map(r => ({
      id: r.id,
      username: r.username,
      role: r.role,
      name: r.name,
      passwordHash: r.passwordHash
    }));
  }

  public addUser(user: User & { passwordHash: string }) {
    db.prepare("INSERT INTO users (id, username, name, role, passwordHash) VALUES (?, ?, ?, ?, ?)")
      .run(user.id, user.username, user.name, user.role, user.passwordHash);
  }

  public deleteUser(id: string): boolean {
    if (id === "usr-admin") return false; // Proteger usuario administrador raíz
    const result = db.prepare("DELETE FROM users WHERE id = ?").run(id);
    return result.changes > 0;
  }

  // Métodos para Mesas
  public getTables(): Table[] {
    const rows = db.prepare("SELECT * FROM tables").all() as any[];
    return rows.map(r => ({
      id: r.id,
      number: r.number,
      name: r.name,
      status: r.status,
      activeSessionId: r.activeSessionId,
      qrCodeData: r.qrCodeData,
      currentBillTotal: parseFloat(r.currentBillTotal || 0),
      posX: r.posX,
      posY: r.posY,
      width: r.width,
      height: r.height
    }));
  }

  public getTableById(id: string): Table | undefined {
    const r = db.prepare("SELECT * FROM tables WHERE id = ?").get(id) as any;
    if (!r) return undefined;
    return {
      id: r.id,
      number: r.number,
      name: r.name,
      status: r.status,
      activeSessionId: r.activeSessionId,
      qrCodeData: r.qrCodeData,
      currentBillTotal: parseFloat(r.currentBillTotal || 0),
      posX: r.posX,
      posY: r.posY,
      width: r.width,
      height: r.height
    };
  }

  public updateTable(id: string, updates: Partial<Table>) {
    const fields = Object.keys(updates);
    if (fields.length === 0) return this.getTableById(id);
    const setClause = fields.map(f => `${f} = ?`).join(", ");
    const values = Object.values(updates);
    db.prepare(`UPDATE tables SET ${setClause} WHERE id = ?`).run(...values, id);
    return this.getTableById(id);
  }

  public createTable(table: { number: number; name: string; appUrl: string }) {
    const tableId = `table-${table.number}`;
    const col = (table.number - 1) % 4;
    const row = Math.floor((table.number - 1) / 4);
    
    const existing = this.getTableById(tableId);
    if (existing) return existing;

    const newTable: Table = {
      id: tableId,
      number: table.number,
      name: table.name,
      status: "libre",
      activeSessionId: null,
      qrCodeData: `${table.appUrl || ""}/mesa/${table.number}`,
      currentBillTotal: 0,
      posX: 100 + col * 200,
      posY: 100 + row * 180
    };

    db.prepare("INSERT INTO tables (id, number, name, status, activeSessionId, qrCodeData, currentBillTotal, posX, posY) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(newTable.id, newTable.number, newTable.name, newTable.status, newTable.activeSessionId, newTable.qrCodeData, newTable.currentBillTotal, newTable.posX, newTable.posY);

    return newTable;
  }

  public deleteTable(id: string): boolean {
    const result = db.prepare("DELETE FROM tables WHERE id = ?").run(id);
    return result.changes > 0;
  }

  // Métodos de Carta / Catálogo
  public getCategories(): Category[] {
    return db.prepare("SELECT * FROM categories").all() as Category[];
  }

  public createCategory(category: Omit<Category, "id">) {
    const newCategory: Category = { ...category, id: uid("cat") };
    db.prepare("INSERT INTO categories (id, name, description, icon) VALUES (?, ?, ?, ?)")
      .run(newCategory.id, newCategory.name, newCategory.description, newCategory.icon);
    return newCategory;
  }

  public updateCategory(id: string, updates: Partial<Category>) {
    const fields = Object.keys(updates);
    if (fields.length === 0) return db.prepare("SELECT * FROM categories WHERE id = ?").get(id) as Category;
    const setClause = fields.map(f => `${f} = ?`).join(", ");
    const values = Object.values(updates);
    db.prepare(`UPDATE categories SET ${setClause} WHERE id = ?`).run(...values, id);
    return db.prepare("SELECT * FROM categories WHERE id = ?").get(id) as Category;
  }

  public deleteCategory(id: string): boolean {
    const result = db.prepare("DELETE FROM categories WHERE id = ?").run(id);
    if (result.changes > 0) {
      db.prepare("DELETE FROM products WHERE categoryId = ?").run(id);
      return true;
    }
    return false;
  }

  public getProducts(): Product[] {
    const rows = db.prepare("SELECT * FROM products").all() as any[];
    return rows.map(r => ({
      id: r.id,
      categoryId: r.categoryId,
      name: r.name,
      description: r.description,
      price: parseFloat(r.price || 0),
      image: r.image,
      allergens: JSON.parse(r.allergens || "[]"),
      iva: r.iva,
      available: r.available === 1,
      stock: r.stock,
      modifierGroups: JSON.parse(r.modifierGroups || "[]")
    }));
  }

  public getProductById(id: string): Product | undefined {
    const r = db.prepare("SELECT * FROM products WHERE id = ?").get(id) as any;
    if (!r) return undefined;
    return {
      id: r.id,
      categoryId: r.categoryId,
      name: r.name,
      description: r.description,
      price: parseFloat(r.price || 0),
      image: r.image,
      allergens: JSON.parse(r.allergens || "[]"),
      iva: r.iva,
      available: r.available === 1,
      stock: r.stock,
      modifierGroups: JSON.parse(r.modifierGroups || "[]")
    };
  }

  public createProduct(product: Product) {
    db.prepare("INSERT INTO products (id, categoryId, name, description, price, image, allergens, iva, available, stock, modifierGroups) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(
        product.id,
        product.categoryId,
        product.name,
        product.description,
        product.price,
        product.image,
        JSON.stringify(product.allergens || []),
        product.iva,
        product.available ? 1 : 0,
        product.stock,
        JSON.stringify(product.modifierGroups || [])
      );
    return product;
  }

  public updateProduct(id: string, updates: Partial<Product>) {
    const finalUpdates = { ...updates };
    if (updates.allergens !== undefined) {
      (finalUpdates as any).allergens = JSON.stringify(updates.allergens);
    }
    if (updates.modifierGroups !== undefined) {
      (finalUpdates as any).modifierGroups = JSON.stringify(updates.modifierGroups);
    }
    if (updates.available !== undefined) {
      (finalUpdates as any).available = updates.available ? 1 : 0;
    }
    
    const fields = Object.keys(finalUpdates);
    if (fields.length === 0) return this.getProductById(id);
    const setClause = fields.map(f => `${f} = ?`).join(", ");
    const values = Object.values(finalUpdates);
    db.prepare(`UPDATE products SET ${setClause} WHERE id = ?`).run(...values, id);
    return this.getProductById(id);
  }

  public deleteProduct(id: string): boolean {
    const result = db.prepare("DELETE FROM products WHERE id = ?").run(id);
    return result.changes > 0;
  }

  public importCatalog(mode: "replace" | "append", items: any[]): { success: boolean, count: number } {
    const executeTransaction = db.transaction((importMode: "replace" | "append", productsList: any[]) => {
      if (importMode === "replace") {
        // Eliminar productos y categorías existentes
        db.prepare("DELETE FROM products").run();
        db.prepare("DELETE FROM categories").run();
      }

      // Obtener categorías actuales para evitar duplicar nombres
      const existingCategories = db.prepare("SELECT * FROM categories").all() as any[];
      const categoryMap = new Map<string, string>(); // name.toLowerCase() -> id
      existingCategories.forEach(c => {
        categoryMap.set(c.name.toLowerCase(), c.id);
      });

      let importedCount = 0;

      for (const item of productsList) {
        let categoryId = categoryMap.get(item.categoryName.toLowerCase());
        
        if (!categoryId) {
          // Crear categoría
          categoryId = uid("cat");
          // Icono predeterminado según el nombre de la categoría
          let icon = "Utensils";
          const catNameLower = item.categoryName.toLowerCase();
          if (catNameLower.includes("bebida") || catNameLower.includes("refresco") || catNameLower.includes("vino") || catNameLower.includes("bodega") || catNameLower.includes("cóctel") || catNameLower.includes("coctel")) {
            icon = "GlassWater";
          } else if (catNameLower.includes("carne") || catNameLower.includes("principal") || catNameLower.includes("plato") || catNameLower.includes("hamburguesa") || catNameLower.includes("pollo") || catNameLower.includes("pescado")) {
            icon = "Beef";
          } else if (catNameLower.includes("postre") || catNameLower.includes("dulce") || catNameLower.includes("helado") || catNameLower.includes("tarta")) {
            icon = "IceCream";
          }
          
          db.prepare("INSERT INTO categories (id, name, description, icon) VALUES (?, ?, ?, ?)")
            .run(categoryId, item.categoryName, `${item.categoryName} del menú`, icon);
          
          categoryMap.set(item.categoryName.toLowerCase(), categoryId);
        }

        // Insertar producto
        const productId = `prod-${Date.now()}-${Math.floor(Math.random() * 10000)}-${importedCount}`;
        db.prepare("INSERT INTO products (id, categoryId, name, description, price, image, allergens, iva, available, stock, modifierGroups) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .run(
            productId,
            categoryId,
            item.name,
            item.description || "",
            item.price,
            item.image || "default.jpg",
            JSON.stringify(item.allergens || []),
            item.iva || 10,
            item.available ? 1 : 0,
            item.stock !== undefined ? item.stock : null,
            JSON.stringify([]) // modifierGroups vacío por defecto al importar CSV simple
          );

        importedCount++;
      }

      return importedCount;
    });

    const count = executeTransaction(mode, items);
    return { success: true, count };
  }

  // Métodos de Pedidos (Orders)
  public getOrders(): Order[] {
    const rows = db.prepare("SELECT * FROM orders ORDER BY timestamp DESC").all() as any[];
    return rows.map(r => {
      const items = db.prepare("SELECT * FROM order_items WHERE orderId = ?").all(r.id) as any[];
      return {
        id: r.id,
        tableId: r.tableId,
        tableName: r.tableName,
        sessionId: r.sessionId,
        timestamp: r.timestamp,
        status: r.status as OrderStatus,
        totalAmount: parseFloat(r.totalAmount || 0),
        items: items.map(item => ({
          id: item.id,
          productId: item.productId,
          name: item.name,
          quantity: item.quantity,
          priceUnit: parseFloat(item.priceUnit || 0),
          priceTotal: parseFloat(item.priceTotal || 0),
          notes: item.notes,
          selectedExtras: JSON.parse(item.selectedExtras || "[]"),
          destination: item.destination
        }))
      };
    });
  }

  public getOrderById(id: string): Order | undefined {
    const r = db.prepare("SELECT * FROM orders WHERE id = ?").get(id) as any;
    if (!r) return undefined;
    const items = db.prepare("SELECT * FROM order_items WHERE orderId = ?").all(id) as any[];
    return {
      id: r.id,
      tableId: r.tableId,
      tableName: r.tableName,
      sessionId: r.sessionId,
      timestamp: r.timestamp,
      status: r.status as OrderStatus,
      totalAmount: parseFloat(r.totalAmount || 0),
      items: items.map(item => ({
        id: item.id,
        productId: item.productId,
        name: item.name,
        quantity: item.quantity,
        priceUnit: parseFloat(item.priceUnit || 0),
        priceTotal: parseFloat(item.priceTotal || 0),
        notes: item.notes,
        selectedExtras: JSON.parse(item.selectedExtras || "[]"),
        destination: item.destination
      }))
    };
  }

  public createOrder(order: Order) {
    const insertOrder = db.prepare("INSERT INTO orders (id, tableId, tableName, sessionId, timestamp, status, totalAmount) VALUES (?, ?, ?, ?, ?, ?, ?)");
    const insertItem = db.prepare("INSERT INTO order_items (id, orderId, productId, name, quantity, priceUnit, priceTotal, notes, selectedExtras, destination) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");

    const executeTransaction = db.transaction((o: Order) => {
      insertOrder.run(o.id, o.tableId, o.tableName, o.sessionId, o.timestamp, o.status, o.totalAmount);
      for (const item of o.items) {
        insertItem.run(
          item.id,
          o.id,
          item.productId,
          item.name,
          item.quantity,
          item.priceUnit,
          item.priceTotal,
          item.notes,
          JSON.stringify(item.selectedExtras || []),
          item.destination
        );
      }
    });

    executeTransaction(order);

    // Recalcular el total acumulado de la mesa
    const table = this.getTableById(order.tableId);
    if (table) {
      const activeSession = table.activeSessionId || order.sessionId;
      this.updateTable(order.tableId, {
        status: table.status === "libre" ? "ocupada" : table.status,
        activeSessionId: activeSession
      });
      this.recalculateTableBillTotal(order.tableId);
    }

    return order;
  }

  public recalculateTableBillTotal(tableId: string) {
    const table = this.getTableById(tableId);
    if (!table || !table.activeSessionId) return;

    const sessionId = table.activeSessionId;

    const activeOrders = db.prepare("SELECT totalAmount FROM orders WHERE tableId = ? AND sessionId = ? AND status != 'cancelado'").all(tableId, sessionId) as any[];
    const sessionTotal = activeOrders.reduce((sum, ord) => sum + parseFloat(ord.totalAmount || 0), 0);

    const flatPaidQuery = db.prepare("SELECT SUM(total) as sum FROM closed_receipts WHERE sessionId = ? AND splitMethod != 'por_lineas'").get(sessionId) as any;
    const flatPaidInSession = flatPaidQuery ? parseFloat(flatPaidQuery.sum || 0) : 0;

    const remainingTotal = Math.max(0, sessionTotal - flatPaidInSession);

    const newStatus = remainingTotal === 0 ? "libre" : table.status;

    db.prepare("UPDATE tables SET currentBillTotal = ?, status = ? WHERE id = ?").run(
      parseFloat(remainingTotal.toFixed(2)),
      newStatus,
      tableId
    );

    if (remainingTotal === 0) {
      db.prepare("UPDATE tables SET activeSessionId = NULL WHERE id = ?").run(tableId);
    }
  }

  public updateOrderStatus(orderId: string, status: OrderStatus) {
    const order = this.getOrderById(orderId);
    if (!order) return null;

    db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(status, orderId);
    
    const table = this.getTableById(order.tableId);
    if (table && table.activeSessionId === order.sessionId) {
      this.recalculateTableBillTotal(order.tableId);
    }

    return this.getOrderById(orderId);
  }

  // Cierre de Cuenta
  public closeTableSession(tableId: string, customReceiptItems?: any[], splitCalculationMethod?: string) {
    const table = this.getTableById(tableId);
    if (!table || !table.activeSessionId) return null;

    const sessionId = table.activeSessionId;
    const activeOrders = this.getOrders().filter(
      o => o.tableId === tableId && o.sessionId === sessionId && o.status !== "cancelado"
    );

    if (activeOrders.length === 0 && (!customReceiptItems || customReceiptItems.length === 0)) {
      this.updateTable(tableId, {
        status: "libre",
        activeSessionId: null,
        currentBillTotal: 0
      });
      return { success: true, empty: true };
    }

    const items: any[] = [];
    let subtotal = 0;
    let taxAmount = 0;

    if (customReceiptItems && customReceiptItems.length > 0) {
      customReceiptItems.forEach(item => {
        items.push({
          name: item.name,
          quantity: item.quantity,
          priceUnit: item.priceUnit,
          priceTotal: item.priceTotal
        });
        subtotal += item.priceTotal;
        taxAmount += item.priceTotal * 0.10;
      });
    } else {
      activeOrders.forEach(order => {
        order.items.forEach(line => {
          items.push({
            name: line.name + (line.selectedExtras.length > 0 ? ` (${line.selectedExtras.map(e => e.optionName).join(", ")})` : ""),
            quantity: line.quantity,
            priceUnit: line.priceUnit,
            priceTotal: line.priceTotal
          });
          subtotal += line.priceTotal;
          taxAmount += line.priceTotal * (line.destination === "bar" ? 0.21 : 0.10);
        });
      });
    }

    const receipt = {
      id: `rec-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      tableId,
      tableName: table.name,
      sessionId,
      subtotal: parseFloat(subtotal.toFixed(2)),
      taxAmount: parseFloat(taxAmount.toFixed(2)),
      total: parseFloat(subtotal.toFixed(2)),
      timestamp: new Date().toISOString(),
      items,
      splitMethod: splitCalculationMethod || "completa"
    };

    // Guardar ticket cobrado en historial
    db.prepare("INSERT INTO closed_receipts (id, tableId, tableName, sessionId, subtotal, taxAmount, total, timestamp, items, splitMethod) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(
        receipt.id,
        receipt.tableId,
        receipt.tableName,
        receipt.sessionId,
        receipt.subtotal,
        receipt.taxAmount,
        receipt.total,
        receipt.timestamp,
        JSON.stringify(receipt.items),
        receipt.splitMethod
      );

    const isPartialPayment = splitCalculationMethod !== "completa" && (
      (!!customReceiptItems && customReceiptItems.length > 0) || splitCalculationMethod === "partes_iguales"
    );

    if (!isPartialPayment) {
      db.prepare("UPDATE orders SET status = 'servido' WHERE tableId = ? AND sessionId = ?").run(tableId, sessionId);
      this.updateTable(tableId, {
        status: "libre",
        activeSessionId: null,
        currentBillTotal: 0
      });
    } else {
      // Deduct paid items from active orders if this is split by lines
      if (customReceiptItems && customReceiptItems.length > 0 && splitCalculationMethod === "por_lineas") {
        db.transaction(() => {
          customReceiptItems.forEach(item => {
            let qtyRemainingToDeduct = item.quantity;
            const productId = item.productId;
            const notes = item.notes || "";
            const extrasStr = JSON.stringify(item.selectedExtras || []);

            // Find matching order_items lines in active orders
            const orderItems = db.prepare(`
              SELECT oi.* FROM order_items oi
              JOIN orders o ON oi.orderId = o.id
              WHERE o.tableId = ? AND o.sessionId = ? AND o.status != 'cancelado'
                AND oi.productId = ?
                AND (oi.notes = ? OR (oi.notes IS NULL AND ? = ''))
                AND oi.selectedExtras = ?
            `).all(tableId, sessionId, productId, notes, notes, extrasStr) as any[];

            for (const oi of orderItems) {
              if (qtyRemainingToDeduct <= 0) break;

              const deductQty = Math.min(qtyRemainingToDeduct, oi.quantity);
              const newQty = oi.quantity - deductQty;
              qtyRemainingToDeduct -= deductQty;

              if (newQty <= 0) {
                db.prepare("DELETE FROM order_items WHERE id = ?").run(oi.id);
              } else {
                const newPriceTotal = parseFloat((newQty * oi.priceUnit).toFixed(2));
                db.prepare("UPDATE order_items SET quantity = ?, priceTotal = ? WHERE id = ?").run(newQty, newPriceTotal, oi.id);
              }

              // Recalculate order totalAmount
              const orderItemsLeft = db.prepare("SELECT priceTotal FROM order_items WHERE orderId = ?").all(oi.orderId) as any[];
              const newOrderTotal = orderItemsLeft.reduce((sum, line) => sum + parseFloat(line.priceTotal || 0), 0);
              db.prepare("UPDATE orders SET totalAmount = ? WHERE id = ?").run(newOrderTotal, oi.orderId);

              // Cancel order if empty
              if (orderItemsLeft.length === 0) {
                db.prepare("DELETE FROM orders WHERE id = ?").run(oi.orderId);
              }
            }
          });
        })();
      }

      this.recalculateTableBillTotal(tableId);
    }

    return receipt;
  }

  // Métricas estadísticas para el Dashboard de Administración
  public getStats(): AdminStats {
    const history = this.getClosedReceipts();
    const activeTables = this.getTables().filter(t => t.status !== "libre");

    const totalSales = history.reduce((sum, r) => sum + r.total, 0);
    const activeTablesCount = activeTables.length;
    const totalTickets = history.length;
    const avgTicket = totalTickets > 0 ? parseFloat((totalSales / totalTickets).toFixed(2)) : 0;

    const productFrequency: { [key: string]: { qty: number, revenue: number } } = {};
    history.forEach(receipt => {
      receipt.items.forEach((item: any) => {
        const name = item.name;
        const qty = item.quantity || 1;
        const total = item.priceTotal || item.priceUnit * qty;
        if (!productFrequency[name]) {
          productFrequency[name] = { qty: 0, revenue: 0 };
        }
        productFrequency[name].qty += qty;
        productFrequency[name].revenue += total;
      });
    });

    const topProducts = Object.keys(productFrequency)
      .map(name => ({
        name,
        salesCount: productFrequency[name].qty,
        revenue: parseFloat(productFrequency[name].revenue.toFixed(2))
      }))
      .sort((a, b) => b.salesCount - a.salesCount)
      .slice(0, 5);

    const salesByHourMap: { [key: string]: number } = {};
    for (let h = 12; h <= 23; h++) {
      salesByHourMap[`${h}:00`] = 0;
    }
    
    history.forEach(receipt => {
      const date = new Date(receipt.timestamp);
      const hour = date.getHours();
      const label = `${hour}:00`;
      if (salesByHourMap[label] !== undefined) {
        salesByHourMap[label] += receipt.total;
      } else {
        salesByHourMap[label] = receipt.total;
      }
    });

    const salesByHour = Object.keys(salesByHourMap).map(hour => ({
      hour,
      sales: parseFloat(salesByHourMap[hour].toFixed(2))
    })).sort((a, b) => {
      const hA = parseInt(a.hour.split(":")[0]);
      const hB = parseInt(b.hour.split(":")[0]);
      return hA - hB;
    });

    return {
      totalSales: parseFloat(totalSales.toFixed(2)),
      activeTablesCount,
      avgTicket,
      topProducts,
      salesByHour,
      salesByTable: this.getSalesByTable()
    };
  }

  // Impresoras e historial de impresión
  public getPrinterConfig(): PrinterConfig {
    const row = db.prepare("SELECT * FROM printer_configs WHERE key = 'kitchen'").get() as any;
    if (!row) {
      return { ip: "192.168.1.100", port: 9100, name: "Impresora Cocina", enabled: false, printMode: "browser" };
    }
    return {
      ip: row.ip,
      port: row.port,
      name: row.name,
      enabled: row.enabled === 1,
      printMode: (row.print_mode as "server" | "browser") || "browser"
    };
  }

  public updatePrinterConfig(config: PrinterConfig) {
    db.prepare("INSERT OR REPLACE INTO printer_configs (key, ip, port, name, enabled, print_mode) VALUES ('kitchen', ?, ?, ?, ?, ?)")
      .run(config.ip, config.port, config.name, config.enabled ? 1 : 0, config.printMode || "browser");
    return config;
  }

  public getTicketPrinterConfig(): PrinterConfig {
    const row = db.prepare("SELECT * FROM printer_configs WHERE key = 'ticket'").get() as any;
    if (!row) {
      return { ip: "192.168.1.101", port: 9100, name: "Impresora Tickets", enabled: false, printMode: "browser" };
    }
    return {
      ip: row.ip,
      port: row.port,
      name: row.name,
      enabled: row.enabled === 1,
      printMode: (row.print_mode as "server" | "browser") || "browser"
    };
  }

  public updateTicketPrinterConfig(config: PrinterConfig) {
    db.prepare("INSERT OR REPLACE INTO printer_configs (key, ip, port, name, enabled, print_mode) VALUES ('ticket', ?, ?, ?, ?, ?)")
      .run(config.ip, config.port, config.name, config.enabled ? 1 : 0, config.printMode || "browser");
    return config;
  }

  public getPrintLogs(): PrintLog[] {
    const rows = db.prepare("SELECT * FROM print_logs ORDER BY timestamp DESC").all() as any[];
    return rows.map(r => ({
      id: r.id,
      orderId: r.orderId,
      zpl: r.zpl,
      status: r.status,
      errorMessage: r.errorMessage,
      retries: r.retries,
      timestamp: r.timestamp
    }));
  }

  public addPrintLog(log: Omit<PrintLog, "id" | "timestamp" | "retries">) {
    const newLog: PrintLog = {
      ...log,
      id: `print-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      retries: 0
    };
    db.prepare("INSERT INTO print_logs (id, orderId, zpl, status, errorMessage, retries, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(newLog.id, newLog.orderId, newLog.zpl, newLog.status, newLog.errorMessage, newLog.retries, newLog.timestamp);

    const logCount = db.prepare("SELECT count(*) as count FROM print_logs").get() as { count: number };
    if (logCount && logCount.count > 50) {
      // Eliminar logs antiguos
      db.prepare("DELETE FROM print_logs WHERE id NOT IN (SELECT id FROM print_logs ORDER BY timestamp DESC LIMIT 50)").run();
    }

    return newLog;
  }

  public updatePrintLog(id: string, updates: Partial<PrintLog>) {
    const fields = Object.keys(updates);
    if (fields.length === 0) return db.prepare("SELECT * FROM print_logs WHERE id = ?").get(id) as PrintLog;
    const setClause = fields.map(f => `${f} = ?`).join(", ");
    const values = Object.values(updates);
    db.prepare(`UPDATE print_logs SET ${setClause} WHERE id = ?`).run(...values, id);
    return db.prepare("SELECT * FROM print_logs WHERE id = ?").get(id) as PrintLog;
  }

  // Ventas agrupadas por mesa
  public getSalesByTable() {
    const history = this.getClosedReceipts();
    const tableMap: { [key: string]: { tableName: string; totalSales: number; ticketCount: number; lastTicket: string | null } } = {};
    
    history.forEach(r => {
      const key = r.tableName || r.tableId;
      if (!tableMap[key]) {
        tableMap[key] = { tableName: key, totalSales: 0, ticketCount: 0, lastTicket: null };
      }
      tableMap[key].totalSales += r.total;
      tableMap[key].ticketCount += 1;
      if (!tableMap[key].lastTicket || r.timestamp > tableMap[key].lastTicket!) {
        tableMap[key].lastTicket = r.timestamp;
      }
    });

    return Object.values(tableMap).map(t => ({
      ...t,
      totalSales: parseFloat(t.totalSales.toFixed(2))
    })).sort((a, b) => b.totalSales - a.totalSales);
  }

  // Historial de tickets cerrados
  public getClosedReceipts(): any[] {
    const rows = db.prepare("SELECT * FROM closed_receipts ORDER BY timestamp DESC").all() as any[];
    return rows.map(r => ({
      id: r.id,
      tableId: r.tableId,
      tableName: r.tableName,
      sessionId: r.sessionId,
      subtotal: parseFloat(r.subtotal || 0),
      taxAmount: parseFloat(r.taxAmount || 0),
      total: parseFloat(r.total || 0),
      timestamp: r.timestamp,
      items: JSON.parse(r.items || "[]"),
      splitMethod: r.splitMethod
    }));
  }

  // Plantilla de ticket personalizable
  public getTicketTemplate(): TicketTemplate {
    try {
      const r = db.prepare("SELECT * FROM ticket_template WHERE id = 1").get() as any;
      if (!r) {
        return this.defaultTemplate();
      }
      return {
        businessName: r.business_name,
        headerTitle: r.header_title,
        footerThanks: r.footer_thanks,
        footerUrl: r.footer_url,
        kitchenHeader: r.kitchen_header,
        kitchenFooter: r.kitchen_footer,
        labelCant: r.label_cant,
        labelDescripcion: r.label_descripcion,
        labelTotal: r.label_total,
        labelFactura: r.label_factura,
        labelMesa: r.label_mesa,
        labelTicket: r.label_ticket,
        labelMetodoPago: r.label_metodo_pago,
        labelSubtotal: r.label_subtotal,
        labelIva: r.label_iva,
        labelTotalFinal: r.label_total_final,
        paperWidth: r.paper_width,
        paperHeight: r.paper_height
      };
    } catch {
      return this.defaultTemplate();
    }
  }

  private defaultTemplate(): TicketTemplate {
    return {
      businessName: "GASTRO-OS",
      headerTitle: "TICKET DE CUENTA",
      footerThanks: "!Muchas gracias por su visita!",
      footerUrl: "GastroOS - GastroOS.com",
      kitchenHeader: "COMANDA DE COCINA",
      kitchenFooter: "Servicio de Comanda Unificado",
      labelCant: "CANT",
      labelDescripcion: "DESCRIPCION",
      labelTotal: "TOTAL",
      labelFactura: "Factura",
      labelMesa: "Mesa",
      labelTicket: "Ticket #",
      labelMetodoPago: "Metodo Pago",
      labelSubtotal: "Subtotal",
      labelIva: "IVA Incluido",
      labelTotalFinal: "TOTAL",
      paperWidth: 10.45,
      paperHeight: 14.50
    };
  }

  public updateTicketTemplate(config: Partial<TicketTemplate>): TicketTemplate {
    const fields: string[] = [];
    const values: any[] = [];
    const map: Record<string, string> = {
      businessName: "business_name",
      headerTitle: "header_title",
      footerThanks: "footer_thanks",
      footerUrl: "footer_url",
      kitchenHeader: "kitchen_header",
      kitchenFooter: "kitchen_footer",
      labelCant: "label_cant",
      labelDescripcion: "label_descripcion",
      labelTotal: "label_total",
      labelFactura: "label_factura",
      labelMesa: "label_mesa",
      labelTicket: "label_ticket",
      labelMetodoPago: "label_metodo_pago",
      labelSubtotal: "label_subtotal",
      labelIva: "label_iva",
      labelTotalFinal: "label_total_final",
      paperWidth: "paper_width",
      paperHeight: "paper_height"
    };
    for (const [key, col] of Object.entries(map)) {
      if ((config as any)[key] !== undefined) {
        fields.push(`${col} = ?`);
        values.push((config as any)[key]);
      }
    }
    if (fields.length > 0) {
      values.push(1);
      db.prepare(`UPDATE ticket_template SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    }
    return this.getTicketTemplate();
  }

  public updateClosedReceipt(id: string, updates: any) {
    const finalUpdates = { ...updates };
    if (updates.items !== undefined) {
      finalUpdates.items = JSON.stringify(updates.items);
    }
    const fields = Object.keys(finalUpdates);
    if (fields.length === 0) return db.prepare("SELECT * FROM closed_receipts WHERE id = ?").get(id);
    const setClause = fields.map(f => `${f} = ?`).join(", ");
    const values = Object.values(finalUpdates);
    db.prepare(`UPDATE closed_receipts SET ${setClause} WHERE id = ?`).run(...values, id);
    return db.prepare("SELECT * FROM closed_receipts WHERE id = ?").get(id);
  }

  // Métodos para llamadas al camarero (Waiter Calls)
  public getPendingWaiterCalls(): WaiterCall[] {
    const rows = db.prepare("SELECT * FROM waiter_calls WHERE status = 'pending' ORDER BY timestamp ASC").all() as any[];
    return rows.map(r => ({
      id: r.id,
      tableId: r.tableId,
      tableName: r.tableName,
      reason: r.reason,
      status: r.status,
      timestamp: r.timestamp
    }));
  }

  public addWaiterCall(call: Omit<WaiterCall, "id" | "status" | "timestamp">): WaiterCall {
    const id = "call-" + crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const status = "pending";
    db.prepare(`
      INSERT INTO waiter_calls (id, tableId, tableName, reason, status, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, call.tableId, call.tableName, call.reason, status, timestamp);
    return {
      id,
      tableId: call.tableId,
      tableName: call.tableName,
      reason: call.reason as any,
      status,
      timestamp
    };
  }

  public resolveWaiterCall(id: string): boolean {
    const res = db.prepare("UPDATE waiter_calls SET status = 'resolved' WHERE id = ?").run(id);
    return res.changes > 0;
  }

  public deleteBillItem(tableId: string, productId: string, notes: string, selectedExtras: any[]): boolean {
    const table = this.getTableById(tableId);
    if (!table || !table.activeSessionId) return false;
    
    // Obtener pedidos activos de esta mesa en esta sesión
    const orders = db.prepare("SELECT * FROM orders WHERE tableId = ? AND sessionId = ? AND status != 'cancelado'").all(table.id) as any[];
    const extrasStr = JSON.stringify(selectedExtras || []);
    
    db.transaction(() => {
      orders.forEach(order => {
        const items = db.prepare(`
          SELECT * FROM order_items 
          WHERE orderId = ? AND productId = ? AND (notes = ? OR (notes IS NULL AND ? = '')) AND selectedExtras = ?
        `).all(order.id, productId, notes || "", notes || "", extrasStr) as any[];
        
        items.forEach(item => {
          db.prepare("DELETE FROM order_items WHERE id = ?").run(item.id);
          db.prepare("UPDATE orders SET totalAmount = MAX(0, totalAmount - ?) WHERE id = ?").run(item.priceTotal, order.id);
        });
        
        const count = db.prepare("SELECT count(*) as count FROM order_items WHERE orderId = ?").get(order.id) as { count: number };
        if (count && count.count === 0) {
          db.prepare("DELETE FROM orders WHERE id = ?").run(order.id);
        }
      });
      
      this.recalculateTableBillTotal(table.id);
    })();
    return true;
  }

  public updateBillItemNote(tableId: string, productId: string, oldNotes: string, selectedExtras: any[], newNotes: string): boolean {
    const table = this.getTableById(tableId);
    if (!table || !table.activeSessionId) return false;
    
    const orders = db.prepare("SELECT id FROM orders WHERE tableId = ? AND sessionId = ? AND status != 'cancelado'").all(table.id) as any[];
    const extrasStr = JSON.stringify(selectedExtras || []);
    
    db.transaction(() => {
      orders.forEach(order => {
        db.prepare(`
          UPDATE order_items 
          SET notes = ? 
          WHERE orderId = ? AND productId = ? AND (notes = ? OR (notes IS NULL AND ? = '')) AND selectedExtras = ?
        `).run(newNotes, order.id, productId, oldNotes || "", oldNotes || "", extrasStr);
      });
    })();
    return true;
  }

  public serveBillItem(tableId: string, productId: string, notes: string, selectedExtras: any[]): boolean {
    const table = this.getTableById(tableId);
    if (!table || !table.activeSessionId) return false;
    
    const orders = db.prepare("SELECT id FROM orders WHERE tableId = ? AND sessionId = ? AND status != 'cancelado'").all(table.id) as any[];
    const extrasStr = JSON.stringify(selectedExtras || []);
    
    db.transaction(() => {
      orders.forEach(order => {
        const item = db.prepare(`
          SELECT 1 FROM order_items 
          WHERE orderId = ? AND productId = ? AND (notes = ? OR (notes IS NULL AND ? = '')) AND selectedExtras = ?
        `).get(order.id, productId, notes || "", notes || "", extrasStr);
        
        if (item) {
          db.prepare("UPDATE orders SET status = 'servido' WHERE id = ?").run(order.id);
        }
      });
    })();
    return true;
  }

  // === Web Push Subscriptions ===

  public savePushSubscription(userId: string, role: string, subscription: { endpoint: string; keys: { p256dh: string; auth: string } }): void {
    const id = uid("push");
    db.prepare(`
      INSERT INTO push_subscriptions (id, userId, role, endpoint, p256dh, auth, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET userId = excluded.userId, role = excluded.role, p256dh = excluded.p256dh, auth = excluded.auth
    `).run(id, userId, role, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, new Date().toISOString());
  }

  public deletePushSubscription(endpoint: string): void {
    db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint);
  }

  public getPushSubscriptionsByRole(role: string): Array<{ endpoint: string; p256dh: string; auth: string }> {
    const rows = db.prepare("SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE role = ?").all(role) as any[];
    return rows;
  }

  public getAllPushSubscriptions(): Array<{ endpoint: string; p256dh: string; auth: string; role: string }> {
    return db.prepare("SELECT endpoint, p256dh, auth, role FROM push_subscriptions").all() as any[];
  }
}

function uid(prefix: string): string {
  const rand = crypto.randomBytes(4).toString("hex");
  const time = Date.now().toString(36);
  return `${prefix}-${time}-${rand}`;
}

export const dbInstance = new LocalDatabase();
