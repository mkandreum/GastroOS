/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import path from "path";
import net from "net";
import helmet from "helmet";
import compression from "compression";
import { createServer as createViteServer } from "vite";
import { dbInstance } from "./server/db";
import crypto from "crypto";
import { Order, OrderLine, PrinterConfig, OrderStatus, TicketTemplate } from "./src/types";
import webpush from "web-push";
import {
  TOKEN_TTL_SECONDS,
  clientIp,
  createRateLimiter,
  extractBearerToken,
  extractTableToken,
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
} from "./server/security";
import {
  isOrderStatus,
  isRole,
  isStation,
  isTableStatus,
  decimal,
  integer,
  requiredText,
  text
} from "./server/validation";

// Configurar VAPID para Web Push Notifications
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_EMAIL = process.env.VAPID_EMAIL || "mailto:admin@gastro-os.local";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  console.log("[WebPush] VAPID configurado correctamente.");
} else {
  console.warn("[WebPush] VAPID keys no configuradas. Las notificaciones push estarán deshabilitadas.");
}

// Capturar errores no manejados para diagnóstico en producción
process.on("uncaughtException", (err) => {
  console.error("[FATAL] Excepción no capturada:", err);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] Promesa rechazada no manejada:", reason);
});

// Iniciar aplicación Express
const app = express();
const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const APP_TYPE = process.env.APP_TYPE || "both";
const APP_URL = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/+$/, "");
const isProduction = process.env.NODE_ENV === "production";

app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", ...(isProduction ? [] : ["'unsafe-inline'"])],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", ...(isProduction ? [] : ["ws:", "wss:"])],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "same-origin" },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" }
}));
app.use(compression());
app.use(express.json({ limit: "100kb" }));

const clientPublicRoutes: Array<{ method: string; pattern: RegExp }> = [
  { method: "GET", pattern: /^\/health$/ },
  { method: "GET", pattern: /^\/api\/app-config$/ },
  { method: "GET", pattern: /^\/api\/(categories|products|push\/vapid-public-key)$/ },
  { method: "GET", pattern: /^\/api\/tables\/[^/]+$/ },
  { method: "GET", pattern: /^\/api\/tables\/[^/]+\/bill$/ },
  { method: "GET", pattern: /^\/api\/orders$/ },
  { method: "POST", pattern: /^\/api\/(orders|waiter-calls|push\/unsubscribe)$/ }
];

app.use((req: any, res: any, next: any) => {
  if (APP_TYPE === "client" && req.path.startsWith("/api/")) {
    const allowed = clientPublicRoutes.some((route) => route.method === req.method && route.pattern.test(req.path));
    if (!allowed) {
      return res.status(403).json({ error: "Acceso denegado en la instancia de cliente." });
    }
  }
  next();
});

app.get("/api/app-config", (req, res) => {
  res.json({ appType: APP_TYPE });
});

app.get("/health", (req, res) => {
  try {
    dbInstance.getTables();
    res.json({ status: "ok", appType: APP_TYPE, timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: "degraded", appType: APP_TYPE });
  }
});

const loginLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 12, key: (req) => `login:${clientIp(req)}` });
const orderLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 30, key: (req) => `order:${clientIp(req)}` });
const waiterCallLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 8, key: (req) => `call:${clientIp(req)}:${req.body?.tableId || "none"}` });

// -------------------------------------------------------------
// LÓGICA DE GENERACIÓN DE ZPL Y ENVÍO A IMPRESORA
// -------------------------------------------------------------

function nextTicketNum(): number {
  return dbInstance.nextSequence("ticket", 1000);
}

const DPI = 203;

const DEFAULT_TEMPLATE: TicketTemplate = {
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

function getTemplateConfig(): TicketTemplate {
  try {
    const tpl = dbInstance.getTicketTemplate();
    if (tpl && typeof tpl.paperWidth === "number") return tpl;
  } catch (e) {
    console.warn("[ZPL] Error leyendo plantilla, usando defaults:", e);
  }
  return DEFAULT_TEMPLATE;
}

function scaleX(x: number, tmpl: TicketTemplate): number {
  const pw = tmpl?.paperWidth ?? 10.45;
  const baseDots = 800;
  const actualDots = Math.round((pw / 2.54) * DPI);
  return Math.round((x / baseDots) * actualDots);
}

function scaleY(y: number, tmpl: TicketTemplate): number {
  const pw = tmpl?.paperWidth ?? 10.45;
  const scale = ((pw / 2.54) * DPI) / 800;
  return Math.round(y * scale);
}

function scaleFont(size: number, tmpl: TicketTemplate): number {
  const pw = tmpl?.paperWidth ?? 10.45;
  const scale = ((pw / 2.54) * DPI) / 800;
  return Math.max(12, Math.round(size * scale));
}

function scaleW(size: number, tmpl: TicketTemplate): number {
  return scaleFont(size, tmpl);
}

function getPWDots(tmpl: TicketTemplate): number {
  const pw = tmpl?.paperWidth ?? 10.45;
  return Math.round((pw / 2.54) * DPI);
}

function getLLDots(tmpl: TicketTemplate): number {
  const ph = tmpl?.paperHeight ?? 14.50;
  return Math.round((ph / 2.54) * DPI);
}

function sanitizeTemplate(template: TicketTemplate): TicketTemplate {
  const clean: any = { ...template };
  for (const key of Object.keys(clean)) {
    if (typeof clean[key] === "string") clean[key] = zplSafe(clean[key], 120);
  }
  return clean as TicketTemplate;
}

export function generateZplTicket(order: Order, items: OrderLine[]): string {
  const tmpl = sanitizeTemplate(getTemplateConfig());
  const tNum = nextTicketNum();
  const tableName = zplSafe(order.tableName, 60);
  const orderId = zplSafe(order.id.slice(-6).toUpperCase(), 20);
  const pw = getPWDots(tmpl);
  const margin = scaleX(40, tmpl);
  const wBlock = pw - 2 * margin;

  let yPos = 255;
  items.forEach((item) => {
    yPos += 30;
    if (item.selectedExtras && item.selectedExtras.length > 0) {
      yPos += 25;
    }
    if (item.notes) {
      yPos += 25;
    }
    yPos += 12;
  });
  yPos += 18;
  yPos += 30;
  yPos += 40; // Margen de seguridad inferior

  const ll = Math.max(getLLDots(tmpl), scaleY(yPos, tmpl));

  let zpl = `^XA\n`;
  zpl += `^CI28\n`;
  zpl += `^PW${pw}\n`;
  zpl += `^LL${ll}\n`;

  const logoW = scaleFont(50, tmpl);
  // Centrar el nombre de negocio dinámicamente según ancho de papel
  zpl += `^FO${margin},${scaleY(30, tmpl)}^A0N,${logoW},${logoW}^FB${wBlock},1,0,C,0^FD${tmpl.businessName}^FS\n`;
  // Centrar el encabezado de cocina dinámicamente
  zpl += `^FO${margin},${scaleY(95, tmpl)}^A0N,${scaleFont(28, tmpl)},${scaleFont(28, tmpl)}^FB${wBlock},1,0,C,0^FD${tmpl.kitchenHeader}^FS\n`;
  // Factura a la izquierda e ID a la derecha en la misma línea
  zpl += `^FO${margin},${scaleY(140, tmpl)}^A0N,${scaleFont(22, tmpl)},${scaleFont(22, tmpl)}^FD${tmpl.labelFactura}: F-${String(tNum).padStart(5, "0")}^FS\n`;
  zpl += `^FO${margin},${scaleY(140, tmpl)}^A0N,${scaleFont(22, tmpl)},${scaleFont(22, tmpl)}^FB${wBlock},1,0,R,0^FDID: ${orderId}^FS\n`;
  // Mesa y Fecha
  zpl += `^FO${margin},${scaleY(175, tmpl)}^A0N,${scaleFont(26, tmpl)},${scaleFont(26, tmpl)}^FD${tmpl.labelMesa}: ${tableName}^FS\n`;
  zpl += `^FO${margin},${scaleY(205, tmpl)}^A0N,${scaleFont(22, tmpl)},${scaleFont(22, tmpl)}^FD${new Date(order.timestamp).toLocaleString("es-ES")}^FS\n`;

  const sepW = pw - scaleX(80, tmpl);
  zpl += `^FO${margin},${scaleY(235, tmpl)}^GB${sepW},2,2^FS\n`;

  let currentY = 255;
  items.forEach((item) => {
    const y = scaleY(currentY, tmpl);
    zpl += `^FO${margin},${y}^A0N,${scaleFont(24, tmpl)},${scaleFont(24, tmpl)}^FD${item.quantity}x^FS\n`;
    zpl += `^FO${margin + scaleX(60, tmpl)},${y}^A0N,${scaleFont(24, tmpl)},${scaleFont(24, tmpl)}^FB${pw - margin - scaleX(100, tmpl)},1,0,L,0^FD${zplSafe(item.name, 80)}^FS\n`;
    currentY += 30;
    if (item.selectedExtras && item.selectedExtras.length > 0) {
      const extrasStr = item.selectedExtras.map(e => `+ ${e.optionName}`).join(", ");
      zpl += `^FO${margin + scaleX(80, tmpl)},${scaleY(currentY, tmpl)}^A0N,${scaleFont(20, tmpl)},${scaleFont(20, tmpl)}^FB${pw - margin - scaleX(120, tmpl)},1,0,L,0^FD${zplSafe(extrasStr, 100)}^FS\n`;
      currentY += 25;
    }
    if (item.notes) {
      zpl += `^FO${margin + scaleX(80, tmpl)},${scaleY(currentY, tmpl)}^A0N,${scaleFont(20, tmpl)},${scaleFont(20, tmpl)}^FB${pw - margin - scaleX(120, tmpl)},1,0,L,0^FDNota: "${zplSafe(item.notes, 100)}"^FS\n`;
      currentY += 25;
    }
    currentY += 12;
  });

  zpl += `^FO${margin},${scaleY(currentY, tmpl)}^GB${sepW},2,2^FS\n`;
  currentY += 18;
  zpl += `^FO${margin},${scaleY(currentY, tmpl)}^A0N,${scaleFont(22, tmpl)},${scaleFont(22, tmpl)}^FB${wBlock},1,0,C,0^FD${tmpl.kitchenFooter}^FS\n`;
  zpl += `^XZ`;
  return zpl;
}

// Función para enviar ZPL a impresora de red por TCP (puerto 9100)
async function sendRawZplToNetworkPrinter(ip: string, port: number, zpl: string, timeoutMs = 10000): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    let settled = false;
    const settle = (fn: () => void) => {
      if (!settled) { settled = true; fn(); }
    };

    client.on("error", (err) => {
      settle(() => {
        client.destroy();
        reject(new Error(`Fallo de red TCP: ${err.message}`));
      });
    });

    client.on("timeout", () => {
      settle(() => {
        client.destroy();
        reject(new Error(`Tiempo de espera excedido (${timeoutMs}ms) conectando a ${ip}:${port}`));
      });
    });

    client.setTimeout(timeoutMs);

    client.connect(port, ip, () => {
      console.log(`[TCP Printer] Conectado a ${ip}:${port}. Enviando ZPL (${zpl.length} bytes)...`);
      client.write(zpl, "utf8", () => {
        client.end(() => settle(() => resolve()));
      });
    });
  });
}

// Generador de formato ZPL para TICKETS / FACTURAS de cliente
export function generateZplReceipt(receipt: {
  tableName: string;
  items: Array<{ name: string; quantity: number; priceTotal: number }>;
  subtotal: number;
  taxAmount: number;
  total: number;
  timestamp: string;
  receiptId?: string;
  title?: string;
  splitMethod?: string;
  invoiceNumber?: number;
}): string {
  const tmpl = sanitizeTemplate(getTemplateConfig());
  const tNum = receipt.invoiceNumber ?? nextTicketNum();
  const tableName = zplSafe(receipt.tableName, 60);
  const receiptId = zplSafe(receipt.receiptId || "", 40);
  const title = zplSafe((receipt.title || tmpl.headerTitle).toUpperCase(), 80);
  const splitMethod = zplSafe(String(receipt.splitMethod || "").replace("_", " "), 40);
  const pw = getPWDots(tmpl);
  const margin = scaleX(40, tmpl);
  const wBlock = pw - 2 * margin;

  // Calcular la altura necesaria dinámicamente
  let yPosCalc = 140;
  yPosCalc += 27; // Factura / ID
  yPosCalc += 25; // Mesa
  yPosCalc += 25; // Fecha
  if (receipt.receiptId) {
    yPosCalc += 25; // Ticket ID
  }
  if (receipt.splitMethod && receipt.splitMethod !== "completa") {
    yPosCalc += 25; // Método de pago
  }
  yPosCalc += 4; // Espacio
  yPosCalc += 14; // Espacio
  yPosCalc += 25; // Cabecera tabla
  yPosCalc += 10; // Espacio
  receipt.items.forEach(() => {
    yPosCalc += 25;
  });
  yPosCalc += 4; // Espacio
  yPosCalc += 12; // Espacio
  yPosCalc += 24; // Subtotal
  yPosCalc += 26; // IVA
  yPosCalc += 12; // Espacio
  yPosCalc += 46; // Total Final
  yPosCalc += 27; // Gracias
  yPosCalc += 35; // URL
  yPosCalc += 40; // Margen de seguridad inferior

  const ll = Math.max(getLLDots(tmpl), scaleY(yPosCalc, tmpl));

  let zpl = `^XA\n`;
  zpl += `^CI28\n`;
  zpl += `^PW${pw}\n`;
  zpl += `^LL${ll}\n`;

  const logoW = scaleFont(50, tmpl);
  // Nombre del negocio centrado dinámicamente
  zpl += `^FO${margin},${scaleY(30, tmpl)}^A0N,${logoW},${logoW}^FB${wBlock},1,0,C,0^FD${tmpl.businessName}^FS\n`;
  // Título del ticket centrado dinámicamente
  zpl += `^FO${margin},${scaleY(95, tmpl)}^A0N,${scaleFont(26, tmpl)},${scaleFont(26, tmpl)}^FB${wBlock},1,0,C,0^FD${title}^FS\n`;

  let yInfo = 140;
  // Factura a la izquierda e ID a la derecha en la misma línea
  zpl += `^FO${margin},${scaleY(yInfo, tmpl)}^A0N,${scaleFont(22, tmpl)},${scaleFont(22, tmpl)}^FD${tmpl.labelFactura}: F-${String(tNum).padStart(5, "0")}^FS\n`;
  if (receipt.receiptId) {
    zpl += `^FO${margin},${scaleY(yInfo, tmpl)}^A0N,${scaleFont(22, tmpl)},${scaleFont(22, tmpl)}^FB${wBlock},1,0,R,0^FDID: ${zplSafe(receipt.receiptId.slice(-8).toUpperCase(), 20)}^FS\n`;
  }
  yInfo += 27;
  // Mesa y Fecha
  zpl += `^FO${margin},${scaleY(yInfo, tmpl)}^A0N,${scaleFont(22, tmpl)},${scaleFont(22, tmpl)}^FD${tmpl.labelMesa}: ${tableName}^FS\n`;
  yInfo += 25;
  zpl += `^FO${margin},${scaleY(yInfo, tmpl)}^A0N,${scaleFont(22, tmpl)},${scaleFont(22, tmpl)}^FD${new Date(receipt.timestamp).toLocaleString("es-ES")}^FS\n`;
  yInfo += 25;
  if (receipt.receiptId) {
    zpl += `^FO${margin},${scaleY(yInfo, tmpl)}^A0N,${scaleFont(22, tmpl)},${scaleFont(22, tmpl)}^FD${tmpl.labelTicket}: ${receiptId}^FS\n`;
    yInfo += 25;
  }
  if (receipt.splitMethod && receipt.splitMethod !== "completa") {
    zpl += `^FO${margin},${scaleY(yInfo, tmpl)}^A0N,${scaleFont(22, tmpl)},${scaleFont(22, tmpl)}^FD${tmpl.labelMetodoPago}: Fraccionado (${splitMethod})^FS\n`;
    yInfo += 25;
  }

  yInfo += 4;
  const sepW = pw - scaleX(80, tmpl);
  zpl += `^FO${margin},${scaleY(yInfo, tmpl)}^GB${sepW},2,2^FS\n`;
  let yPosition = yInfo + 14;

  // Encabezados de tabla alineados de forma limpia
  zpl += `^FO${margin},${scaleY(yPosition, tmpl)}^A0N,${scaleFont(22, tmpl)},${scaleFont(22, tmpl)}^FD${tmpl.labelCant}^FS\n`;
  zpl += `^FO${margin + scaleX(80, tmpl)},${scaleY(yPosition, tmpl)}^A0N,${scaleFont(22, tmpl)},${scaleFont(22, tmpl)}^FD${tmpl.labelDescripcion}^FS\n`;
  zpl += `^FO${margin},${scaleY(yPosition, tmpl)}^A0N,${scaleFont(22, tmpl)},${scaleFont(22, tmpl)}^FB${wBlock},1,0,R,0^FD${tmpl.labelTotal}^FS\n`;
  yPosition += 25;
  zpl += `^FO${margin},${scaleY(yPosition, tmpl)}^GB${sepW},1,1^FS\n`;
  yPosition += 10;

  receipt.items.forEach((item) => {
    const y = scaleY(yPosition, tmpl);
    zpl += `^FO${margin},${y}^A0N,${scaleFont(22, tmpl)},${scaleFont(22, tmpl)}^FD${item.quantity}x^FS\n`;
    // Descripción con límite de ancho para evitar solapamiento con el precio total
    zpl += `^FO${margin + scaleX(80, tmpl)},${y}^A0N,${scaleFont(22, tmpl)},${scaleFont(22, tmpl)}^FB${pw - margin - scaleX(250, tmpl)},1,0,L,0^FD${zplSafe(item.name, 24)}^FS\n`;
    // Precio total alineado a la derecha
    zpl += `^FO${margin},${y}^A0N,${scaleFont(22, tmpl)},${scaleFont(22, tmpl)}^FB${wBlock},1,0,R,0^FD${item.priceTotal.toFixed(2)} EUR^FS\n`;
    yPosition += 25;
  });

  yPosition += 4;
  zpl += `^FO${margin},${scaleY(yPosition, tmpl)}^GB${sepW},1,1^FS\n`;
  yPosition += 12;

  // Subtotal e IVA con alineación derecha para los importes
  zpl += `^FO${margin},${scaleY(yPosition, tmpl)}^A0N,${scaleFont(22, tmpl)},${scaleFont(22, tmpl)}^FD${tmpl.labelSubtotal}:^FS\n`;
  zpl += `^FO${margin},${scaleY(yPosition, tmpl)}^A0N,${scaleFont(22, tmpl)},${scaleFont(22, tmpl)}^FB${wBlock},1,0,R,0^FD${receipt.subtotal.toFixed(2)} EUR^FS\n`;
  yPosition += 24;

  zpl += `^FO${margin},${scaleY(yPosition, tmpl)}^A0N,${scaleFont(22, tmpl)},${scaleFont(22, tmpl)}^FD${tmpl.labelIva}:^FS\n`;
  zpl += `^FO${margin},${scaleY(yPosition, tmpl)}^A0N,${scaleFont(22, tmpl)},${scaleFont(22, tmpl)}^FB${wBlock},1,0,R,0^FD${receipt.taxAmount.toFixed(2)} EUR^FS\n`;
  yPosition += 26;

  // Separador doble de totales finales
  zpl += `^FO${margin},${scaleY(yPosition, tmpl)}^GB${sepW},3,3^FS\n`;
  yPosition += 12;

  const totalFont = scaleFont(36, tmpl);
  // Total final destacado y alineado a la derecha
  zpl += `^FO${margin},${scaleY(yPosition, tmpl)}^A0N,${totalFont},${totalFont}^FD${tmpl.labelTotalFinal}:^FS\n`;
  zpl += `^FO${margin},${scaleY(yPosition, tmpl)}^A0N,${totalFont},${totalFont}^FB${wBlock},1,0,R,0^FD${receipt.total.toFixed(2)} EUR^FS\n`;
  yPosition += 46;

  // Mensajes finales centrados
  zpl += `^FO${margin},${scaleY(yPosition, tmpl)}^A0N,${scaleFont(22, tmpl)},${scaleFont(22, tmpl)}^FB${wBlock},1,0,C,0^FD${tmpl.footerThanks}^FS\n`;
  yPosition += 27;
  zpl += `^FO${margin},${scaleY(yPosition, tmpl)}^A0N,${scaleFont(20, tmpl)},${scaleFont(20, tmpl)}^FB${wBlock},1,0,C,0^FD${tmpl.footerUrl}^FS\n`;
  zpl += `^XZ`;

  return zpl;
}

// Despachador de impresión para tickets de cliente
export async function queueTicketPrintJob(receiptData: {
  tableName: string;
  items: Array<{ name: string; quantity: number; priceTotal: number }>;
  subtotal: number;
  taxAmount: number;
  total: number;
  timestamp: string;
  receiptId?: string;
  title?: string;
  splitMethod?: string;
  invoiceNumber?: number;
}) {
  const zpl = generateZplReceipt(receiptData);
  const config = dbInstance.getTicketPrinterConfig();

  if (!config.enabled) return;

  const log = dbInstance.addPrintLog({
    orderId: "ticket-" + Date.now(),
    zpl,
    status: "pending",
    errorMessage: null
  });

  const maxRetries = 3;
  let attempt = 0;
  let success = false;
  let lastError = "";

  while (attempt < maxRetries && !success) {
    try {
      attempt++;
      dbInstance.updatePrintLog(log.id, { retries: attempt });
      await sendRawZplToNetworkPrinter(config.ip, config.port, zpl, 10000);
      success = true;
    } catch (err: any) {
      lastError = err.message || "Error desconocido";
      console.warn(`[Ticket Printer] Intento ${attempt}/${maxRetries} fallido: ${lastError}`);
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  if (success) {
    dbInstance.updatePrintLog(log.id, { status: "sent", errorMessage: null });
    console.log(`[Ticket Printer] Ticket enviado con éxito.`);
  } else {
    dbInstance.updatePrintLog(log.id, {
      status: "failed",
      errorMessage: `Error tras ${maxRetries} intentos: ${lastError}`
    });
  }
}

// Despachador de impresión asíncrono con control de reintentos
export async function queuePrinterJob(order: Order, items: OrderLine[]) {
  if (items.length === 0) return;

  const zpl = generateZplTicket(order, items);
  const config = dbInstance.getPrinterConfig();

  console.log(`[Printer Queue] Procesando pedido ${order.id} para impresora ${config.ip}:${config.port} (enabled: ${config.enabled})`);

  // Buscar el log de impresión ya creado (generado en POST /api/orders)
  let log = dbInstance.getPrintLogs().find(l => l.orderId === order.id && l.status === "pending");
  if (!log) {
    // Si no existe aún, crear uno nuevo
    log = dbInstance.addPrintLog({
      orderId: order.id,
      zpl,
      status: "pending",
      errorMessage: null
    });
  }

  if (!config.enabled) {
    dbInstance.updatePrintLog(log.id, {
      status: "failed",
      errorMessage: "Impresora deshabilitada en la configuración de la administración."
    });
    return;
  }

  // Intentar la conexión asíncronamente con 3 reintentos
  const maxRetries = 3;
  let attempt = 0;
  let success = false;
  let lastError = "";

  while (attempt < maxRetries && !success) {
    try {
      attempt++;
      dbInstance.updatePrintLog(log.id, { retries: attempt });
      console.log(`[Printer Queue] Intento ${attempt} para pedido ${order.id}...`);
      
      // Intentamos el envío TCP crudo
      await sendRawZplToNetworkPrinter(config.ip, config.port, zpl);
      success = true;
    } catch (err: any) {
      lastError = err.message || "Error desconocido";
      console.warn(`[Printer Queue] Intento ${attempt}/${maxRetries} fallido para pedido ${order.id} en ${config.ip}: ${lastError}`);
      
      // Esperar 1 segundo antes de reintentar
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  if (success) {
    dbInstance.updatePrintLog(log.id, {
      status: "sent",
      errorMessage: null
    });
    console.log(`[Printer Queue] Ticket ZPL de pedido ${order.id} impreso con éxito en ${config.ip}.`);
  } else {
    dbInstance.updatePrintLog(log.id, {
      status: "failed",
      errorMessage: `Error tras ${maxRetries} intentos: ${lastError} (Simulación fallida pero ZPL registrado para visualización web)`
    });
  }
}

interface AuthenticatedUser {
  sub: string;
  role: string;
  username: string;
  name: string;
  jti: string;
  exp: number;
  token: string;
}

function resolveStaff(req: any): AuthenticatedUser | null {
  const token = extractBearerToken(req, req.path === "/api/events");
  if (!token) return null;
  const payload = verifySessionToken(token);
  if (!payload || dbInstance.isTokenRevoked(payload.jti)) return null;
  const user = dbInstance.getUserById(payload.sub);
  if (!user) return null;
  if ((user.tokenVersion ?? 1) !== payload.ver) return null;
  return {
    sub: user.id,
    role: user.role,
    username: user.username,
    name: user.name,
    jti: payload.jti,
    exp: payload.exp,
    token
  };
}

function requireStaff(req: any, res: any, next: any) {
  const user = resolveStaff(req);
  if (!user) return res.status(401).json({ error: "Token inválido, expirado o revocado" });
  req.user = user;
  next();
}

function requireRole(...roles: string[]) {
  return (req: any, res: any, next: any) => {
    const user = resolveStaff(req);
    if (!user) return res.status(401).json({ error: "Se requiere autenticación" });
    if (!roles.includes(user.role)) return res.status(403).json({ error: "No tienes permisos para esta operación." });
    req.user = user;
    next();
  };
}

function allowTableOrStaff(req: any, tableId: string): boolean {
  if (resolveStaff(req)) return true;
  return verifyTableToken(tableId, extractTableToken(req));
}

function publicTable(table: any) {
  return {
    id: table.id,
    number: table.number,
    name: table.name,
    status: table.status,
    activeSessionId: table.activeSessionId,
    currentBillTotal: table.currentBillTotal,
    posX: table.posX,
    posY: table.posY,
    width: table.width,
    height: table.height,
    assignedWaiterId: table.assignedWaiterId,
    assignedWaiterName: table.assignedWaiterName,
    sessionStartedAt: table.sessionStartedAt
  };
}

app.post("/api/auth/login", loginLimiter, (req, res) => {
  const username = requiredText(req.body?.username, 80);
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!username || password.length === 0) {
    return res.status(400).json({ error: "Introduce usuario y contraseña" });
  }

  const foundUser = dbInstance.getUserByUsername(username);
  if (!foundUser || !foundUser.passwordHash || !verifyPassword(password, foundUser.passwordHash)) {
    return res.status(401).json({ error: "Credenciales de acceso incorrectas" });
  }

  if (isLegacyHash(foundUser.passwordHash)) {
    dbInstance.updateUser(foundUser.id, { passwordHash: hashPassword(password) });
  }

  const { passwordHash, ...userProfile } = foundUser;
  dbInstance.logAudit({ actorId: foundUser.id, actorName: foundUser.name, action: "login", entity: "auth", entityId: foundUser.id });
  return res.json({
    success: true,
    token: signSessionToken(foundUser),
    expiresIn: TOKEN_TTL_SECONDS,
    user: userProfile
  });
});

app.post("/api/auth/logout", requireStaff, (req: any, res) => {
  dbInstance.revokeToken(req.user.jti, req.user.exp);
  res.json({ success: true });
});

app.get("/api/auth/me", requireStaff, (req: any, res) => {
  const user = dbInstance.getUserById(req.user.sub);
  if (!user) return res.status(404).json({ error: "Usuario no encontrado" });
  const { passwordHash, ...safe } = user;
  res.json(safe);
});

// 1b. GESTIÓN DE USUARIOS / PERSONAL (Solo administradores)
app.get("/api/users", requireRole("admin"), (req: any, res) => {
  const users = dbInstance.getUsers().map(({ id, username, name, role }) => ({ id, username, name, role }));
  res.json(users);
});

app.post("/api/users", requireRole("admin"), (req: any, res) => {
  const username = requiredText(req.body?.username, 60);
  const name = requiredText(req.body?.name, 80);
  const role = req.body?.role;
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!username || !name || !isRole(role) || password.length < 8) {
    return res.status(400).json({ error: "Usuario, nombre, rol válido y contraseña de 8+ caracteres son obligatorios." });
  }
  if (dbInstance.getUserByUsername(username)) {
    return res.status(409).json({ error: "El nombre de usuario ya está registrado." });
  }

  const newUser = {
    id: `usr-${crypto.randomUUID()}`,
    username,
    name,
    role,
    passwordHash: hashPassword(password)
  };
  dbInstance.addUser(newUser);
  dbInstance.logAudit({ actorId: req.user.sub, actorName: req.user.name, action: "create", entity: "user", entityId: newUser.id, details: { username, role } });
  res.status(201).json({ success: true, user: { id: newUser.id, username: newUser.username, name: newUser.name, role: newUser.role } });
});

app.put("/api/users/:id", requireRole("admin"), (req: any, res) => {
  const target = dbInstance.getUserById(req.params.id);
  if (!target) return res.status(404).json({ error: "Usuario no encontrado" });
  const updates: any = {};
  if (req.body?.name !== undefined) {
    const name = requiredText(req.body.name, 80);
    if (!name) return res.status(400).json({ error: "Nombre inválido" });
    updates.name = name;
  }
  if (req.body?.role !== undefined) {
    if (!isRole(req.body.role)) return res.status(400).json({ error: "Rol inválido" });
    if (target.role === "admin" && req.body.role !== "admin") {
      const admins = dbInstance.getUsers().filter((user) => user.role === "admin").length;
      if (admins <= 1) return res.status(400).json({ error: "No puedes degradar al último administrador." });
    }
    updates.role = req.body.role;
  }
  if (req.body?.password !== undefined) {
    const password = typeof req.body.password === "string" ? req.body.password : "";
    if (password.length < 8) return res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres" });
    updates.passwordHash = hashPassword(password);
    updates.tokenVersion = (target.tokenVersion ?? 1) + 1;
  }
  const updated = dbInstance.updateUser(target.id, updates);
  dbInstance.logAudit({ actorId: req.user.sub, actorName: req.user.name, action: "update", entity: "user", entityId: target.id, details: { fields: Object.keys(updates) } });
  const { passwordHash, ...safe } = updated!;
  res.json(safe);
});

app.delete("/api/users/:id", requireRole("admin"), (req: any, res) => {
  const { id } = req.params;
  if (id === req.user.sub) return res.status(400).json({ error: "No puedes eliminar tu propia cuenta." });
  const deleted = dbInstance.deleteUser(id);
  if (deleted) {
    dbInstance.logAudit({ actorId: req.user.sub, actorName: req.user.name, action: "delete", entity: "user", entityId: id });
    res.json({ success: true, message: "Usuario eliminado correctamente." });
  } else {
    res.status(400).json({ error: "No se pudo eliminar el usuario (protegido o es el último administrador)." });
  }
});

// 2. MESAS
app.get("/api/tables", requireStaff, (req: any, res) => {
  const tables = dbInstance.getTables().map((table) => ({
    ...table,
    qrToken: signTableToken(table.id),
    qrCodeData: `${APP_URL}/?mesa=${table.number}&t=${signTableToken(table.id)}`
  }));
  res.json(tables);
});

app.get("/api/tables/:id", (req: any, res) => {
  const table = dbInstance.getTableById(req.params.id);
  if (!table) return res.status(404).json({ error: "Mesa no encontrada" });
  const staff = resolveStaff(req);
  if (!staff && !verifyTableToken(table.id, extractTableToken(req))) {
    return res.status(403).json({ error: "El QR de esta mesa no es válido. Escanea el código físico." });
  }
  if (!staff) return res.json(publicTable(table));
  res.json({
    ...table,
    qrToken: signTableToken(table.id),
    qrCodeData: `${APP_URL}/?mesa=${table.number}&t=${signTableToken(table.id)}`
  });
});

app.post("/api/tables", requireRole("admin"), (req: any, res) => {
  const number = integer(req.body?.number, 1, 999, 0);
  const name = requiredText(req.body?.name, 80);
  if (!number || !name) return res.status(400).json({ error: "Número y nombre de mesa obligatorios" });
  const tableId = `table-${number}`;
  if (dbInstance.getTableById(tableId)) return res.status(409).json({ error: "Ya existe una mesa con ese número." });
  try {
    const table = dbInstance.createTable({
      number,
      name,
      appUrl: APP_URL,
      qrCodeData: `${APP_URL}/?mesa=${number}&t=${signTableToken(tableId)}`
    });
    dbInstance.logAudit({ actorId: req.user.sub, actorName: req.user.name, action: "create", entity: "table", entityId: table.id, details: { number, name } });
    res.status(201).json({ ...table, qrToken: signTableToken(table.id) });
  } catch (error: any) {
    res.status(409).json({ error: "No se pudo crear la mesa: " + error.message });
  }
});

app.delete("/api/tables/:id", requireRole("admin"), (req: any, res) => {
  const table = dbInstance.getTableById(req.params.id);
  if (!table) return res.status(404).json({ error: "Mesa no encontrada" });
  if (table.activeSessionId) return res.status(409).json({ error: "No se puede eliminar una mesa con una cuenta abierta." });
  const success = dbInstance.deleteTable(req.params.id);
  if (success) {
    dbInstance.logAudit({ actorId: req.user.sub, actorName: req.user.name, action: "delete", entity: "table", entityId: req.params.id });
    res.json({ success: true });
  } else {
    res.status(404).json({ error: "Mesa no encontrada" });
  }
});

app.put("/api/tables/:id/position", requireRole("admin"), (req: any, res) => {
  const table = dbInstance.getTableById(req.params.id);
  if (!table) return res.status(404).json({ error: "Mesa no encontrada" });
  const updated = dbInstance.updateTable(req.params.id, {
    posX: integer(req.body?.posX, 0, 4000, table.posX),
    posY: integer(req.body?.posY, 0, 4000, table.posY),
    width: integer(req.body?.width, 80, 600, table.width || 150),
    height: integer(req.body?.height, 60, 600, table.height || 110)
  });
  res.json(updated);
});

// 2b. ASIGNACIÓN DE CAMARERO A MESA
app.post("/api/tables/:id/assign", requireRole("admin", "camarero"), (req: any, res) => {
  const table = dbInstance.getTableById(req.params.id);
  if (!table) return res.status(404).json({ error: "Mesa no encontrada" });
  if (table.assignedWaiterId && table.assignedWaiterId !== req.user.sub && req.user.role !== "admin") {
    return res.status(409).json({ error: `La mesa ya está asignada a ${table.assignedWaiterName || "otro camarero"}.` });
  }
  const updated = dbInstance.updateTable(table.id, {
    assignedWaiterId: req.user.sub,
    assignedWaiterName: req.user.name
  });
  broadcastEvent("table:assigned", {
    tableId: table.id,
    tableName: table.name,
    waiterId: req.user.sub,
    waiterName: req.user.name
  });
  dbInstance.logAudit({ actorId: req.user.sub, actorName: req.user.name, action: "assign", entity: "table", entityId: table.id });
  res.json({ success: true, table: updated });
});

app.post("/api/tables/:id/unassign", requireRole("admin", "camarero"), (req: any, res) => {
  const table = dbInstance.getTableById(req.params.id);
  if (!table) return res.status(404).json({ error: "Mesa no encontrada" });
  if (table.assignedWaiterId && table.assignedWaiterId !== req.user.sub && req.user.role !== "admin") {
    return res.status(403).json({ error: "Solo el camarero asignado o un administrador puede liberar esta mesa." });
  }
  const updated = dbInstance.updateTable(table.id, { assignedWaiterId: null, assignedWaiterName: null });
  broadcastEvent("table:unassigned", { tableId: table.id, tableName: table.name });
  dbInstance.logAudit({ actorId: req.user.sub, actorName: req.user.name, action: "unassign", entity: "table", entityId: table.id });
  res.json({ success: true, table: updated });
});

// 3. CATEGORÍAS
app.get("/api/categories", (req, res) => {
  res.json(dbInstance.getCategories());
});

app.post("/api/categories", requireRole("admin"), (req: any, res) => {
  const name = requiredText(req.body?.name, 80);
  if (!name) return res.status(400).json({ error: "El nombre es obligatorio" });
  const newDoc = dbInstance.createCategory({
    name,
    description: text(req.body?.description, 240),
    icon: requiredText(req.body?.icon, 40) || "Utensils"
  });
  dbInstance.logAudit({ actorId: req.user.sub, actorName: req.user.name, action: "create", entity: "category", entityId: newDoc.id, details: { name } });
  res.status(201).json(newDoc);
});

app.put("/api/categories/:id", requireRole("admin"), (req: any, res) => {
  const updates: any = {};
  if (req.body?.name !== undefined) updates.name = requiredText(req.body.name, 80);
  if (req.body?.description !== undefined) updates.description = text(req.body.description, 240);
  if (req.body?.icon !== undefined) updates.icon = requiredText(req.body.icon, 40);
  const updated = dbInstance.updateCategory(req.params.id, updates);
  if (!updated) return res.status(404).json({ error: "Categoría no encontrada" });
  dbInstance.logAudit({ actorId: req.user.sub, actorName: req.user.name, action: "update", entity: "category", entityId: req.params.id, details: { fields: Object.keys(updates) } });
  res.json(updated);
});

app.delete("/api/categories/:id", requireRole("admin"), (req: any, res) => {
  const success = dbInstance.deleteCategory(req.params.id);
  if (success) {
    dbInstance.logAudit({ actorId: req.user.sub, actorName: req.user.name, action: "delete", entity: "category", entityId: req.params.id });
    res.json({ success: true });
  } else {
    res.status(404).json({ error: "Categoría no encontrada" });
  }
});

// 4. PRODUCTOS
app.get("/api/products", (req, res) => {
  res.json(dbInstance.getProducts());
});

function parseAllergens(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => text(item, 40).toLowerCase()).filter(Boolean).slice(0, 20);
}

app.post("/api/products", requireRole("admin"), (req: any, res) => {
  const categoryId = requiredText(req.body?.categoryId, 80);
  const name = requiredText(req.body?.name, 120);
  const price = decimal(req.body?.price, 0, 100000, -1);
  if (!categoryId || !name || price < 0) return res.status(400).json({ error: "Categoría, nombre y precio válido son obligatorios." });
  const newProd = dbInstance.createProduct({
    id: `prod-${crypto.randomUUID()}`,
    categoryId,
    name,
    description: text(req.body?.description, 500),
    price,
    image: text(req.body?.image, 300) || "default.jpg",
    allergens: parseAllergens(req.body?.allergens) as any,
    iva: integer(req.body?.iva, 0, 100, 10),
    available: req.body?.available !== false,
    stock: req.body?.stock === null || req.body?.stock === "" || req.body?.stock === undefined ? null : integer(req.body.stock, 0, 100000, 0),
    modifierGroups: Array.isArray(req.body?.modifierGroups) ? req.body.modifierGroups : [],
    station: isStation(req.body?.station) ? req.body.station : "cocina"
  });
  dbInstance.logAudit({ actorId: req.user.sub, actorName: req.user.name, action: "create", entity: "product", entityId: newProd.id, details: { name, price } });
  res.status(201).json(newProd);
});

app.put("/api/products/:id", requireRole("admin"), (req: any, res) => {
  const updates: any = {};
  if (req.body?.categoryId !== undefined) updates.categoryId = requiredText(req.body.categoryId, 80);
  if (req.body?.name !== undefined) updates.name = requiredText(req.body.name, 120);
  if (req.body?.description !== undefined) updates.description = text(req.body.description, 500);
  if (req.body?.price !== undefined) updates.price = decimal(req.body.price, 0, 100000, 0);
  if (req.body?.image !== undefined) updates.image = text(req.body.image, 300);
  if (req.body?.allergens !== undefined) updates.allergens = parseAllergens(req.body.allergens);
  if (req.body?.iva !== undefined) updates.iva = integer(req.body.iva, 0, 100, 10);
  if (req.body?.available !== undefined) updates.available = Boolean(req.body.available);
  if (req.body?.stock !== undefined) updates.stock = req.body.stock === null || req.body.stock === "" ? null : integer(req.body.stock, 0, 100000, 0);
  if (req.body?.modifierGroups !== undefined) updates.modifierGroups = Array.isArray(req.body.modifierGroups) ? req.body.modifierGroups : [];
  if (req.body?.station !== undefined && isStation(req.body.station)) updates.station = req.body.station;
  const updated = dbInstance.updateProduct(req.params.id, updates);
  if (!updated) return res.status(404).json({ error: "Producto no encontrado" });
  dbInstance.logAudit({ actorId: req.user.sub, actorName: req.user.name, action: "update", entity: "product", entityId: req.params.id, details: { fields: Object.keys(updates) } });
  res.json(updated);
});

app.delete("/api/products/:id", requireRole("admin"), (req: any, res) => {
  const success = dbInstance.deleteProduct(req.params.id);
  if (success) {
    dbInstance.logAudit({ actorId: req.user.sub, actorName: req.user.name, action: "delete", entity: "product", entityId: req.params.id });
    res.json({ success: true });
  } else {
    res.status(404).json({ error: "Producto no encontrado" });
  }
});

app.post("/api/catalog/import", requireRole("admin"), (req: any, res) => {
  const mode = req.body?.mode;
  const items = req.body?.items;
  if (!["replace", "append"].includes(mode) || !Array.isArray(items)) {
    return res.status(400).json({ error: "Modo inválido o lista de platos ausente." });
  }
  try {
    const result = dbInstance.importCatalog(mode, items);
    dbInstance.logAudit({ actorId: req.user.sub, actorName: req.user.name, action: "import", entity: "catalog", details: { mode, count: result.count } });
    res.json({ success: true, message: `Se han importado ${result.count} productos correctamente.` });
  } catch (error: any) {
    res.status(500).json({ error: `Fallo al importar el catálogo: ${error.message}` });
  }
});

// 5. PEDIDOS (ORDERS)
app.get("/api/orders", (req: any, res) => {
  const tableId = typeof req.query.tableId === "string" ? req.query.tableId : undefined;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const station = typeof req.query.station === "string" ? req.query.station : undefined;
  const active = req.query.active === "1" || req.query.active === "true";
  const staff = resolveStaff(req);

  if (!staff) {
    if (!tableId) return res.status(401).json({ error: "Se requiere autenticación o el QR de una mesa." });
    if (!verifyTableToken(tableId, extractTableToken(req))) {
      return res.status(403).json({ error: "El QR de esta mesa no es válido." });
    }
    const table = dbInstance.getTableById(tableId);
    if (!table || !table.activeSessionId) return res.json([]);
    const orders = dbInstance.getOrders({
      tableId,
      sessionId: table.activeSessionId,
      limit: 100
    }).filter((order) => order.status !== "cancelado");
    return res.json(orders);
  }

  const orders = dbInstance.getOrders({
    tableId,
    status,
    station,
    active,
    limit: integer(req.query.limit, 1, 1000, 500)
  });
  res.json(orders);
});

app.post("/api/orders", orderLimiter, (req: any, res) => {
  const tableId = requiredText(req.body?.tableId, 80);
  const items = req.body?.items;
  if (!tableId || !Array.isArray(items) || items.length === 0 || items.length > 50) {
    return res.status(400).json({ error: "Datos del pedido inválidos o vacíos" });
  }
  if (!allowTableOrStaff(req, tableId)) {
    return res.status(403).json({ error: "No puedes pedir a esta mesa sin su QR físico." });
  }

  const table = dbInstance.getTableById(tableId);
  if (!table) return res.status(404).json({ error: "La mesa indicada no existe" });

  const sessionId = table.activeSessionId || `sess-${crypto.randomUUID()}`;
  const stockNeeds = new Map<string, number>();
  const processedLines: OrderLine[] = [];

  try {
    for (const [index, rawLine] of items.entries()) {
      const productId = requiredText(rawLine?.productId, 80);
      const quantity = integer(rawLine?.quantity, 1, 99, 0);
      if (!productId || quantity < 1) return res.status(400).json({ error: "Producto o cantidad inválidos." });
      const product = dbInstance.getProductById(productId);
      if (!product || !product.available) return res.status(400).json({ error: `El producto ${productId} no está disponible.` });

      const rawExtras = Array.isArray(rawLine?.selectedExtras) ? rawLine.selectedExtras : [];
      const selectedExtras: Array<{ groupName: string; optionName: string; price: number }> = [];
      for (const group of product.modifierGroups || []) {
        const chosen = rawExtras.filter((extra: any) => extra?.groupName === group.name);
        if (chosen.length > group.maxSelections) return res.status(400).json({ error: `Demasiadas opciones en ${group.name}.` });
        if (group.required && chosen.length === 0) return res.status(400).json({ error: `Debes elegir una opción en ${group.name}.` });
        for (const extra of chosen) {
          const option = group.options.find((candidate) => candidate.name === extra?.optionName);
          if (!option) return res.status(400).json({ error: `Opción no válida en ${group.name}.` });
          selectedExtras.push({ groupName: group.name, optionName: option.name, price: option.price });
        }
      }
      if (rawExtras.length > 0 && (!product.modifierGroups || product.modifierGroups.length === 0)) {
        return res.status(400).json({ error: "Este producto no admite modificadores." });
      }

      const itemPriceUnit = product.price + selectedExtras.reduce((sum, extra) => sum + extra.price, 0);
      const priceTotal = parseFloat((itemPriceUnit * quantity).toFixed(2));
      stockNeeds.set(product.id, (stockNeeds.get(product.id) || 0) + quantity);

      processedLines.push({
        id: `line-${crypto.randomUUID()}`,
        productId: product.id,
        name: product.name,
        quantity,
        priceUnit: parseFloat(itemPriceUnit.toFixed(2)),
        priceTotal,
        notes: text(rawLine?.notes, 240),
        selectedExtras,
        destination: product.station || "cocina",
        taxRate: product.iva,
        stationStatus: "pendiente"
      });
    }
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }

  if (processedLines.length === 0) return res.status(400).json({ error: "Ningún producto válido en el pedido." });
  const totalAmount = parseFloat(processedLines.reduce((sum, line) => sum + line.priceTotal, 0).toFixed(2));
  const newOrder: Order = {
    id: `ord-${crypto.randomUUID()}`,
    tableId,
    tableName: table.name,
    sessionId,
    timestamp: new Date().toISOString(),
    status: "pendiente",
    items: processedLines,
    totalAmount
  };

  let createdOrder: Order;
  try {
    createdOrder = dbInstance.createOrderAtomic(newOrder, Array.from(stockNeeds.entries()).map(([productId, quantity]) => ({ productId, quantity })));
  } catch (error: any) {
    return res.status(409).json({ error: error.message });
  }

  const kitchenItems = processedLines.filter((line) => line.destination === "cocina");
  if (kitchenItems.length > 0) {
    const zplPreview = generateZplTicket(createdOrder, kitchenItems);
    dbInstance.addPrintLog({ orderId: createdOrder.id, zpl: zplPreview, status: "pending", errorMessage: null });
    queuePrinterJob(createdOrder, kitchenItems).catch((error) => console.error("[Printer] Error despachando comanda:", error));
  }

  broadcastEvent("order:created", { id: createdOrder.id, tableId: createdOrder.tableId, status: createdOrder.status, station: kitchenItems.length > 0 ? "cocina" : "bar" });

  const tableName = table.name;
  const itemsSummary = processedLines.slice(0, 3).map((line) => `${line.quantity}x ${line.name}`).join(", ");
  const moreItems = processedLines.length > 3 ? ` +${processedLines.length - 3} más` : "";
  sendPushToRole("camarero", {
    title: `Nuevo pedido - ${tableName}`,
    body: `${itemsSummary}${moreItems}`,
    tag: `new-order-${createdOrder.tableId}`,
    requireInteraction: false,
    vibrate: [150, 50, 150],
    url: "/",
    type: "new_order",
    tableId: createdOrder.tableId
  });

  res.status(201).json(createdOrder);
});

app.put("/api/orders/:id/status", requireStaff, (req: any, res) => {
  const status = req.body?.status;
  const station = req.body?.station;
  if (!isOrderStatus(status)) return res.status(400).json({ error: "Estado no válido" });
  if (station !== undefined && !isStation(station)) return res.status(400).json({ error: "Estación no válida" });
  if (status === "cancelado" && !["admin", "camarero"].includes(req.user.role)) {
    return res.status(403).json({ error: "Solo sala o administración pueden cancelar un pedido." });
  }

  const updated = dbInstance.updateOrderStatus(req.params.id, status as OrderStatus, station);
  if (!updated) return res.status(404).json({ error: "Pedido no encontrado o ya cancelado" });

  broadcastEvent("order:status_changed", { id: updated.id, status: updated.status, station: station || null });
  if (status === "listo") {
    const table = dbInstance.getTableById(updated.tableId);
    if (table?.assignedWaiterId) {
      sendPushToRole("camarero", {
        title: `Pedido listo - ${updated.tableName}`,
        body: `Los platos de la ${updated.tableName} están listos para servir`,
        tag: `order_ready_${updated.id}`,
        requireInteraction: true,
        vibrate: [300, 100, 300],
        url: "/",
        type: "order_ready",
        orderId: updated.id,
        tableId: updated.tableId
      });
    }
  }
  res.json(updated);
});

app.get("/api/orders/:id/confirm", requireStaff, (req, res) => {
  const order = dbInstance.getOrderById(req.params.id);
  if (!order) return res.status(404).json({ error: "Pedido no encontrado" });
  res.json({
    orderId: order.id,
    status: order.status,
    tableId: order.tableId,
    timestamp: new Date().toISOString()
  });
});

// 6. DETALLES DE CUENTA Y CIERRE
app.get("/api/tables/:id/bill", (req: any, res) => {
  const table = dbInstance.getTableById(req.params.id);
  if (!table) return res.status(404).json({ error: "Mesa no encontrada" });
  if (!allowTableOrStaff(req, table.id)) return res.status(403).json({ error: "El QR de esta mesa no es válido." });

  if (!table.activeSessionId) {
    return res.json({ tableId: table.id, tableName: table.name, sessionId: "", items: [], subtotal: 0, taxAmount: 0, total: 0, closedReceipts: [] });
  }

  const sessionOrders = dbInstance.getOrders({ tableId: table.id, sessionId: table.activeSessionId }).filter((order) => order.status !== "cancelado");
  const consolidatedMap: { [key: string]: any } = {};
  let subtotal = 0;
  let taxAmount = 0;

  sessionOrders.forEach((order) => {
    order.items.forEach((line) => {
      const key = `${line.productId}-${line.notes}-${JSON.stringify(line.selectedExtras)}`;
      if (!consolidatedMap[key]) {
        consolidatedMap[key] = {
          productId: line.productId,
          name: line.name,
          quantity: 0,
          priceUnit: line.priceUnit,
          priceTotal: 0,
          notes: line.notes,
          selectedExtras: line.selectedExtras,
          destination: line.destination,
          taxRate: line.taxRate ?? (line.destination === "bar" ? 21 : 10)
        };
      }
      consolidatedMap[key].quantity += line.quantity;
      consolidatedMap[key].priceTotal = parseFloat((consolidatedMap[key].priceTotal + line.priceTotal).toFixed(2));
      subtotal += line.priceTotal;
      taxAmount += taxFromGross(line.priceTotal, line.taxRate ?? (line.destination === "bar" ? 21 : 10));
    });
  });

  const receipts = dbInstance.getClosedReceipts({ limit: 100 }).filter((receipt) => receipt.sessionId === table.activeSessionId);

  res.json({
    tableId: table.id,
    tableName: table.name,
    sessionId: table.activeSessionId,
    openedAt: table.sessionStartedAt,
    items: Object.values(consolidatedMap),
    subtotal: parseFloat(subtotal.toFixed(2)),
    taxAmount: parseFloat(taxAmount.toFixed(2)),
    total: table.currentBillTotal !== null ? table.currentBillTotal : parseFloat(subtotal.toFixed(2)),
    closedReceipts: receipts
  });
});

app.post("/api/tables/:id/close", requireRole("admin", "camarero"), (req: any, res) => {
  const customItems = Array.isArray(req.body?.customItems) ? req.body.customItems : undefined;
  const splitMethod = ["completa", "partes_iguales", "por_lineas"].includes(req.body?.splitMethod) ? req.body.splitMethod : "completa";
  const paymentMethod = ["efectivo", "tarjeta", "bizum", "otro"].includes(req.body?.paymentMethod) ? req.body.paymentMethod : "efectivo";
  const tableId = req.params.id;
  const closed = dbInstance.closeTableSession(tableId, customItems, splitMethod, { paymentMethod, closedBy: req.user.name });
  
  if (closed) {
    // Auto-print ticket when bill is closed (only if there are items)
    if ("items" in closed && closed.items && closed.items.length > 0) {
      const receipt = closed as any;
      const isSplit = splitMethod && splitMethod !== "completa";
      queueTicketPrintJob({
        tableName: receipt.tableName || "Mesa",
        items: receipt.items.map((i: any) => ({
          name: i.name,
          quantity: i.quantity,
          priceTotal: i.priceTotal
        })),
        subtotal: receipt.subtotal,
        taxAmount: receipt.taxAmount,
        total: receipt.total,
        timestamp: receipt.timestamp || new Date().toISOString(),
        receiptId: receipt.id,
        title: isSplit ? "Pago Parcial (Ticket)" : "Factura Simplificada",
        splitMethod,
        invoiceNumber: receipt.invoiceNumber
      }).catch(err => console.error("Error imprimiendo ticket:", err));

      // Si es pago fraccionado, imprimir también ticket del resto pendiente
      const tableAfter = dbInstance.getTableById(tableId);
      if (tableAfter && tableAfter.status === "pendiente_pago" && tableAfter.currentBillTotal > 0 && tableAfter.activeSessionId) {
        const remainingOrders = dbInstance.getOrders({ tableId, sessionId: tableAfter.activeSessionId }).filter((order) => order.status !== "cancelado");
        const remainingItems: Array<{ name: string; quantity: number; priceTotal: number }> = [];
        let remainingSubtotal = 0;
        let remainingTax = 0;
        remainingOrders.forEach(o => {
          o.items.forEach(line => {
            remainingItems.push({
              name: line.name + (line.selectedExtras.length > 0 ? ` (${line.selectedExtras.map(e => e.optionName).join(", ")})` : ""),
              quantity: line.quantity,
              priceTotal: line.priceTotal
            });
            remainingSubtotal += line.priceTotal;
            remainingTax += taxFromGross(line.priceTotal, line.taxRate ?? (line.destination === "bar" ? 21 : 10));
          });
        });
        if (remainingItems.length > 0) {
          queueTicketPrintJob({
            tableName: receipt.tableName || "Mesa",
            items: [{ name: "*** RESTO PENDIENTE ***", quantity: 1, priceTotal: 0 }, ...remainingItems],
            subtotal: remainingSubtotal,
            taxAmount: remainingTax,
            total: tableAfter.currentBillTotal,
            timestamp: new Date().toISOString(),
            receiptId: `resto-${Date.now()}`,
            title: "Resto Pendiente",
            splitMethod
          }).catch(err => console.error("Error imprimiendo ticket de resto:", err));
        }
      }
    }
    dbInstance.logAudit({
      actorId: req.user.sub,
      actorName: req.user.name,
      action: "charge",
      entity: "receipt",
      entityId: (closed as any).id,
      details: { tableId, splitMethod, paymentMethod, total: (closed as any).total }
    });
    broadcastEvent("table:updated", { tableId, status: "closed" });
    broadcastEvent("tables_updated", { tableId });
    res.json({ success: true, receipt: closed });
  } else {
    res.status(404).json({ error: "La mesa no está ocupada o no tiene sesión activa que cerrar" });
  }
});

// 6b. IMPRIMIR TICKET MANUALMENTE
app.post("/api/tables/:id/print-ticket", requireRole("admin", "camarero"), (req, res) => {
  const table = dbInstance.getTableById(req.params.id);
  if (!table) return res.status(404).json({ error: "Mesa no encontrada" });
  if (!table.activeSessionId) return res.status(400).json({ error: "La mesa no tiene sesión activa" });

  const sessionOrders = dbInstance.getOrders({ tableId: table.id, sessionId: table.activeSessionId }).filter((order) => order.status !== "cancelado");
  if (sessionOrders.length === 0) return res.status(400).json({ error: "No hay pedidos activos para esta mesa" });

  const items: Array<{ name: string; quantity: number; priceTotal: number }> = [];
  let subtotal = 0;
  let taxAmount = 0;
  for (const order of sessionOrders) {
    for (const line of order.items) {
      items.push({
        name: line.name + (line.selectedExtras.length > 0 ? ` (${line.selectedExtras.map((extra) => extra.optionName).join(", ")})` : ""),
        quantity: line.quantity,
        priceTotal: line.priceTotal
      });
      subtotal += line.priceTotal;
      taxAmount += taxFromGross(line.priceTotal, line.taxRate ?? (line.destination === "bar" ? 21 : 10));
    }
  }

  queueTicketPrintJob({
    tableName: table.name,
    items,
    subtotal,
    taxAmount,
    total: subtotal,
    timestamp: new Date().toISOString(),
    title: "Consulta de Mesa (Pre-factura)"
  }).catch((error) => console.error("Error en impresión manual de ticket:", error));

  res.json({ success: true, message: "Ticket enviado a la impresora" });
});

// 6c. REIMPRIMIR RECIBO (para tickets modificados)
app.post("/api/print-receipt", requireRole("admin", "camarero"), (req, res) => {
  const { tableName, items, subtotal, taxAmount, total, timestamp } = req.body;
  if (!items || items.length === 0) {
    return res.status(400).json({ error: "No hay items para imprimir" });
  }
  queueTicketPrintJob({
    tableName: tableName || "Mesa",
    items: items.map((i: any) => ({ name: i.name, quantity: i.quantity, priceTotal: i.priceTotal })),
    subtotal: subtotal || 0,
    taxAmount: taxAmount || 0,
    total: total || 0,
    timestamp: timestamp || new Date().toISOString(),
    title: "Reimpresion de Ticket"
  }).catch(err => console.error("Error reimprimiendo ticket:", err));
  res.json({ success: true, message: "Reimpresión enviada" });
});

// 6d. ENDPOINT PARA GENERAR ZPL (usado por impresión directa desde navegador)
app.get("/api/orders/:id/zpl", requireStaff, (req, res) => {
  const order = dbInstance.getOrderById(req.params.id);
  if (!order) return res.status(404).json({ error: "Pedido no encontrado" });
  const kitchenItems = order.items.filter((item) => item.destination === "cocina");
  const zpl = kitchenItems.length > 0 ? generateZplTicket(order, kitchenItems) : generateZplTicket(order, order.items);
  res.json({ id: order.id, tableName: order.tableName, timestamp: order.timestamp, zpl, items: order.items });
});

function parsePrinterConfig(body: any): PrinterConfig | null {
  const ip = requiredText(body?.ip, 45);
  const port = integer(body?.port, 1, 65535, 9100);
  const name = requiredText(body?.name, 80);
  const printMode = body?.printMode === "server" ? "server" : "browser";
  if (!ip || !name) return null;
  if (!isPrivateAddress(ip)) return null;
  return { ip, port, name, enabled: Boolean(body?.enabled), printMode };
}

// 6e. ENDPOINT PARA RECIBIR ZPL E IMPRIMIR (proxy desde navegador)
app.post("/api/print/zpl", requireRole("admin"), (req: any, res) => {
  const zpl = typeof req.body?.zpl === "string" ? req.body.zpl : "";
  if (!zpl || zpl.length > 50000) return res.status(400).json({ error: "ZPL inválido o demasiado grande." });
  const targetIp = requiredText(req.body?.ip, 45) || dbInstance.getPrinterConfig().ip;
  const targetPort = integer(req.body?.port, 1, 65535, dbInstance.getPrinterConfig().port);
  if (!isPrivateAddress(targetIp)) return res.status(400).json({ error: "La impresora debe estar en la red local." });

  sendRawZplToNetworkPrinter(targetIp, targetPort, zpl, 10000)
    .then(() => {
      dbInstance.addPrintLog({ orderId: `direct-${crypto.randomUUID()}`, zpl, status: "sent", errorMessage: null });
      dbInstance.logAudit({ actorId: req.user.sub, actorName: req.user.name, action: "print", entity: "printer", details: { ip: targetIp, port: targetPort } });
      res.json({ success: true });
    })
    .catch((error) => res.status(502).json({ success: false, error: error.message }));
});

// 7. CONFIGURACIÓN DE IMPRESION E HISTORIAL
app.get("/api/printer-config", requireRole("admin"), (req, res) => {
  res.json(dbInstance.getPrinterConfig());
});

app.post("/api/printer-config", requireRole("admin"), (req: any, res) => {
  const config = parsePrinterConfig(req.body);
  if (!config) return res.status(400).json({ error: "IP privada/local, puerto y nombre válidos son obligatorios." });
  const updated = dbInstance.updatePrinterConfig(config);
  dbInstance.logAudit({ actorId: req.user.sub, actorName: req.user.name, action: "update", entity: "printer", entityId: "kitchen", details: config });
  res.json(updated);
});

// 7b. CONFIGURACIÓN DE IMPRESORA DE TICKETS
app.get("/api/ticket-printer-config", requireRole("admin"), (req, res) => {
  res.json(dbInstance.getTicketPrinterConfig());
});

app.post("/api/ticket-printer-config", requireRole("admin"), (req: any, res) => {
  const config = parsePrinterConfig(req.body);
  if (!config) return res.status(400).json({ error: "IP privada/local, puerto y nombre válidos son obligatorios." });
  const updated = dbInstance.updateTicketPrinterConfig(config);
  dbInstance.logAudit({ actorId: req.user.sub, actorName: req.user.name, action: "update", entity: "printer", entityId: "ticket", details: config });
  res.json(updated);
});

app.get("/api/print-logs", requireRole("admin"), (req, res) => {
  res.json(dbInstance.getPrintLogs());
});

// 7c. PLANTILLA DE TICKET PERSONALIZABLE DESDE ADMIN
app.get("/api/ticket-template", requireRole("admin"), (req, res) => {
  res.json(dbInstance.getTicketTemplate());
});

app.put("/api/ticket-template", requireRole("admin"), (req: any, res) => {
  const template: any = {};
  const allowed = ["businessName", "headerTitle", "footerThanks", "footerUrl", "kitchenHeader", "kitchenFooter", "labelCant", "labelDescripcion", "labelTotal", "labelFactura", "labelMesa", "labelTicket", "labelMetodoPago", "labelSubtotal", "labelIva", "labelTotalFinal"];
  for (const key of allowed) {
    if (req.body?.[key] !== undefined) template[key] = text(req.body[key], 120);
  }
  if (req.body?.paperWidth !== undefined) template.paperWidth = decimal(req.body.paperWidth, 4, 30, 10.45);
  if (req.body?.paperHeight !== undefined) template.paperHeight = decimal(req.body.paperHeight, 4, 40, 14.5);
  const updated = dbInstance.updateTicketTemplate(template);
  dbInstance.logAudit({ actorId: req.user.sub, actorName: req.user.name, action: "update", entity: "ticket_template", details: { fields: Object.keys(template) } });
  res.json(updated);
});

app.post("/api/print-test", requireRole("admin"), (req: any, res) => {
  const type = req.body?.type === "ticket" ? "ticket" : "kitchen";
  const config = type === "ticket" ? dbInstance.getTicketPrinterConfig() : dbInstance.getPrinterConfig();
  if (!config.enabled) return res.status(400).json({ error: "La impresora está deshabilitada." });
  if (!isPrivateAddress(config.ip)) return res.status(400).json({ error: "La impresora configurada no está en la red local." });

  const mockOrder: Order = {
    id: `ord-test-${Date.now()}`,
    tableId: "table-test",
    tableName: "Mesa de prueba",
    sessionId: "sess-test",
    timestamp: new Date().toISOString(),
    status: "pendiente",
    items: [{
      id: `line-test-${Date.now()}`,
      productId: "prod-test",
      name: type === "ticket" ? "Prueba Ticket Cliente" : "Test Impresión Directa",
      quantity: 2,
      priceUnit: 5,
      priceTotal: 10,
      notes: type === "ticket" ? "Prueba ZPL Factura" : "Prueba ZPL por red",
      selectedExtras: [],
      destination: type === "ticket" ? "bar" : "cocina",
      taxRate: 10,
      stationStatus: "pendiente"
    }],
    totalAmount: 10
  };

  const zpl = generateZplTicket(mockOrder, mockOrder.items);
  sendRawZplToNetworkPrinter(config.ip, config.port, zpl, 10000)
    .then(() => {
      dbInstance.addPrintLog({ orderId: mockOrder.id, zpl, status: "sent", errorMessage: null });
      dbInstance.logAudit({ actorId: req.user.sub, actorName: req.user.name, action: "print_test", entity: "printer", entityId: type });
      res.json({ success: true, message: `ZPL enviado a ${config.ip}:${config.port}` });
    })
    .catch((error) => {
      dbInstance.addPrintLog({ orderId: mockOrder.id, zpl, status: "failed", errorMessage: error.message });
      res.status(502).json({ success: false, error: error.message, message: "No se pudo alcanzar la impresora desde el servidor." });
    });
});

// 8. ESTADÍSTICAS ADMIN
app.get("/api/stats", requireRole("admin"), (req, res) => {
  res.json(dbInstance.getStats({
    from: typeof req.query.from === "string" ? req.query.from : undefined,
    to: typeof req.query.to === "string" ? req.query.to : undefined
  }));
});

// 9. VENTAS POR MESA
app.get("/api/sales-by-table", requireRole("admin"), (req, res) => {
  res.json(dbInstance.getSalesByTable({
    from: typeof req.query.from === "string" ? req.query.from : undefined,
    to: typeof req.query.to === "string" ? req.query.to : undefined
  }));
});

// 10. HISTORIAL DE TICKETS CERRADOS (admin)
app.get("/api/closed-receipts", requireRole("admin"), (req, res) => {
  res.json(dbInstance.getClosedReceipts({
    from: typeof req.query.from === "string" ? req.query.from : undefined,
    to: typeof req.query.to === "string" ? req.query.to : undefined,
    limit: integer(req.query.limit, 1, 5000, 500)
  }));
});

app.put("/api/closed-receipts/:id", requireRole("admin"), (req: any, res) => {
  const before = dbInstance.getClosedReceipts({ limit: 5000 }).find((receipt) => receipt.id === req.params.id);
  if (!before) return res.status(404).json({ error: "Ticket no encontrado" });
  const updates: any = {};
  if (Array.isArray(req.body?.items)) {
    updates.items = req.body.items.slice(0, 200).map((item: any) => ({
      name: requiredText(item?.name, 160) || "Artículo",
      quantity: integer(item?.quantity, 0, 999, 0),
      priceUnit: decimal(item?.priceUnit, 0, 100000, 0),
      priceTotal: decimal(item?.priceTotal, 0, 100000, 0)
    }));
  }
  if (req.body?.subtotal !== undefined) updates.subtotal = decimal(req.body.subtotal, 0, 100000, before.subtotal);
  if (req.body?.taxAmount !== undefined) updates.taxAmount = decimal(req.body.taxAmount, 0, 100000, before.taxAmount);
  if (req.body?.total !== undefined) updates.total = decimal(req.body.total, 0, 100000, before.total);
  if (["efectivo", "tarjeta", "bizum", "otro"].includes(req.body?.paymentMethod)) updates.paymentMethod = req.body.paymentMethod;
  const updated = dbInstance.updateClosedReceipt(req.params.id, updates);
  dbInstance.logAudit({
    actorId: req.user.sub,
    actorName: req.user.name,
    action: "modify_receipt",
    entity: "receipt",
    entityId: req.params.id,
    details: { before: { total: before.total, items: before.items }, after: updates }
  });
  res.json(updated);
});

app.get("/api/audit-log", requireRole("admin"), (req, res) => {
  res.json(dbInstance.getAuditLogs(integer(req.query.limit, 1, 1000, 200)));
});

// 11. LLAMADAS AL CAMARERO (WAITER CALLS)
app.get("/api/waiter-calls", requireStaff, (req, res) => {
  res.json(dbInstance.getPendingWaiterCalls());
});

app.post("/api/waiter-calls", waiterCallLimiter, (req: any, res) => {
  const tableId = requiredText(req.body?.tableId, 80);
  const reason = req.body?.reason;
  if (!tableId || !["cuenta", "ayuda", "cubiertos", "limpieza", "duda"].includes(reason)) {
    return res.status(400).json({ error: "Parámetros de llamada inválidos." });
  }
  if (!allowTableOrStaff(req, tableId)) {
    return res.status(403).json({ error: "No puedes llamar desde esta mesa sin su QR físico." });
  }
  const table = dbInstance.getTableById(tableId);
  if (!table) return res.status(404).json({ error: "Mesa no encontrada" });

  const call = dbInstance.addWaiterCall({ tableId, tableName: table.name, reason });
  broadcastEvent("waiter_call_new", call);

  const reasonLabels: Record<string, string> = {
    cuenta: "Solicita la cuenta",
    ayuda: "Necesita ayuda",
    cubiertos: "Pide cubiertos",
    limpieza: "Solicita limpieza",
    duda: "Tiene una pregunta"
  };
  sendPushToRole("camarero", {
    title: `Llamada - ${table.name}`,
    body: reasonLabels[reason] || reason,
    tag: `waiter-call-${tableId}`,
    requireInteraction: true,
    vibrate: [300, 100, 300, 100, 300],
    url: "/",
    type: "waiter_call",
    tableId
  });

  res.status(201).json(call);
});

app.put("/api/waiter-calls/:id/resolve", requireStaff, (req: any, res) => {
  const success = dbInstance.resolveWaiterCall(req.params.id);
  if (success) {
    broadcastEvent("waiter_call_resolved", { id: req.params.id });
    dbInstance.logAudit({ actorId: req.user.sub, actorName: req.user.name, action: "resolve", entity: "waiter_call", entityId: req.params.id });
    res.json({ success: true });
  } else {
    res.status(404).json({ error: "Llamada no encontrada o ya resuelta" });
  }
});

// 11b. WEB PUSH SUBSCRIPTIONS
app.get("/api/push/vapid-public-key", (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

app.post("/api/push/subscribe", requireStaff, (req: any, res) => {
  const subscription = req.body?.subscription;
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return res.status(400).json({ error: "Suscripción inválida" });
  }
  dbInstance.savePushSubscription(req.user.sub, req.user.role, subscription);
  res.json({ success: true });
});

app.post("/api/push/unsubscribe", (req, res) => {
  const endpoint = requiredText(req.body?.endpoint, 500);
  if (endpoint) dbInstance.deletePushSubscription(endpoint);
  res.json({ success: true });
});

// Helper: send push to all devices of a role
async function sendPushToRole(role: string, payload: object) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;
  const subs = dbInstance.getPushSubscriptionsByRole(role);
  const payloadStr = JSON.stringify(payload);
  const results = await Promise.allSettled(
    subs.map(sub =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payloadStr
      ).catch(err => {
        if (err.statusCode === 410 || err.statusCode === 404) {
          // Subscription expired - remove it
          dbInstance.deletePushSubscription(sub.endpoint);
        }
        throw err;
      })
    )
  );
  const failed = results.filter(r => r.status === "rejected").length;
  if (subs.length > 0) {
    console.log(`[WebPush] Sent to ${subs.length - failed}/${subs.length} ${role} subscriptions`);
  }
}

// 12. OPERACIONES SOBRE LA CUENTA DE LA MESA (SWIPE ACTIONS)
function billItemPayload(req: any) {
  const productId = requiredText(req.body?.productId, 80);
  const notes = text(req.body?.notes, 240);
  const selectedExtras = Array.isArray(req.body?.selectedExtras) ? req.body.selectedExtras.slice(0, 30) : [];
  return { productId, notes, selectedExtras };
}

app.delete("/api/tables/:tableId/bill/items", requireRole("admin", "camarero"), (req: any, res) => {
  const { productId, notes, selectedExtras } = billItemPayload(req);
  if (!productId) return res.status(400).json({ error: "Producto inválido" });
  const success = dbInstance.deleteBillItem(req.params.tableId, productId, notes, selectedExtras);
  if (!success) return res.status(400).json({ error: "No se pudo eliminar el producto de la cuenta" });
  broadcastEvent("tables_updated", { tableId: req.params.tableId });
  broadcastEvent("orders_updated", { tableId: req.params.tableId });
  dbInstance.logAudit({ actorId: req.user.sub, actorName: req.user.name, action: "delete_item", entity: "bill", entityId: req.params.tableId, details: { productId, notes } });
  res.json({ success: true });
});

app.put("/api/tables/:tableId/bill/items/note", requireRole("admin", "camarero"), (req: any, res) => {
  const { productId, selectedExtras } = billItemPayload(req);
  const oldNotes = text(req.body?.oldNotes, 240);
  const newNotes = text(req.body?.newNotes, 240);
  if (!productId) return res.status(400).json({ error: "Producto inválido" });
  const success = dbInstance.updateBillItemNote(req.params.tableId, productId, oldNotes, selectedExtras, newNotes);
  if (!success) return res.status(400).json({ error: "No se pudo actualizar la nota" });
  broadcastEvent("tables_updated", { tableId: req.params.tableId });
  broadcastEvent("orders_updated", { tableId: req.params.tableId });
  res.json({ success: true });
});

app.put("/api/tables/:tableId/bill/items/serve", requireRole("admin", "camarero"), (req: any, res) => {
  const { productId, notes, selectedExtras } = billItemPayload(req);
  if (!productId) return res.status(400).json({ error: "Producto inválido" });
  const success = dbInstance.serveBillItem(req.params.tableId, productId, notes, selectedExtras);
  if (!success) return res.status(400).json({ error: "No se pudo marcar el producto como servido" });
  broadcastEvent("tables_updated", { tableId: req.params.tableId });
  broadcastEvent("orders_updated", { tableId: req.params.tableId });
  res.json({ success: true });
});

// -------------------------------------------------------------
// SSE ENDPOINT PARA EVENTOS EN TIEMPO REAL
// -------------------------------------------------------------

let sseClients: Array<{ id: string; res: any }> = [];
let lastEventId = dbInstance.getLastEventId();

app.get("/api/events", requireStaff, (req: any, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  res.write("event: connected\ndata: {\"type\":\"connected\"}\n\n");

  const clientId = `sse-${crypto.randomUUID()}`;
  const client = { id: clientId, res };
  sseClients.push(client);
  const heartbeat = setInterval(() => {
    try { res.write(": ping\n\n"); } catch { /* ignore */ }
  }, 25000);
  heartbeat.unref();

  req.on("close", () => {
    clearInterval(heartbeat);
    sseClients = sseClients.filter((entry) => entry.id !== clientId);
  });
});

function broadcastLocal(event: string, data: unknown) {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.res.write(message); } catch { /* ignore */ }
  }
}

function broadcastEvent(event: string, data: unknown) {
  dbInstance.publishEvent(event, data);
}

const eventRelay = setInterval(() => {
  const events = dbInstance.getEventsSince(lastEventId);
  if (events.length === 0) return;
  for (const entry of events) {
    lastEventId = entry.id;
    try {
      broadcastLocal(entry.event, JSON.parse(entry.data));
    } catch { /* ignore malformed event */ }
  }
}, 500);
eventRelay.unref();

const eventCleanup = setInterval(() => {
  dbInstance.pruneEvents();
  dbInstance.cleanupRevokedTokens();
}, 10 * 60 * 1000);
eventCleanup.unref();

app.use("/api", (req, res) => {
  res.status(404).json({ error: "Endpoint no encontrado" });
});

app.use((error: any, req: any, res: any, next: any) => {
  if (res.headersSent) return next(error);
  console.error("[API Error]", error);
  res.status(error?.status || 500).json({ error: error?.message || "Error interno del servidor" });
});

// -------------------------------------------------------------
// VITE INTEGRATION Y SERVIDORES DE ARCHIVOS ESTATICO
// -------------------------------------------------------------

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath, {
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith(".html")) {
          res.setHeader("Cache-Control", "no-cache");
        } else if (/\.[a-f0-9]{8,}\.(js|css|woff2?|png|svg)$/i.test(filePath)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      }
    }));
    app.get("*", (req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`[GastroOS] Servidor en http://localhost:${PORT} (${process.env.NODE_ENV || "development"})`);
  });

  const shutdown = (signal: string) => {
    console.log(`[GastroOS] Cerrando por ${signal}...`);
    clearInterval(eventRelay);
    clearInterval(eventCleanup);
    for (const client of sseClients) {
      try { client.res.end(); } catch { /* ignore */ }
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

startServer().catch((error) => {
  console.error("Error iniciando servidor unificado:", error);
  process.exit(1);
});
