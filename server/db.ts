import fs from "fs";
import path from "path";
import crypto from "crypto";
import Database from "better-sqlite3";
import {
  User, Table, Category, Product, Order, OrderLine, PrintLog, PrinterConfig, AdminStats, OrderStatus, TicketTemplate, WaiterCall
} from "../src/types";
import { hashPassword, taxFromGross, verifyPassword } from "./security";
import { DEMO_CATEGORIES, DEMO_PRODUCTS_FULL, DEMO_TABLES } from "./seed-data";

export { hashPassword, verifyPassword } from "./security";

const DB_DIR = process.env.DB_DIR ? path.resolve(process.env.DB_DIR) : path.join(process.cwd(), "data");
const DB_FILE = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.join(DB_DIR, "restaurante.db");

if (!fs.existsSync(path.dirname(DB_FILE))) {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
}

function createDbConnection(): Database.Database {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const connection = new Database(DB_FILE);
      connection.pragma("journal_mode = WAL");
      connection.pragma("busy_timeout = 5000");
      connection.pragma("foreign_keys = ON");
      return connection;
    } catch (error: any) {
      lastError = error;
      console.error(`[DB] Intento ${attempt}/5 falló: ${error.message}`);
      if (attempt < 5) {
        const deadline = Date.now() + attempt * 1000;
        while (Date.now() < deadline) { /* espera bloqueante de arranque */ }
      }
    }
  }
  throw lastError || new Error("No se pudo abrir la base de datos");
}

const db = createDbConnection();

const SEED_DEMO = process.env.SEED_DEMO !== "false";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_NAME = process.env.ADMIN_NAME || "Administrador General";

function resolveAdminPassword(): string {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  if (process.env.NODE_ENV === "production") {
    throw new Error("[Security] ADMIN_PASSWORD es obligatorio para crear la cuenta inicial en producción.");
  }
  return "admin123";
}

interface OrderFilters {
  tableId?: string;
  sessionId?: string;
  status?: string;
  station?: string;
  active?: boolean;
  limit?: number;
}

interface ClosedReceiptFilters {
  from?: string;
  to?: string;
  limit?: number;
}

class LocalDatabase {
  constructor() {
    this.init();
  }

  private init() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE,
        name TEXT,
        role TEXT,
        passwordHash TEXT,
        tokenVersion INTEGER DEFAULT 1,
        createdAt TEXT
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
        height INTEGER,
        assignedWaiterId TEXT,
        assignedWaiterName TEXT,
        sessionStartedAt TEXT,
        zone TEXT
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
        modifierGroups TEXT,
        station TEXT DEFAULT 'cocina'
      );

      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        tableId TEXT,
        tableName TEXT,
        sessionId TEXT,
        timestamp TEXT,
        status TEXT,
        totalAmount REAL,
        openedAt TEXT,
        closedAt TEXT
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
        destination TEXT,
        taxRate REAL DEFAULT 10,
        stationStatus TEXT DEFAULT 'pendiente'
      );

      CREATE TABLE IF NOT EXISTS printer_configs (
        key TEXT PRIMARY KEY,
        ip TEXT,
        port INTEGER,
        name TEXT,
        enabled INTEGER,
        print_mode TEXT DEFAULT 'browser'
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
        splitMethod TEXT,
        invoiceNumber INTEGER,
        paymentMethod TEXT,
        closedBy TEXT,
        openedAt TEXT,
        taxBreakdown TEXT
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

      CREATE TABLE IF NOT EXISTS sequences (
        name TEXT PRIMARY KEY,
        value INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS revoked_tokens (
        jti TEXT PRIMARY KEY,
        expiresAt INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        actorId TEXT,
        actorName TEXT,
        action TEXT,
        entity TEXT,
        entityId TEXT,
        details TEXT,
        timestamp TEXT
      );

      CREATE TABLE IF NOT EXISTS event_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event TEXT NOT NULL,
        data TEXT NOT NULL,
        timestamp TEXT NOT NULL
      );
    `);

    this.ensureColumn("users", "tokenVersion", "tokenVersion INTEGER DEFAULT 1");
    this.ensureColumn("users", "createdAt", "createdAt TEXT");
    this.ensureColumn("tables", "assignedWaiterId", "assignedWaiterId TEXT");
    this.ensureColumn("tables", "assignedWaiterName", "assignedWaiterName TEXT");
    this.ensureColumn("tables", "sessionStartedAt", "sessionStartedAt TEXT");
    this.ensureColumn("tables", "zone", "zone TEXT");
    this.ensureColumn("tables", "width", "width INTEGER");
    this.ensureColumn("tables", "height", "height INTEGER");
    this.ensureColumn("products", "station", "station TEXT DEFAULT 'cocina'");
    this.ensureColumn("orders", "openedAt", "openedAt TEXT");
    this.ensureColumn("orders", "closedAt", "closedAt TEXT");
    this.ensureColumn("order_items", "taxRate", "taxRate REAL DEFAULT 10");
    this.ensureColumn("order_items", "stationStatus", "stationStatus TEXT DEFAULT 'pendiente'");
    this.ensureColumn("printer_configs", "print_mode", "print_mode TEXT DEFAULT 'browser'");
    this.ensureColumn("closed_receipts", "invoiceNumber", "invoiceNumber INTEGER");
    this.ensureColumn("closed_receipts", "paymentMethod", "paymentMethod TEXT");
    this.ensureColumn("closed_receipts", "closedBy", "closedBy TEXT");
    this.ensureColumn("closed_receipts", "openedAt", "openedAt TEXT");
    this.ensureColumn("closed_receipts", "taxBreakdown", "taxBreakdown TEXT");

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_orders_table_session ON orders(tableId, sessionId, status);
      CREATE INDEX IF NOT EXISTS idx_orders_timestamp ON orders(timestamp);
      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
      CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(orderId);
      CREATE INDEX IF NOT EXISTS idx_order_items_station ON order_items(destination, stationStatus);
      CREATE INDEX IF NOT EXISTS idx_receipts_session ON closed_receipts(sessionId);
      CREATE INDEX IF NOT EXISTS idx_receipts_timestamp ON closed_receipts(timestamp);
      CREATE INDEX IF NOT EXISTS idx_calls_status ON waiter_calls(status);
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
    `);

    const tmplCount = db.prepare("SELECT count(*) AS count FROM ticket_template").get() as { count: number };
    if (tmplCount.count === 0) {
      db.prepare("INSERT INTO ticket_template (id) VALUES (1)").run();
    }

    this.seed();
  }

  private ensureColumn(table: string, column: string, definition: string) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((entry) => entry.name === column)) {
      try {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
      } catch {
        // Otro proceso puede haber aplicado la migración al mismo tiempo.
      }
    }
  }

  private seed() {
    const insertUser = db.prepare("INSERT OR IGNORE INTO users (id, username, name, role, passwordHash, tokenVersion, createdAt) VALUES (?, ?, ?, ?, ?, 1, ?)");
    const now = new Date().toISOString();

    if (!db.prepare("SELECT 1 FROM users WHERE id = 'usr-admin'").get()) {
      insertUser.run("usr-admin", ADMIN_USERNAME, ADMIN_NAME, "admin", hashPassword(resolveAdminPassword()), now);
    }

    if (SEED_DEMO) {
      if (!db.prepare("SELECT 1 FROM users WHERE username = 'camarero1'").get()) {
        insertUser.run("usr-camarero", "camarero1", "Camarero de Demostración", "camarero", hashPassword("camarero123"), now);
      }
      if (!db.prepare("SELECT 1 FROM users WHERE username = 'cocina1'").get()) {
        insertUser.run("usr-cocina", "cocina1", "Cocina de Demostración", "cocina", hashPassword("cocina123"), now);
      }
      if (!db.prepare("SELECT 1 FROM users WHERE username = 'bar1'").get()) {
        insertUser.run("usr-bar", "bar1", "Barra de Demostración", "bar", hashPassword("bar123"), now);
      }
    }

    if (SEED_DEMO) {
      const categoryCount = db.prepare("SELECT count(*) AS count FROM categories").get() as { count: number };
      if (categoryCount.count === 0) {
        const insertCategory = db.prepare("INSERT OR IGNORE INTO categories (id, name, description, icon) VALUES (?, ?, ?, ?)");
        for (const category of DEMO_CATEGORIES) {
          insertCategory.run(category.id, category.name, category.description || "", category.icon || "Utensils");
        }
        const insertProduct = db.prepare("INSERT OR IGNORE INTO products (id, categoryId, name, description, price, image, allergens, iva, available, stock, modifierGroups, station) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
        for (const product of DEMO_PRODUCTS_FULL) {
          insertProduct.run(
            product.id,
            product.categoryId,
            product.name,
            product.description,
            product.price,
            product.image || "default.jpg",
            JSON.stringify(product.allergens || []),
            product.iva,
            product.available ? 1 : 0,
            product.stock,
            JSON.stringify(product.modifierGroups || []),
            product.station || "cocina"
          );
        }
      }

      const tableCount = db.prepare("SELECT count(*) AS count FROM tables").get() as { count: number };
      if (tableCount.count === 0) {
        const insertTable = db.prepare("INSERT OR IGNORE INTO tables (id, number, name, status, activeSessionId, qrCodeData, currentBillTotal, posX, posY, width, height, sessionStartedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
        for (const table of DEMO_TABLES) {
          insertTable.run(table.id, table.number, table.name, table.status, table.activeSessionId, table.qrCodeData, table.currentBillTotal, table.posX, table.posY, table.width, table.height, table.sessionStartedAt);
        }
      }
    }

    const printerCount = db.prepare("SELECT count(*) AS count FROM printer_configs").get() as { count: number };
    if (printerCount.count === 0) {
      const insertPrinter = db.prepare("INSERT INTO printer_configs (key, ip, port, name, enabled, print_mode) VALUES (?, ?, ?, ?, ?, ?)");
      insertPrinter.run("kitchen", "192.168.1.100", 9100, "Impresora Cocina", 0, "browser");
      insertPrinter.run("ticket", "192.168.1.101", 9100, "Impresora Tickets", 0, "browser");
    }

    if (process.env.NODE_ENV === "production" && SEED_DEMO) {
      console.warn("[Security] SEED_DEMO está activo en producción. Desactívalo cuando cargues datos reales.");
    }
  }

  public getUsers(): User[] {
    const rows = db.prepare("SELECT * FROM users").all() as any[];
    return rows.map((row) => ({
      id: row.id,
      username: row.username,
      role: row.role,
      name: row.name,
      passwordHash: row.passwordHash,
      tokenVersion: row.tokenVersion ?? 1
    }));
  }

  public getUserById(id: string): User | undefined {
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as any;
    if (!row) return undefined;
    return {
      id: row.id,
      username: row.username,
      role: row.role,
      name: row.name,
      passwordHash: row.passwordHash,
      tokenVersion: row.tokenVersion ?? 1
    };
  }

  public getUserByUsername(username: string): User | undefined {
    const row = db.prepare("SELECT * FROM users WHERE lower(username) = lower(?)").get(username) as any;
    if (!row) return undefined;
    return {
      id: row.id,
      username: row.username,
      role: row.role,
      name: row.name,
      passwordHash: row.passwordHash,
      tokenVersion: row.tokenVersion ?? 1
    };
  }

  public addUser(user: User & { passwordHash: string }) {
    db.prepare("INSERT INTO users (id, username, name, role, passwordHash, tokenVersion, createdAt) VALUES (?, ?, ?, ?, ?, 1, ?)")
      .run(user.id, user.username, user.name, user.role, user.passwordHash, new Date().toISOString());
  }

  public updateUser(id: string, updates: Partial<User>) {
    const columns: Record<string, string> = {
      username: "username",
      name: "name",
      role: "role",
      passwordHash: "passwordHash",
      tokenVersion: "tokenVersion"
    };
    const fields: string[] = [];
    const values: any[] = [];
    for (const [key, column] of Object.entries(columns)) {
      if ((updates as any)[key] !== undefined) {
        fields.push(`${column} = ?`);
        values.push((updates as any)[key]);
      }
    }
    if (fields.length === 0) return this.getUserById(id);
    values.push(id);
    db.prepare(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    return this.getUserById(id);
  }

  public bumpTokenVersion(id: string): number {
    db.prepare("UPDATE users SET tokenVersion = COALESCE(tokenVersion, 1) + 1 WHERE id = ?").run(id);
    const row = db.prepare("SELECT tokenVersion FROM users WHERE id = ?").get(id) as any;
    return row?.tokenVersion ?? 1;
  }

  public deleteUser(id: string): boolean {
    if (id === "usr-admin") return false;
    const target = this.getUserById(id);
    if (!target) return false;
    if (target.role === "admin") {
      const admins = db.prepare("SELECT count(*) AS count FROM users WHERE role = 'admin'").get() as { count: number };
      if (admins.count <= 1) return false;
    }
    db.prepare("DELETE FROM users WHERE id = ?").run(id);
    return true;
  }

  public revokeToken(jti: string, expiresAt: number) {
    db.prepare("INSERT OR REPLACE INTO revoked_tokens (jti, expiresAt) VALUES (?, ?)").run(jti, expiresAt);
  }

  public isTokenRevoked(jti: string): boolean {
    const row = db.prepare("SELECT jti FROM revoked_tokens WHERE jti = ?").get(jti);
    return !!row;
  }

  public cleanupRevokedTokens() {
    db.prepare("DELETE FROM revoked_tokens WHERE expiresAt < ?").run(Math.floor(Date.now() / 1000));
  }

  public nextSequence(name: string, initial = 1000): number {
    return db.transaction(() => {
      const row = db.prepare("SELECT value FROM sequences WHERE name = ?").get(name) as any;
      const next = row ? row.value + 1 : initial;
      if (row) {
        db.prepare("UPDATE sequences SET value = ? WHERE name = ?").run(next, name);
      } else {
        db.prepare("INSERT INTO sequences (name, value) VALUES (?, ?)").run(name, next);
      }
      return next;
    })();
  }

  public logAudit(entry: { actorId?: string; actorName?: string; action: string; entity: string; entityId?: string; details?: unknown }) {
    db.prepare("INSERT INTO audit_log (id, actorId, actorName, action, entity, entityId, details, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(
        `audit-${crypto.randomUUID()}`,
        entry.actorId || null,
        entry.actorName || null,
        entry.action,
        entry.entity,
        entry.entityId || null,
        JSON.stringify(entry.details ?? {}),
        new Date().toISOString()
      );
  }

  public getAuditLogs(limit = 200) {
    return db.prepare("SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?").all(Math.min(Math.max(limit, 1), 1000));
  }

  public getTables(): Table[] {
    const rows = db.prepare("SELECT * FROM tables ORDER BY number ASC").all() as any[];
    return rows.map((row) => ({
      id: row.id,
      number: row.number,
      name: row.name,
      status: row.status,
      activeSessionId: row.activeSessionId,
      qrCodeData: row.qrCodeData,
      currentBillTotal: parseFloat(row.currentBillTotal || 0),
      posX: row.posX,
      posY: row.posY,
      width: row.width,
      height: row.height,
      assignedWaiterId: row.assignedWaiterId,
      assignedWaiterName: row.assignedWaiterName,
      sessionStartedAt: row.sessionStartedAt
    }));
  }

  public getTableById(id: string): Table | undefined {
    const row = db.prepare("SELECT * FROM tables WHERE id = ?").get(id) as any;
    if (!row) return undefined;
    return {
      id: row.id,
      number: row.number,
      name: row.name,
      status: row.status,
      activeSessionId: row.activeSessionId,
      qrCodeData: row.qrCodeData,
      currentBillTotal: parseFloat(row.currentBillTotal || 0),
      posX: row.posX,
      posY: row.posY,
      width: row.width,
      height: row.height,
      assignedWaiterId: row.assignedWaiterId,
      assignedWaiterName: row.assignedWaiterName,
      sessionStartedAt: row.sessionStartedAt
    };
  }

  public updateTable(id: string, updates: Partial<Table>) {
    const columns: Record<string, string> = {
      name: "name",
      status: "status",
      activeSessionId: "activeSessionId",
      qrCodeData: "qrCodeData",
      currentBillTotal: "currentBillTotal",
      posX: "posX",
      posY: "posY",
      width: "width",
      height: "height",
      assignedWaiterId: "assignedWaiterId",
      assignedWaiterName: "assignedWaiterName",
      sessionStartedAt: "sessionStartedAt",
      zone: "zone"
    };
    const fields: string[] = [];
    const values: any[] = [];
    for (const [key, column] of Object.entries(columns)) {
      if ((updates as any)[key] !== undefined) {
        fields.push(`${column} = ?`);
        values.push((updates as any)[key]);
      }
    }
    if (fields.length === 0) return this.getTableById(id);
    values.push(id);
    db.prepare(`UPDATE tables SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    return this.getTableById(id);
  }

  public createTable(table: { number: number; name: string; appUrl: string; qrCodeData: string }) {
    const tableId = `table-${table.number}`;
    const col = (table.number - 1) % 4;
    const row = Math.floor((table.number - 1) / 4);

    const newTable: Table = {
      id: tableId,
      number: table.number,
      name: table.name,
      status: "libre",
      activeSessionId: null,
      qrCodeData: table.qrCodeData,
      currentBillTotal: 0,
      posX: 80 + col * 205,
      posY: 70 + row * 190,
      width: 150,
      height: 110,
      assignedWaiterId: null,
      assignedWaiterName: null,
      sessionStartedAt: null
    };

    db.prepare("INSERT INTO tables (id, number, name, status, activeSessionId, qrCodeData, currentBillTotal, posX, posY, width, height, sessionStartedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(newTable.id, newTable.number, newTable.name, newTable.status, newTable.activeSessionId, newTable.qrCodeData, newTable.currentBillTotal, newTable.posX, newTable.posY, newTable.width, newTable.height, newTable.sessionStartedAt);

    return newTable;
  }

  public deleteTable(id: string): boolean {
    const table = this.getTableById(id);
    if (!table || table.activeSessionId) return false;
    const result = db.prepare("DELETE FROM tables WHERE id = ?").run(id);
    return result.changes > 0;
  }

  public getCategories(): Category[] {
    return db.prepare("SELECT * FROM categories ORDER BY name ASC").all() as Category[];
  }

  public createCategory(category: Omit<Category, "id">) {
    const newCategory: Category = { ...category, id: `cat-${crypto.randomUUID()}` };
    db.prepare("INSERT OR IGNORE INTO categories (id, name, description, icon) VALUES (?, ?, ?, ?)")
      .run(newCategory.id, newCategory.name, newCategory.description, newCategory.icon);
    return newCategory;
  }

  public updateCategory(id: string, updates: Partial<Category>) {
    const fields: string[] = [];
    const values: any[] = [];
    for (const key of ["name", "description", "icon"] as const) {
      if ((updates as any)[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push((updates as any)[key]);
      }
    }
    if (fields.length === 0) return db.prepare("SELECT * FROM categories WHERE id = ?").get(id) as Category;
    values.push(id);
    db.prepare(`UPDATE categories SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    return db.prepare("SELECT * FROM categories WHERE id = ?").get(id) as Category;
  }

  public deleteCategory(id: string): boolean {
    return db.transaction(() => {
      const result = db.prepare("DELETE FROM categories WHERE id = ?").run(id);
      if (result.changes === 0) return false;
      db.prepare("DELETE FROM products WHERE categoryId = ?").run(id);
      return true;
    })();
  }

  public getProducts(): Product[] {
    const rows = db.prepare("SELECT * FROM products ORDER BY name ASC").all() as any[];
    return rows.map((row) => this.mapProduct(row));
  }

  public getProductById(id: string): Product | undefined {
    const row = db.prepare("SELECT * FROM products WHERE id = ?").get(id) as any;
    return row ? this.mapProduct(row) : undefined;
  }

  private mapProduct(row: any): Product {
    return {
      id: row.id,
      categoryId: row.categoryId,
      name: row.name,
      description: row.description,
      price: parseFloat(row.price || 0),
      image: row.image,
      allergens: JSON.parse(row.allergens || "[]"),
      iva: Number(row.iva ?? 10),
      available: row.available === 1,
      stock: row.stock === null || row.stock === undefined ? null : Number(row.stock),
      modifierGroups: JSON.parse(row.modifierGroups || "[]"),
      station: row.station === "bar" ? "bar" : "cocina"
    };
  }

  public createProduct(product: Product) {
    db.prepare("INSERT INTO products (id, categoryId, name, description, price, image, allergens, iva, available, stock, modifierGroups, station) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
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
        JSON.stringify(product.modifierGroups || []),
        product.station || "cocina"
      );
    return product;
  }

  public updateProduct(id: string, updates: Partial<Product>) {
    const columns: Record<string, string> = {
      categoryId: "categoryId",
      name: "name",
      description: "description",
      price: "price",
      image: "image",
      iva: "iva",
      stock: "stock",
      station: "station"
    };
    const fields: string[] = [];
    const values: any[] = [];
    for (const [key, column] of Object.entries(columns)) {
      if ((updates as any)[key] !== undefined) {
        fields.push(`${column} = ?`);
        values.push((updates as any)[key]);
      }
    }
    if (updates.allergens !== undefined) {
      fields.push("allergens = ?");
      values.push(JSON.stringify(updates.allergens));
    }
    if (updates.modifierGroups !== undefined) {
      fields.push("modifierGroups = ?");
      values.push(JSON.stringify(updates.modifierGroups));
    }
    if (updates.available !== undefined) {
      fields.push("available = ?");
      values.push(updates.available ? 1 : 0);
    }
    if (fields.length === 0) return this.getProductById(id);
    values.push(id);
    db.prepare(`UPDATE products SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    return this.getProductById(id);
  }

  public deleteProduct(id: string): boolean {
    const result = db.prepare("DELETE FROM products WHERE id = ?").run(id);
    return result.changes > 0;
  }

  public importCatalog(mode: "replace" | "append", items: any[]): { success: boolean; count: number } {
    const executeTransaction = db.transaction((importMode: "replace" | "append", productsList: any[]) => {
      if (importMode === "replace") {
        db.prepare("DELETE FROM products").run();
        db.prepare("DELETE FROM categories").run();
      }

      const existingCategories = db.prepare("SELECT * FROM categories").all() as any[];
      const categoryMap = new Map<string, string>();
      existingCategories.forEach((category) => categoryMap.set(category.name.toLowerCase(), category.id));

      let importedCount = 0;

      for (const item of productsList) {
        let categoryId = categoryMap.get(String(item.categoryName || "").toLowerCase());
        const categoryName = String(item.categoryName || "").trim();
        if (!categoryName || !String(item.name || "").trim()) continue;

        if (!categoryId) {
          categoryId = `cat-${crypto.randomUUID()}`;
          let icon = "Utensils";
          const lower = categoryName.toLowerCase();
          if (/(bebida|refresco|vino|bodega|cóctel|coctel)/.test(lower)) icon = "GlassWater";
          else if (/(carne|principal|plato|hamburguesa|pollo|pescado)/.test(lower)) icon = "Beef";
          else if (/(postre|dulce|helado|tarta)/.test(lower)) icon = "IceCream";
          else if (/(ensalada)/.test(lower)) icon = "Salad";
          else if (/(arroz)/.test(lower)) icon = "Wheat";
          else if (/(entrante|para empezar)/.test(lower)) icon = "Soup";

          db.prepare("INSERT OR IGNORE INTO categories (id, name, description, icon) VALUES (?, ?, ?, ?)")
            .run(categoryId, categoryName, `${categoryName} del menú`, icon);
          categoryMap.set(categoryName.toLowerCase(), categoryId);
        }

        const station = item.station === "bar" || /(bebida|refresco|vino|bodega|cóctel|coctel)/i.test(categoryName) ? "bar" : "cocina";
        const productId = `prod-${crypto.randomUUID()}`;
        db.prepare("INSERT INTO products (id, categoryId, name, description, price, image, allergens, iva, available, stock, modifierGroups, station) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .run(
            productId,
            categoryId,
            String(item.name).trim(),
            String(item.description || ""),
            Number(item.price) || 0,
            item.image || "default.jpg",
            JSON.stringify(item.allergens || []),
            Number(item.iva) || 10,
            item.available ? 1 : 0,
            item.stock === undefined ? null : item.stock,
            JSON.stringify([]),
            station
          );
        importedCount++;
      }

      return importedCount;
    });

    const count = executeTransaction(mode, items);
    return { success: true, count };
  }

  public getOrders(filters: OrderFilters = {}): Order[] {
    const clauses: string[] = [];
    const values: any[] = [];
    if (filters.tableId) {
      clauses.push("tableId = ?");
      values.push(filters.tableId);
    }
    if (filters.sessionId) {
      clauses.push("sessionId = ?");
      values.push(filters.sessionId);
    }
    if (filters.status) {
      clauses.push("status = ?");
      values.push(filters.status);
    }
    if (filters.active) {
      clauses.push("status NOT IN ('servido', 'cancelado')");
    }
    if (filters.station) {
      clauses.push("EXISTS (SELECT 1 FROM order_items oi WHERE oi.orderId = orders.id AND oi.destination = ?)");
      values.push(filters.station);
    }
    const limit = Math.min(Math.max(filters.limit ?? 500, 1), 1000);
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = db.prepare(`SELECT * FROM orders ${where} ORDER BY timestamp DESC LIMIT ?`).all(...values, limit) as any[];
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const placeholders = ids.map(() => "?").join(",");
    const itemRows = db.prepare(`SELECT * FROM order_items WHERE orderId IN (${placeholders}) ORDER BY rowid ASC`).all(...ids) as any[];
    const itemsByOrder = new Map<string, any[]>();
    for (const item of itemRows) {
      const list = itemsByOrder.get(item.orderId) || [];
      list.push(item);
      itemsByOrder.set(item.orderId, list);
    }
    return rows.map((row) => this.mapOrder(row, itemsByOrder.get(row.id) || []));
  }

  public getOrderById(id: string): Order | undefined {
    const row = db.prepare("SELECT * FROM orders WHERE id = ?").get(id) as any;
    if (!row) return undefined;
    const items = db.prepare("SELECT * FROM order_items WHERE orderId = ? ORDER BY rowid ASC").all(id) as any[];
    return this.mapOrder(row, items);
  }

  private mapOrder(row: any, items: any[]): Order {
    return {
      id: row.id,
      tableId: row.tableId,
      tableName: row.tableName,
      sessionId: row.sessionId,
      timestamp: row.timestamp,
      status: row.status as OrderStatus,
      totalAmount: parseFloat(row.totalAmount || 0),
      openedAt: row.openedAt || row.timestamp,
      closedAt: row.closedAt || null,
      items: items.map((item) => ({
        id: item.id,
        productId: item.productId,
        name: item.name,
        quantity: item.quantity,
        priceUnit: parseFloat(item.priceUnit || 0),
        priceTotal: parseFloat(item.priceTotal || 0),
        notes: item.notes,
        selectedExtras: JSON.parse(item.selectedExtras || "[]"),
        destination: item.destination,
        taxRate: Number(item.taxRate ?? 10),
        stationStatus: item.stationStatus || "pendiente"
      }))
    };
  }

  public createOrderAtomic(order: Order, stockNeeds: Array<{ productId: string; quantity: number }>) {
    const insertOrder = db.prepare("INSERT INTO orders (id, tableId, tableName, sessionId, timestamp, status, totalAmount, openedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    const insertItem = db.prepare("INSERT INTO order_items (id, orderId, productId, name, quantity, priceUnit, priceTotal, notes, selectedExtras, destination, taxRate, stationStatus) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");

    return db.transaction(() => {
      for (const need of stockNeeds) {
        const product = this.getProductById(need.productId);
        if (!product || product.stock === null) continue;
        if (need.quantity > product.stock) {
          throw new Error(`Stock insuficiente para ${product.name}. Quedan ${product.stock}`);
        }
        db.prepare("UPDATE products SET stock = ? WHERE id = ?").run(product.stock - need.quantity, product.id);
      }

      insertOrder.run(order.id, order.tableId, order.tableName, order.sessionId, order.timestamp, order.status, order.totalAmount, order.openedAt || order.timestamp);
      for (const item of order.items) {
        insertItem.run(
          item.id,
          order.id,
          item.productId,
          item.name,
          item.quantity,
          item.priceUnit,
          item.priceTotal,
          item.notes,
          JSON.stringify(item.selectedExtras || []),
          item.destination,
          item.taxRate ?? 10,
          item.stationStatus || "pendiente"
        );
      }

      const table = this.getTableById(order.tableId);
      if (table) {
        const activeSession = table.activeSessionId || order.sessionId;
        const sessionStartedAt = table.activeSessionId ? table.sessionStartedAt : order.timestamp;
        db.prepare("UPDATE tables SET status = 'ocupada', activeSessionId = ?, sessionStartedAt = ? WHERE id = ?")
          .run(activeSession, sessionStartedAt, order.tableId);
      }
      this.recalculateTableBillTotal(order.tableId);
      return order;
    })();
  }

  public createOrder(order: Order) {
    return this.createOrderAtomic(order, []);
  }

  public recalculateTableBillTotal(tableId: string) {
    const table = this.getTableById(tableId);
    if (!table || !table.activeSessionId) return;

    const sessionId = table.activeSessionId;
    const activeOrders = db.prepare("SELECT totalAmount FROM orders WHERE tableId = ? AND sessionId = ? AND status != 'cancelado'").all(tableId, sessionId) as any[];
    const sessionTotal = activeOrders.reduce((sum, order) => sum + parseFloat(order.totalAmount || 0), 0);
    const flatPaidQuery = db.prepare("SELECT SUM(total) AS sum FROM closed_receipts WHERE sessionId = ? AND splitMethod != 'por_lineas'").get(sessionId) as any;
    const flatPaidInSession = flatPaidQuery ? parseFloat(flatPaidQuery.sum || 0) : 0;
    const remainingTotal = Math.max(0, sessionTotal - flatPaidInSession);

    if (remainingTotal === 0) {
      db.prepare("UPDATE tables SET currentBillTotal = 0, status = 'libre', activeSessionId = NULL, sessionStartedAt = NULL WHERE id = ?").run(tableId);
    } else {
      db.prepare("UPDATE tables SET currentBillTotal = ? WHERE id = ?").run(parseFloat(remainingTotal.toFixed(2)), tableId);
    }
  }

  private cancelOrderStock(order: Order) {
    for (const item of order.items) {
      const product = this.getProductById(item.productId);
      if (product && product.stock !== null) {
        db.prepare("UPDATE products SET stock = ? WHERE id = ?").run(product.stock + item.quantity, product.id);
      }
    }
  }

  private deriveOrderStatus(orderId: string): OrderStatus {
    const items = db.prepare("SELECT stationStatus FROM order_items WHERE orderId = ?").all(orderId) as any[];
    if (items.length === 0) return "cancelado";
    if (items.every((item) => item.stationStatus === "cancelado")) return "cancelado";
    const active = items.filter((item) => item.stationStatus !== "cancelado");
    if (active.every((item) => item.stationStatus === "servido")) return "servido";
    if (active.every((item) => item.stationStatus === "listo" || item.stationStatus === "servido")) return "listo";
    if (active.some((item) => item.stationStatus === "en_preparacion")) return "en_preparacion";
    return "pendiente";
  }

  public updateOrderStatus(orderId: string, status: OrderStatus, station?: string) {
    const order = this.getOrderById(orderId);
    if (!order) return null;
    if (order.status === "cancelado" && status !== "cancelado") return null;

    db.transaction(() => {
      if (status === "cancelado") {
        if (order.status !== "cancelado") this.cancelOrderStock(order);
        db.prepare("UPDATE order_items SET stationStatus = 'cancelado' WHERE orderId = ?").run(orderId);
        db.prepare("UPDATE orders SET status = 'cancelado', closedAt = ? WHERE id = ?").run(new Date().toISOString(), orderId);
      } else if (station === "cocina" || station === "bar") {
        db.prepare("UPDATE order_items SET stationStatus = ? WHERE orderId = ? AND destination = ? AND stationStatus != 'cancelado'")
          .run(status, orderId, station);
        const derived = this.deriveOrderStatus(orderId);
        db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(derived, orderId);
      } else {
        db.prepare("UPDATE order_items SET stationStatus = ? WHERE orderId = ? AND stationStatus != 'cancelado'").run(status, orderId);
        db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(status, orderId);
      }
    })();

    const table = this.getTableById(order.tableId);
    if (table && table.activeSessionId === order.sessionId) {
      this.recalculateTableBillTotal(order.tableId);
    }
    return this.getOrderById(orderId);
  }

  public closeTableSession(
    tableId: string,
    customReceiptItems?: any[],
    splitCalculationMethod?: string,
    meta?: { paymentMethod?: string; closedBy?: string }
  ) {
    const table = this.getTableById(tableId);
    if (!table || !table.activeSessionId) return null;

    const sessionId = table.activeSessionId;
    const activeOrders = this.getOrders({ tableId, sessionId }).filter((order) => order.status !== "cancelado");

    if (activeOrders.length === 0 && (!customReceiptItems || customReceiptItems.length === 0)) {
      this.updateTable(tableId, { status: "libre", activeSessionId: null, currentBillTotal: 0, sessionStartedAt: null });
      return { success: true, empty: true };
    }

    const items: any[] = [];
    const taxBreakdown: Record<string, number> = {};
    let subtotal = 0;
    let taxAmount = 0;

    const addItem = (item: any, rate: number) => {
      const gross = Number(item.priceTotal) || 0;
      const tax = taxFromGross(gross, rate);
      items.push({
        productId: item.productId,
        name: item.name,
        quantity: item.quantity,
        priceUnit: item.priceUnit,
        priceTotal: gross,
        taxRate: rate,
        notes: item.notes || "",
        selectedExtras: item.selectedExtras || []
      });
      subtotal += gross;
      taxAmount += tax;
      const key = String(rate);
      taxBreakdown[key] = Math.round(((taxBreakdown[key] || 0) + tax) * 100) / 100;
    };

    if (customReceiptItems && customReceiptItems.length > 0) {
      for (const item of customReceiptItems) {
        const product = item.productId ? this.getProductById(item.productId) : null;
        const parsedRate = Number(item.taxRate);
        const rate = product?.iva ?? (Number.isFinite(parsedRate) ? parsedRate : 10);
        addItem(item, rate);
      }
    } else {
      for (const order of activeOrders) {
        for (const line of order.items) {
          addItem(
            {
              ...line,
              name: line.name + (line.selectedExtras.length > 0 ? ` (${line.selectedExtras.map((extra) => extra.optionName).join(", ")})` : "")
            },
            line.taxRate ?? (line.destination === "bar" ? 21 : 10)
          );
        }
      }
    }

    const receipt = {
      id: `rec-${crypto.randomUUID()}`,
      tableId,
      tableName: table.name,
      sessionId,
      invoiceNumber: this.nextSequence("invoice", 1),
      subtotal: parseFloat(subtotal.toFixed(2)),
      taxAmount: parseFloat(taxAmount.toFixed(2)),
      total: parseFloat(subtotal.toFixed(2)),
      timestamp: new Date().toISOString(),
      openedAt: table.sessionStartedAt || null,
      items,
      taxBreakdown,
      splitMethod: splitCalculationMethod || "completa",
      paymentMethod: meta?.paymentMethod || "efectivo",
      closedBy: meta?.closedBy || null
    };

    db.prepare(`
      INSERT INTO closed_receipts
      (id, tableId, tableName, sessionId, subtotal, taxAmount, total, timestamp, items, splitMethod, invoiceNumber, paymentMethod, closedBy, openedAt, taxBreakdown)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      receipt.id,
      receipt.tableId,
      receipt.tableName,
      receipt.sessionId,
      receipt.subtotal,
      receipt.taxAmount,
      receipt.total,
      receipt.timestamp,
      JSON.stringify(receipt.items),
      receipt.splitMethod,
      receipt.invoiceNumber,
      receipt.paymentMethod,
      receipt.closedBy,
      receipt.openedAt,
      JSON.stringify(receipt.taxBreakdown)
    );

    const isPartialPayment = splitCalculationMethod !== "completa" && (
      (!!customReceiptItems && customReceiptItems.length > 0) || splitCalculationMethod === "partes_iguales"
    );

    if (!isPartialPayment) {
      db.prepare("UPDATE orders SET status = 'servido', closedAt = ? WHERE tableId = ? AND sessionId = ?").run(receipt.timestamp, tableId, sessionId);
      db.prepare("UPDATE order_items SET stationStatus = 'servido' WHERE orderId IN (SELECT id FROM orders WHERE tableId = ? AND sessionId = ?)").run(tableId, sessionId);
      this.updateTable(tableId, { status: "libre", activeSessionId: null, currentBillTotal: 0, sessionStartedAt: null });
    } else {
      if (customReceiptItems && customReceiptItems.length > 0 && splitCalculationMethod === "por_lineas") {
        db.transaction(() => {
          for (const item of customReceiptItems) {
            let qtyRemainingToDeduct = item.quantity;
            const productId = item.productId;
            const notes = item.notes || "";
            const extrasStr = JSON.stringify(item.selectedExtras || []);
            const orderItems = db.prepare(`
              SELECT oi.* FROM order_items oi
              JOIN orders o ON oi.orderId = o.id
              WHERE o.tableId = ? AND o.sessionId = ? AND o.status != 'cancelado'
                AND oi.productId = ?
                AND (oi.notes = ? OR (oi.notes IS NULL AND ? = ''))
                AND oi.selectedExtras = ?
            `).all(tableId, sessionId, productId, notes, notes, extrasStr) as any[];

            for (const orderItem of orderItems) {
              if (qtyRemainingToDeduct <= 0) break;
              const deductQty = Math.min(qtyRemainingToDeduct, orderItem.quantity);
              const newQty = orderItem.quantity - deductQty;
              qtyRemainingToDeduct -= deductQty;
              if (newQty <= 0) {
                db.prepare("DELETE FROM order_items WHERE id = ?").run(orderItem.id);
              } else {
                const newPriceTotal = parseFloat((newQty * orderItem.priceUnit).toFixed(2));
                db.prepare("UPDATE order_items SET quantity = ?, priceTotal = ? WHERE id = ?").run(newQty, newPriceTotal, orderItem.id);
              }
              const orderItemsLeft = db.prepare("SELECT priceTotal FROM order_items WHERE orderId = ?").all(orderItem.orderId) as any[];
              const newOrderTotal = orderItemsLeft.reduce((sum, line) => sum + parseFloat(line.priceTotal || 0), 0);
              db.prepare("UPDATE orders SET totalAmount = ? WHERE id = ?").run(newOrderTotal, orderItem.orderId);
              if (orderItemsLeft.length === 0) {
                db.prepare("DELETE FROM orders WHERE id = ?").run(orderItem.orderId);
              }
            }
          }
        })();
      }

      this.recalculateTableBillTotal(tableId);
      const after = this.getTableById(tableId);
      if (after?.activeSessionId) {
        db.prepare("UPDATE tables SET status = 'pendiente_pago' WHERE id = ?").run(tableId);
      } else {
        db.prepare("UPDATE orders SET status = 'servido', closedAt = ? WHERE tableId = ? AND sessionId = ? AND status != 'cancelado'").run(receipt.timestamp, tableId, sessionId);
        db.prepare("UPDATE order_items SET stationStatus = 'servido' WHERE orderId IN (SELECT id FROM orders WHERE tableId = ? AND sessionId = ?)").run(tableId, sessionId);
      }
    }

    return receipt;
  }

  public getStats(filters: ClosedReceiptFilters = {}): AdminStats {
    const history = this.getClosedReceipts(filters);
    const activeTables = this.getTables().filter((table) => table.status !== "libre");
    const totalSales = history.reduce((sum, receipt) => sum + receipt.total, 0);
    const totalTickets = history.length;
    const avgTicket = totalTickets > 0 ? parseFloat((totalSales / totalTickets).toFixed(2)) : 0;

    const productFrequency: { [key: string]: { qty: number; revenue: number } } = {};
    history.forEach((receipt) => {
      receipt.items.forEach((item: any) => {
        const name = item.name;
        const qty = item.quantity || 1;
        const total = item.priceTotal || item.priceUnit * qty;
        if (!productFrequency[name]) productFrequency[name] = { qty: 0, revenue: 0 };
        productFrequency[name].qty += qty;
        productFrequency[name].revenue += total;
      });
    });

    const topProducts = Object.keys(productFrequency)
      .map((name) => ({ name, salesCount: productFrequency[name].qty, revenue: parseFloat(productFrequency[name].revenue.toFixed(2)) }))
      .sort((a, b) => b.salesCount - a.salesCount)
      .slice(0, 5);

    const salesByHourMap: { [key: string]: number } = {};
    for (let hour = 12; hour <= 23; hour++) salesByHourMap[`${hour}:00`] = 0;
    history.forEach((receipt) => {
      const hour = new Date(receipt.timestamp).getHours();
      const label = `${hour}:00`;
      salesByHourMap[label] = (salesByHourMap[label] || 0) + receipt.total;
    });

    const salesByHour = Object.keys(salesByHourMap)
      .map((hour) => ({ hour, sales: parseFloat(salesByHourMap[hour].toFixed(2)) }))
      .sort((a, b) => parseInt(a.hour) - parseInt(b.hour));

    return {
      totalSales: parseFloat(totalSales.toFixed(2)),
      activeTablesCount: activeTables.length,
      avgTicket,
      topProducts,
      salesByHour,
      salesByTable: this.getSalesByTable(filters)
    };
  }

  public getPrinterConfig(): PrinterConfig {
    const row = db.prepare("SELECT * FROM printer_configs WHERE key = 'kitchen'").get() as any;
    if (!row) return { ip: "192.168.1.100", port: 9100, name: "Impresora Cocina", enabled: false, printMode: "browser" };
    return { ip: row.ip, port: row.port, name: row.name, enabled: row.enabled === 1, printMode: (row.print_mode as "server" | "browser") || "browser" };
  }

  public updatePrinterConfig(config: PrinterConfig) {
    db.prepare("INSERT OR REPLACE INTO printer_configs (key, ip, port, name, enabled, print_mode) VALUES ('kitchen', ?, ?, ?, ?, ?)")
      .run(config.ip, config.port, config.name, config.enabled ? 1 : 0, config.printMode || "browser");
    return config;
  }

  public getTicketPrinterConfig(): PrinterConfig {
    const row = db.prepare("SELECT * FROM printer_configs WHERE key = 'ticket'").get() as any;
    if (!row) return { ip: "192.168.1.101", port: 9100, name: "Impresora Tickets", enabled: false, printMode: "browser" };
    return { ip: row.ip, port: row.port, name: row.name, enabled: row.enabled === 1, printMode: (row.print_mode as "server" | "browser") || "browser" };
  }

  public updateTicketPrinterConfig(config: PrinterConfig) {
    db.prepare("INSERT OR REPLACE INTO printer_configs (key, ip, port, name, enabled, print_mode) VALUES ('ticket', ?, ?, ?, ?, ?)")
      .run(config.ip, config.port, config.name, config.enabled ? 1 : 0, config.printMode || "browser");
    return config;
  }

  public getPrintLogs(): PrintLog[] {
    const rows = db.prepare("SELECT * FROM print_logs ORDER BY timestamp DESC").all() as any[];
    return rows.map((row) => ({
      id: row.id,
      orderId: row.orderId,
      zpl: row.zpl,
      status: row.status,
      errorMessage: row.errorMessage,
      retries: row.retries,
      timestamp: row.timestamp
    }));
  }

  public addPrintLog(log: Omit<PrintLog, "id" | "timestamp" | "retries">) {
    const newLog: PrintLog = {
      ...log,
      id: `print-${crypto.randomUUID()}`,
      timestamp: new Date().toISOString(),
      retries: 0
    };
    db.prepare("INSERT INTO print_logs (id, orderId, zpl, status, errorMessage, retries, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(newLog.id, newLog.orderId, newLog.zpl, newLog.status, newLog.errorMessage, newLog.retries, newLog.timestamp);
    const count = db.prepare("SELECT count(*) AS count FROM print_logs").get() as { count: number };
    if (count.count > 100) {
      db.prepare("DELETE FROM print_logs WHERE id NOT IN (SELECT id FROM print_logs ORDER BY timestamp DESC LIMIT 100)").run();
    }
    return newLog;
  }

  public updatePrintLog(id: string, updates: Partial<PrintLog>) {
    const columns: Record<string, string> = {
      status: "status",
      errorMessage: "errorMessage",
      retries: "retries",
      zpl: "zpl",
      orderId: "orderId"
    };
    const fields: string[] = [];
    const values: any[] = [];
    for (const [key, column] of Object.entries(columns)) {
      if ((updates as any)[key] !== undefined) {
        fields.push(`${column} = ?`);
        values.push((updates as any)[key]);
      }
    }
    if (fields.length === 0) return db.prepare("SELECT * FROM print_logs WHERE id = ?").get(id) as PrintLog;
    values.push(id);
    db.prepare(`UPDATE print_logs SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    return db.prepare("SELECT * FROM print_logs WHERE id = ?").get(id) as PrintLog;
  }

  public getSalesByTable(filters: ClosedReceiptFilters = {}) {
    const history = this.getClosedReceipts({ ...filters, limit: 5000 });
    const tableMap: { [key: string]: { tableName: string; totalSales: number; ticketCount: number; lastTicket: string | null } } = {};
    history.forEach((receipt) => {
      const key = receipt.tableName || receipt.tableId;
      if (!tableMap[key]) tableMap[key] = { tableName: key, totalSales: 0, ticketCount: 0, lastTicket: null };
      tableMap[key].totalSales += receipt.total;
      tableMap[key].ticketCount += 1;
      if (!tableMap[key].lastTicket || receipt.timestamp > tableMap[key].lastTicket!) tableMap[key].lastTicket = receipt.timestamp;
    });
    return Object.values(tableMap)
      .map((table) => ({ ...table, totalSales: parseFloat(table.totalSales.toFixed(2)) }))
      .sort((a, b) => b.totalSales - a.totalSales);
  }

  public getClosedReceipts(filters: ClosedReceiptFilters = {}): any[] {
    const clauses: string[] = [];
    const values: any[] = [];
    if (filters.from) {
      clauses.push("timestamp >= ?");
      values.push(filters.from);
    }
    if (filters.to) {
      clauses.push("timestamp <= ?");
      values.push(filters.to);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = Math.min(Math.max(filters.limit ?? 500, 1), 5000);
    const rows = db.prepare(`SELECT * FROM closed_receipts ${where} ORDER BY timestamp DESC LIMIT ?`).all(...values, limit) as any[];
    return rows.map((row) => ({
      id: row.id,
      tableId: row.tableId,
      tableName: row.tableName,
      sessionId: row.sessionId,
      subtotal: parseFloat(row.subtotal || 0),
      taxAmount: parseFloat(row.taxAmount || 0),
      total: parseFloat(row.total || 0),
      timestamp: row.timestamp,
      items: JSON.parse(row.items || "[]"),
      splitMethod: row.splitMethod,
      invoiceNumber: row.invoiceNumber ?? null,
      paymentMethod: row.paymentMethod || "efectivo",
      closedBy: row.closedBy || null,
      openedAt: row.openedAt || null,
      taxBreakdown: JSON.parse(row.taxBreakdown || "{}")
    }));
  }

  public getTicketTemplate(): TicketTemplate {
    try {
      const row = db.prepare("SELECT * FROM ticket_template WHERE id = 1").get() as any;
      if (!row) return this.defaultTemplate();
      return {
        businessName: row.business_name,
        headerTitle: row.header_title,
        footerThanks: row.footer_thanks,
        footerUrl: row.footer_url,
        kitchenHeader: row.kitchen_header,
        kitchenFooter: row.kitchen_footer,
        labelCant: row.label_cant,
        labelDescripcion: row.label_descripcion,
        labelTotal: row.label_total,
        labelFactura: row.label_factura,
        labelMesa: row.label_mesa,
        labelTicket: row.label_ticket,
        labelMetodoPago: row.label_metodo_pago,
        labelSubtotal: row.label_subtotal,
        labelIva: row.label_iva,
        labelTotalFinal: row.label_total_final,
        paperWidth: row.paper_width,
        paperHeight: row.paper_height
      };
    } catch {
      return this.defaultTemplate();
    }
  }

  private defaultTemplate(): TicketTemplate {
    return {
      businessName: "GASTRO-OS",
      headerTitle: "TICKET DE CUENTA",
      footerThanks: "¡Muchas gracias por su visita!",
      footerUrl: "GastroOS",
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
      paperHeight: 14.5
    };
  }

  public updateTicketTemplate(config: Partial<TicketTemplate>): TicketTemplate {
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
    const fields: string[] = [];
    const values: any[] = [];
    for (const [key, column] of Object.entries(map)) {
      if ((config as any)[key] !== undefined) {
        fields.push(`${column} = ?`);
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
    const columns: Record<string, string> = {
      tableName: "tableName",
      subtotal: "subtotal",
      taxAmount: "taxAmount",
      total: "total",
      paymentMethod: "paymentMethod"
    };
    const fields: string[] = [];
    const values: any[] = [];
    for (const [key, column] of Object.entries(columns)) {
      if (updates[key] !== undefined) {
        fields.push(`${column} = ?`);
        values.push(updates[key]);
      }
    }
    if (updates.items !== undefined) {
      fields.push("items = ?");
      values.push(JSON.stringify(updates.items));
    }
    if (fields.length === 0) return db.prepare("SELECT * FROM closed_receipts WHERE id = ?").get(id);
    values.push(id);
    db.prepare(`UPDATE closed_receipts SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    return db.prepare("SELECT * FROM closed_receipts WHERE id = ?").get(id);
  }

  public getPendingWaiterCalls(): WaiterCall[] {
    const rows = db.prepare("SELECT * FROM waiter_calls WHERE status = 'pending' ORDER BY timestamp ASC").all() as any[];
    return rows.map((row) => ({
      id: row.id,
      tableId: row.tableId,
      tableName: row.tableName,
      reason: row.reason,
      status: row.status,
      timestamp: row.timestamp
    }));
  }

  public addWaiterCall(call: Omit<WaiterCall, "id" | "status" | "timestamp">): WaiterCall {
    const existing = db.prepare("SELECT * FROM waiter_calls WHERE tableId = ? AND reason = ? AND status = 'pending' ORDER BY timestamp DESC LIMIT 1")
      .get(call.tableId, call.reason) as any;
    if (existing) {
      return {
        id: existing.id,
        tableId: existing.tableId,
        tableName: existing.tableName,
        reason: existing.reason,
        status: existing.status,
        timestamp: existing.timestamp
      };
    }
    const id = `call-${crypto.randomUUID()}`;
    const timestamp = new Date().toISOString();
    const status = "pending";
    db.prepare("INSERT INTO waiter_calls (id, tableId, tableName, reason, status, timestamp) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, call.tableId, call.tableName, call.reason, status, timestamp);
    return { id, tableId: call.tableId, tableName: call.tableName, reason: call.reason as any, status, timestamp };
  }

  public resolveWaiterCall(id: string): boolean {
    const result = db.prepare("UPDATE waiter_calls SET status = 'resolved' WHERE id = ?").run(id);
    return result.changes > 0;
  }

  public deleteBillItem(tableId: string, productId: string, notes: string, selectedExtras: any[]): boolean {
    const table = this.getTableById(tableId);
    if (!table || !table.activeSessionId) return false;
    const sessionId = table.activeSessionId;
    const orders = db.prepare("SELECT * FROM orders WHERE tableId = ? AND sessionId = ? AND status != 'cancelado'").all(table.id, sessionId) as any[];
    const extrasStr = JSON.stringify(selectedExtras || []);
    let changed = false;

    db.transaction(() => {
      for (const order of orders) {
        const items = db.prepare(`
          SELECT * FROM order_items
          WHERE orderId = ? AND productId = ? AND (notes = ? OR (notes IS NULL AND ? = '')) AND selectedExtras = ?
        `).all(order.id, productId, notes || "", notes || "", extrasStr) as any[];

        for (const item of items) {
          changed = true;
          const product = this.getProductById(item.productId);
          if (product && product.stock !== null) {
            db.prepare("UPDATE products SET stock = ? WHERE id = ?").run(product.stock + item.quantity, product.id);
          }
          db.prepare("DELETE FROM order_items WHERE id = ?").run(item.id);
          db.prepare("UPDATE orders SET totalAmount = MAX(0, totalAmount - ?) WHERE id = ?").run(item.priceTotal, order.id);
        }

        const count = db.prepare("SELECT count(*) AS count FROM order_items WHERE orderId = ?").get(order.id) as { count: number };
        if (count.count === 0) {
          db.prepare("DELETE FROM orders WHERE id = ?").run(order.id);
        } else {
          db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(this.deriveOrderStatus(order.id), order.id);
        }
      }
      this.recalculateTableBillTotal(table.id);
    })();

    return changed;
  }

  public updateBillItemNote(tableId: string, productId: string, oldNotes: string, selectedExtras: any[], newNotes: string): boolean {
    const table = this.getTableById(tableId);
    if (!table || !table.activeSessionId) return false;
    const sessionId = table.activeSessionId;
    const orders = db.prepare("SELECT id FROM orders WHERE tableId = ? AND sessionId = ? AND status != 'cancelado'").all(table.id, sessionId) as any[];
    const extrasStr = JSON.stringify(selectedExtras || []);
    let changed = false;

    db.transaction(() => {
      for (const order of orders) {
        const result = db.prepare(`
          UPDATE order_items
          SET notes = ?
          WHERE orderId = ? AND productId = ? AND (notes = ? OR (notes IS NULL AND ? = '')) AND selectedExtras = ?
        `).run(newNotes, order.id, productId, oldNotes || "", oldNotes || "", extrasStr);
        if (result.changes > 0) changed = true;
      }
    })();

    return changed;
  }

  public serveBillItem(tableId: string, productId: string, notes: string, selectedExtras: any[]): boolean {
    const table = this.getTableById(tableId);
    if (!table || !table.activeSessionId) return false;
    const sessionId = table.activeSessionId;
    const orders = db.prepare("SELECT id FROM orders WHERE tableId = ? AND sessionId = ? AND status != 'cancelado'").all(table.id, sessionId) as any[];
    const extrasStr = JSON.stringify(selectedExtras || []);
    let changed = false;

    db.transaction(() => {
      for (const order of orders) {
        const result = db.prepare(`
          UPDATE order_items
          SET stationStatus = 'servido'
          WHERE orderId = ? AND productId = ? AND (notes = ? OR (notes IS NULL AND ? = '')) AND selectedExtras = ?
        `).run(order.id, productId, notes || "", notes || "", extrasStr);
        if (result.changes > 0) {
          changed = true;
          db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(this.deriveOrderStatus(order.id), order.id);
        }
      }
    })();

    return changed;
  }

  public savePushSubscription(userId: string, role: string, subscription: { endpoint: string; keys: { p256dh: string; auth: string } }): void {
    db.prepare(`
      INSERT INTO push_subscriptions (id, userId, role, endpoint, p256dh, auth, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET userId = excluded.userId, role = excluded.role, p256dh = excluded.p256dh, auth = excluded.auth
    `).run(`push-${crypto.randomUUID()}`, userId, role, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, new Date().toISOString());
  }

  public deletePushSubscription(endpoint: string): void {
    db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint);
  }

  public getPushSubscriptionsByRole(role: string): Array<{ endpoint: string; p256dh: string; auth: string }> {
    return db.prepare("SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE role = ?").all(role) as any[];
  }

  public getAllPushSubscriptions(): Array<{ endpoint: string; p256dh: string; auth: string; role: string }> {
    return db.prepare("SELECT endpoint, p256dh, auth, role FROM push_subscriptions").all() as any[];
  }

  public publishEvent(event: string, data: unknown): number {
    const result = db.prepare("INSERT INTO event_log (event, data, timestamp) VALUES (?, ?, ?)")
      .run(event, JSON.stringify(data ?? {}), new Date().toISOString());
    return Number(result.lastInsertRowid);
  }

  public getEventsSince(lastId: number, limit = 200) {
    return db.prepare("SELECT * FROM event_log WHERE id > ? ORDER BY id ASC LIMIT ?").all(lastId, limit) as Array<{ id: number; event: string; data: string; timestamp: string }>;
  }

  public getLastEventId(): number {
    const row = db.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM event_log").get() as { id: number };
    return row.id;
  }

  public pruneEvents() {
    db.prepare("DELETE FROM event_log WHERE id NOT IN (SELECT id FROM event_log ORDER BY id DESC LIMIT 1000)").run();
  }
}

export const dbInstance = new LocalDatabase();
