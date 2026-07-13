/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import path from "path";
import net from "net";
import { createServer as createViteServer } from "vite";
import { dbInstance, hashPassword } from "./server/db";
import crypto from "crypto";
import { Order, OrderLine, PrinterConfig, OrderStatus, TicketTemplate } from "./src/types";
import webpush from "web-push";

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
const PORT = 3000;

app.use(express.json());

// Configuración de tipo de aplicación para la separación de despliegues (Coolify)
const APP_TYPE = process.env.APP_TYPE || "both"; // "client", "internal", "both"

// Middleware de seguridad global para restringir accesos según el rol de la instancia (Coolify APP_TYPE)
app.use((req: any, res: any, next: any) => {
  if (APP_TYPE === "client") {
    // Restringir todas las operaciones de escritura (POST, PUT, DELETE) excepto enviar un pedido
    const isWriteOp = ["POST", "PUT", "DELETE"].includes(req.method);
    const isPostOrder = req.method === "POST" && req.path === "/api/orders";
    
    // Restringir GET de datos sensibles de administración o impresión
    const isSensitiveGet = req.method === "GET" && [
      "/api/printer-config",
      "/api/ticket-printer-config",
      "/api/print-logs",
      "/api/stats",
      "/api/sales-by-table",
      "/api/closed-receipts"
    ].includes(req.path);

    if ((isWriteOp && !isPostOrder) || isSensitiveGet) {
      return res.status(403).json({ 
        error: "Acceso denegado. Esta instancia de GastroOS está restringida para el acceso de clientes únicamente." 
      });
    }
  }
  next();
});

// Endpoint público para obtener la configuración del tipo de app
app.get("/api/app-config", (req, res) => {
  res.json({ appType: APP_TYPE });
});

// Health check para Coolify
app.get("/health", (req, res) => {
  res.json({ status: "ok", appType: APP_TYPE });
});

// -------------------------------------------------------------
// LÓGICA DE GENERACIÓN DE ZPL Y ENVÍO A IMPRESORA
// -------------------------------------------------------------

// Generador de formato ZPL para comandos de etiquetas Zebra
let ticketCounter = 1000;
function nextTicketNum(): number {
  return ++ticketCounter;
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

export function generateZplTicket(order: Order, items: OrderLine[]): string {
  const tmpl = getTemplateConfig();
  const tNum = nextTicketNum();
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
  zpl += `^FO${margin},${scaleY(140, tmpl)}^A0N,${scaleFont(22, tmpl)},${scaleFont(22, tmpl)}^FB${wBlock},1,0,R,0^FDID: ${order.id.slice(-6).toUpperCase()}^FS\n`;
  // Mesa y Fecha
  zpl += `^FO${margin},${scaleY(175, tmpl)}^A0N,${scaleFont(26, tmpl)},${scaleFont(26, tmpl)}^FD${tmpl.labelMesa}: ${order.tableName}^FS\n`;
  zpl += `^FO${margin},${scaleY(205, tmpl)}^A0N,${scaleFont(22, tmpl)},${scaleFont(22, tmpl)}^FD${new Date(order.timestamp).toLocaleString("es-ES")}^FS\n`;

  const sepW = pw - scaleX(80, tmpl);
  zpl += `^FO${margin},${scaleY(235, tmpl)}^GB${sepW},2,2^FS\n`;

  let currentY = 255;
  items.forEach((item) => {
    const y = scaleY(currentY, tmpl);
    zpl += `^FO${margin},${y}^A0N,${scaleFont(24, tmpl)},${scaleFont(24, tmpl)}^FD${item.quantity}x^FS\n`;
    zpl += `^FO${margin + scaleX(60, tmpl)},${y}^A0N,${scaleFont(24, tmpl)},${scaleFont(24, tmpl)}^FB${pw - margin - scaleX(100, tmpl)},1,0,L,0^FD${item.name}^FS\n`;
    currentY += 30;
    if (item.selectedExtras && item.selectedExtras.length > 0) {
      const extrasStr = item.selectedExtras.map(e => `+ ${e.optionName}`).join(", ");
      zpl += `^FO${margin + scaleX(80, tmpl)},${scaleY(currentY, tmpl)}^A0N,${scaleFont(20, tmpl)},${scaleFont(20, tmpl)}^FB${pw - margin - scaleX(120, tmpl)},1,0,L,0^FD${extrasStr}^FS\n`;
      currentY += 25;
    }
    if (item.notes) {
      zpl += `^FO${margin + scaleX(80, tmpl)},${scaleY(currentY, tmpl)}^A0N,${scaleFont(20, tmpl)},${scaleFont(20, tmpl)}^FB${pw - margin - scaleX(120, tmpl)},1,0,L,0^FDNota: "${item.notes}"^FS\n`;
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
}): string {
  const tmpl = getTemplateConfig();
  const tNum = nextTicketNum();
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
  zpl += `^FO${margin},${scaleY(95, tmpl)}^A0N,${scaleFont(26, tmpl)},${scaleFont(26, tmpl)}^FB${wBlock},1,0,C,0^FD${(receipt.title || tmpl.headerTitle).toUpperCase()}^FS\n`;

  let yInfo = 140;
  // Factura a la izquierda e ID a la derecha en la misma línea
  zpl += `^FO${margin},${scaleY(yInfo, tmpl)}^A0N,${scaleFont(22, tmpl)},${scaleFont(22, tmpl)}^FD${tmpl.labelFactura}: F-${String(tNum).padStart(5, "0")}^FS\n`;
  if (receipt.receiptId) {
    zpl += `^FO${margin},${scaleY(yInfo, tmpl)}^A0N,${scaleFont(22, tmpl)},${scaleFont(22, tmpl)}^FB${wBlock},1,0,R,0^FDID: ${receipt.receiptId.slice(-8).toUpperCase()}^FS\n`;
  }
  yInfo += 27;
  // Mesa y Fecha
  zpl += `^FO${margin},${scaleY(yInfo, tmpl)}^A0N,${scaleFont(22, tmpl)},${scaleFont(22, tmpl)}^FD${tmpl.labelMesa}: ${receipt.tableName}^FS\n`;
  yInfo += 25;
  zpl += `^FO${margin},${scaleY(yInfo, tmpl)}^A0N,${scaleFont(22, tmpl)},${scaleFont(22, tmpl)}^FD${new Date(receipt.timestamp).toLocaleString("es-ES")}^FS\n`;
  yInfo += 25;
  if (receipt.receiptId) {
    zpl += `^FO${margin},${scaleY(yInfo, tmpl)}^A0N,${scaleFont(22, tmpl)},${scaleFont(22, tmpl)}^FD${tmpl.labelTicket}: ${receipt.receiptId}^FS\n`;
    yInfo += 25;
  }
  if (receipt.splitMethod && receipt.splitMethod !== "completa") {
    zpl += `^FO${margin},${scaleY(yInfo, tmpl)}^A0N,${scaleFont(22, tmpl)},${scaleFont(22, tmpl)}^FD${tmpl.labelMetodoPago}: Fraccionado (${receipt.splitMethod.replace("_", " ")})^FS\n`;
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
    zpl += `^FO${margin + scaleX(80, tmpl)},${y}^A0N,${scaleFont(22, tmpl)},${scaleFont(22, tmpl)}^FB${pw - margin - scaleX(250, tmpl)},1,0,L,0^FD${item.name.slice(0, 24)}^FS\n`;
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

const JWT_SECRET = process.env.JWT_SECRET || crypto.createHash("sha256").update("gastro-os-fallback-dev-key").digest("hex");

function generateToken(userId: string, role: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub: userId, role, iat: Date.now(), exp: Date.now() + 86400000 })).toString("base64url");
  const signature = crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function verifyToken(token: string): { sub: string; role: string } | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, payload, signature] = parts;
    const expectedSig = crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${payload}`).digest("base64url");
    if (signature !== expectedSig) return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (data.exp < Date.now()) return null;
    return { sub: data.sub, role: data.role };
  } catch { return null; }
}

function requireStaff(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Se requiere autenticación" });
  }
  const token = authHeader.slice(7);
  const user = verifyToken(token);
  if (!user) {
    return res.status(401).json({ error: "Token inválido o expirado" });
  }
  req.user = user;
  next();
}

// -------------------------------------------------------------
// ENDPOINTS DE LA API DE RESTAURANTE
// -------------------------------------------------------------

// 1. AUTENTICACIÓN
app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
     return res.status(400).json({ error: "Introduce usuario y contraseña" });
  }

  const users = dbInstance.getUsers();
  const hashedPassword = hashPassword(password);
  const foundUser = users.find(u => u.username.toLowerCase() === username.toLowerCase() && u.passwordHash === hashedPassword);

  if (foundUser) {
    const { passwordHash, ...userProfile } = foundUser;
    return res.json({
      success: true,
      token: generateToken(userProfile.id, userProfile.role),
      user: userProfile
    });
  } else {
    return res.status(401).json({ error: "Credenciales de acceso incorrectas" });
  }
});

// 1b. GESTIÓN DE USUARIOS / PERSONAL (Solo administradores)
app.get("/api/users", requireStaff, (req: any, res) => {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Acceso denegado. Se requieren privilegios de Administrador." });
  }
  const users = dbInstance.getUsers().map(({ id, username, name, role }) => ({ id, username, name, role }));
  res.json(users);
});

app.post("/api/users", requireStaff, (req: any, res) => {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Acceso denegado. Se requieren privilegios de Administrador." });
  }
  const { username, name, role, password } = req.body;
  if (!username || !name || !role || !password) {
    return res.status(400).json({ error: "Por favor, introduce todos los campos requeridos." });
  }

  const existing = dbInstance.getUsers().find(u => u.username.toLowerCase() === username.toLowerCase());
  if (existing) {
    return res.status(400).json({ error: "El nombre de usuario ya está registrado." });
  }

  const newUser = {
    id: `usr-${Date.now()}`,
    username,
    name,
    role,
    passwordHash: hashPassword(password)
  };
  dbInstance.addUser(newUser);
  res.json({ success: true, user: { id: newUser.id, username: newUser.username, name: newUser.name, role: newUser.role } });
});

app.delete("/api/users/:id", requireStaff, (req: any, res) => {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Acceso denegado. Se requieren privilegios de Administrador." });
  }
  const { id } = req.params;
  const deleted = dbInstance.deleteUser(id);
  if (deleted) {
    res.json({ success: true, message: "Usuario eliminado correctamente." });
  } else {
    res.status(400).json({ error: "No se pudo eliminar el usuario (el administrador raíz no se puede borrar)." });
  }
});

// 2. MESAS
app.get("/api/tables", (req, res) => {
  res.json(dbInstance.getTables());
});

app.get("/api/tables/:id", (req, res) => {
  const table = dbInstance.getTableById(req.params.id);
  if (table) {
    res.json(table);
  } else {
    res.status(404).json({ error: "Mesa no encontrada" });
  }
});

app.post("/api/tables", requireStaff, (req, res) => {
  const { number, name } = req.body;
  if (!number || !name) {
    return res.status(400).json({ error: "Número y nombre de mesa obligatorios" });
  }
  
  // URL de la aplicación
  const appUrl = `http://localhost:${PORT}`;
  const table = dbInstance.createTable({
    number: parseInt(number),
    name,
    appUrl
  });
  res.status(201).json(table);
});

app.delete("/api/tables/:id", requireStaff, (req, res) => {
  const success = dbInstance.deleteTable(req.params.id);
  if (success) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: "Mesa no encontrada" });
  }
});

app.put("/api/tables/:id/position", requireStaff, (req, res) => {
  const { posX, posY, width, height } = req.body;
  const updated = dbInstance.updateTable(req.params.id, { posX, posY, width, height });
  if (updated) {
    res.json(updated);
  } else {
    res.status(404).json({ error: "Mesa no encontrada" });
  }
});

// 2b. ASIGNACIÓN DE CAMARERO A MESA
app.post("/api/tables/:id/assign", requireStaff, (req, res) => {
  const { id } = req.params;
  const authUser = (req as any).user;
  if (!authUser) return res.status(401).json({ error: "No autenticado" });

  const users = dbInstance.getUsers();
  const userProfile = users.find(u => u.id === authUser.sub);
  if (!userProfile) return res.status(401).json({ error: "Usuario no encontrado" });

  const table = dbInstance.getTableById(id);
  if (!table) return res.status(404).json({ error: "Mesa no encontrada" });

  const updated = dbInstance.updateTable(id, {
    assignedWaiterId: userProfile.id,
    assignedWaiterName: userProfile.name
  });

  broadcastEvent("table:assigned", {
    tableId: id,
    tableName: table.name,
    waiterId: userProfile.id,
    waiterName: userProfile.name
  });

  console.log(`[Waiter] ${userProfile.name} assigned to table ${table.name}`);
  res.json({ success: true, table: updated });
});

app.post("/api/tables/:id/unassign", requireStaff, (req, res) => {
  const { id } = req.params;
  const table = dbInstance.getTableById(id);
  if (!table) return res.status(404).json({ error: "Mesa no encontrada" });

  const updated = dbInstance.updateTable(id, {
    assignedWaiterId: null,
    assignedWaiterName: null
  });

  broadcastEvent("table:unassigned", {
    tableId: id,
    tableName: table.name
  });

  res.json({ success: true, table: updated });
});

app.get("/api/auth/me", requireStaff, (req, res) => {
  const authUser = (req as any).user;
  const users = dbInstance.getUsers();
  const userProfile = users.find(u => u.id === authUser.sub);
  if (!userProfile) return res.status(404).json({ error: "Usuario no encontrado" });
  const { passwordHash, ...safe } = userProfile;
  res.json(safe);
});

// 3. CATEGORÍAS
app.get("/api/categories", (req, res) => {
  res.json(dbInstance.getCategories());
});

app.post("/api/categories", requireStaff, (req, res) => {
  const { name, description, icon } = req.body;
  if (!name) return res.status(400).json({ error: "El nombre es obligatorio" });

  const newDoc = dbInstance.createCategory({
    name,
    description,
    icon: icon || "Utensils"
  });
  res.status(201).json(newDoc);
});

app.put("/api/categories/:id", requireStaff, (req, res) => {
  const updated = dbInstance.updateCategory(req.params.id, req.body);
  if (updated) {
    res.json(updated);
  } else {
    res.status(404).json({ error: "Categoría no encontrada" });
  }
});

app.delete("/api/categories/:id", requireStaff, (req, res) => {
  const success = dbInstance.deleteCategory(req.params.id);
  if (success) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: "Categoría no encontrada" });
  }
});

// 4. PRODUCTOS
app.get("/api/products", (req, res) => {
  res.json(dbInstance.getProducts());
});

app.post("/api/products", requireStaff, (req, res) => {
  const { categoryId, name, description, price, allergens, iva, available, stock, modifierGroups } = req.body;
  if (!categoryId || !name || price === undefined) {
    return res.status(400).json({ error: "Campos obligatorios faltantes" });
  }

  const newProd = dbInstance.createProduct({
    id: `prod-${Date.now()}`,
    categoryId,
    name,
    description: description || "",
    price: parseFloat(price),
    image: req.body.image || "default.jpg",
    allergens: allergens || [],
    iva: iva !== undefined ? parseInt(iva) : 10,
    available: available !== undefined ? available : true,
    stock: stock !== undefined && stock !== "" && stock !== null ? parseInt(stock) : null,
    modifierGroups: modifierGroups || []
  });
  res.status(201).json(newProd);
});

app.put("/api/products/:id", requireStaff, (req, res) => {
  const updated = dbInstance.updateProduct(req.params.id, req.body);
  if (updated) {
    res.json(updated);
  } else {
    res.status(404).json({ error: "Producto no encontrado" });
  }
});

app.delete("/api/products/:id", requireStaff, (req, res) => {
  const success = dbInstance.deleteProduct(req.params.id);
  if (success) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: "Producto no encontrado" });
  }
});

app.post("/api/catalog/import", requireStaff, (req: any, res) => {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Acceso denegado. Se requieren privilegios de Administrador." });
  }
  const { mode, items } = req.body;
  if (!mode || !Array.isArray(items)) {
    return res.status(400).json({ error: "Parámetros inválidos. Se requiere el modo y una lista de platos." });
  }

  try {
    const result = dbInstance.importCatalog(mode, items);
    res.json({ success: true, message: `Se han importado ${result.count} productos correctamente.` });
  } catch (err: any) {
    console.error("Error al importar el catálogo:", err);
    res.status(500).json({ error: `Fallo al importar el catálogo: ${err.message}` });
  }
});

// 5. PEDIDOS (ORDERS)
app.get("/api/orders", (req, res) => {
  let orders = dbInstance.getOrders();
  const { tableId, status } = req.query as { tableId?: string; status?: string };
  
  if (tableId) {
    const table = dbInstance.getTableById(tableId);
    if (!table || !table.activeSessionId) {
      // Mesa libre o inexistente → el siguiente cliente no ve nada
      return res.json([]);
    }
    // Solo pedidos de la sesión actual (incluye 'servido' para que el cliente actual los vea)
    orders = orders.filter(o =>
      o.tableId === tableId &&
      o.sessionId === table.activeSessionId &&
      o.status !== "cancelado"
    );
  }
  
  if (status) orders = orders.filter(o => o.status === status);
  res.json(orders);
});

app.post("/api/orders", (req, res) => {
  const { tableId, items, notes } = req.body;
  if (!tableId || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Datos del pedido inválidos o vacíos" });
  }

  const table = dbInstance.getTableById(tableId);
  if (!table) {
    return res.status(404).json({ error: "La mesa indicada no existe" });
  }

  // Server-side validation
  for (const line of items) {
    if (!line.productId || !line.quantity || line.quantity < 1 || line.quantity > 99) {
      return res.status(400).json({ error: `Cantidad inválida para el producto ${line.productId || "desconocido"}` });
    }
    if (line.selectedExtras) {
      for (const extra of line.selectedExtras) {
        if (typeof extra.price !== 'number' || extra.price < 0 || extra.price > 100) {
          extra.price = 0;
        }
      }
    }
  }

  // Generar ID de sesión activo de la mesa si está libre o no tiene sesión activa
  const sessionId = table.activeSessionId || `sess-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  let totalAmount = 0;
  let processedLines: OrderLine[] = [];
  try {
    processedLines = items.map((line: any, i: number) => {
      const prod = dbInstance.getProductById(line.productId);
      if (!prod) return null; // handled below

      // Calcular precio sumando extras
      let itemPriceUnit = prod.price;
      const selectedExtras = line.selectedExtras || [];
      const MAX_EXTRA_PRICE = 100;
      selectedExtras.forEach((extra: any) => {
        const ep = Math.max(0, Math.min(MAX_EXTRA_PRICE, extra.price || 0));
        itemPriceUnit += ep;
      });

      const priceTotal = parseFloat((itemPriceUnit * line.quantity).toFixed(2));
      totalAmount += priceTotal;

      // Descontar stock si la gestión de stock está activa
      if (prod.stock !== null) {
        if (line.quantity > prod.stock) {
          throw new Error(`Stock insuficiente para ${prod.name}. Quedan ${prod.stock}`);
        }
        dbInstance.updateProduct(prod.id, {
          stock: Math.max(0, prod.stock - line.quantity)
        });
      }

      // Determinar destino
      const isBeverage = prod.categoryId === "cat-3"; // cat-3 es Bebidas y Bodega
      const destination = isBeverage ? "bar" : "cocina";

      return {
        id: `line-${Date.now()}-${i}`,
        productId: prod.id,
        name: prod.name,
        quantity: line.quantity,
        priceUnit: itemPriceUnit,
        priceTotal,
        notes: line.notes || "",
        selectedExtras,
        destination
      } as OrderLine;
    }).filter(Boolean) as OrderLine[];
    if (processedLines.length === 0) {
      return res.status(400).json({ error: "Ningún producto válido en el pedido" });
    }
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }

  const newOrder: Order = {
    id: `ord-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    tableId,
    tableName: table.name,
    sessionId,
    timestamp: new Date().toISOString(),
    status: "pendiente",
    items: processedLines,
    totalAmount: parseFloat(totalAmount.toFixed(2))
  };

  const createdOrder = dbInstance.createOrder(newOrder);

  // Generar ZPL y registrar log de impresión de forma inmediata (síncrona)
  // para que ChefView pueda mostrar la vista previa aunque la impresora esté offline
  const kitchenItems = processedLines.filter(line => line.destination === "cocina");
  if (kitchenItems.length > 0) {
    const zplPreview = generateZplTicket(createdOrder, kitchenItems);
    dbInstance.addPrintLog({
      orderId: createdOrder.id,
      zpl: zplPreview,
      status: "pending",
      errorMessage: null
    });

    // Envío a impresora física en background (no bloqueante)
    queuePrinterJob(createdOrder, kitchenItems).catch(err => {
      console.error("Error crítico despachando impresora de cocina:", err);
    });
  }

  broadcastEvent("order:created", { id: createdOrder.id, tableId: createdOrder.tableId, status: createdOrder.status });

  // Notificación push a camareros cuando llega un nuevo pedido del cliente
  const orderTable = dbInstance.getTableById(createdOrder.tableId);
  const tableName = orderTable?.name || createdOrder.tableId;
  const itemsSummary = processedLines.slice(0, 3).map(l => `${l.quantity}x ${l.name}`).join(", ");
  const moreItems = processedLines.length > 3 ? ` +${processedLines.length - 3} más` : "";
  sendPushToRole("camarero", {
    title: `🍽️ Nuevo pedido — ${tableName}`,
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

app.put("/api/orders/:id/status", requireStaff, (req, res) => {
  const { status } = req.body;
  if (!status) return res.status(400).json({ error: "Estado obligatorio" });

  const updated = dbInstance.updateOrderStatus(req.params.id, status as OrderStatus);
  if (updated) {
    broadcastEvent("order:status_changed", { id: updated.id, status: updated.status });

    // Cuando un pedido pasa a "listo", notificar push al camarero asignado a la mesa
    if (status === "listo") {
      const table = dbInstance.getTableById(updated.tableId);
      if (table?.assignedWaiterId) {
        sendPushToRole("camarero", {
          title: `🍽️ Pedido listo - ${updated.tableName}`,
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
  } else {
    res.status(404).json({ error: "Pedido no encontrado" });
  }
});

// Confirmación de pedido listo (para SSE polling desde camarero)
app.get("/api/orders/:id/confirm", (req, res) => {
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
app.get("/api/tables/:id/bill", (req, res) => {
  const table = dbInstance.getTableById(req.params.id);
  if (!table) return res.status(404).json({ error: "Mesa no encontrada" });

  if (!table.activeSessionId) {
    return res.json({
      tableId: table.id,
      tableName: table.name,
      sessionId: "",
      items: [],
      subtotal: 0,
      taxAmount: 0,
      total: 0
    });
  }

  // Obtener pedidos de la sesión actual
  const sessionOrders = dbInstance.getOrders().filter(
    o => o.tableId === table.id && o.sessionId === table.activeSessionId && o.status !== "cancelado"
  );

  // Agrupar líneas iguales para visualización elegante
  const consolidatedMap: { [key: string]: any } = {};
  let subtotal = 0;
  let taxAmount = 0;

  sessionOrders.forEach(o => {
    o.items.forEach(line => {
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
          destination: line.destination
        };
      }
      consolidatedMap[key].quantity += line.quantity;
      consolidatedMap[key].priceTotal = parseFloat((consolidatedMap[key].priceTotal + line.priceTotal).toFixed(2));
      subtotal += line.priceTotal;
      taxAmount += line.priceTotal * (line.destination === "bar" ? 0.21 : 0.10);
    });
  });

  const receipts = dbInstance.getClosedReceipts().filter(r => r.sessionId === table.activeSessionId);

  res.json({
    tableId: table.id,
    tableName: table.name,
    sessionId: table.activeSessionId,
    items: Object.values(consolidatedMap),
    subtotal: parseFloat(subtotal.toFixed(2)),
    taxAmount: parseFloat(taxAmount.toFixed(2)),
    total: table.currentBillTotal !== null ? table.currentBillTotal : parseFloat(subtotal.toFixed(2)),
    closedReceipts: receipts
  });
});

app.post("/api/tables/:id/close", requireStaff, (req, res) => {
  const { customItems, splitMethod } = req.body;
  const tableId = req.params.id;
  const closed = dbInstance.closeTableSession(tableId, customItems, splitMethod);
  
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
        splitMethod
      }).catch(err => console.error("Error imprimiendo ticket:", err));

      // Si es pago fraccionado, imprimir también ticket del resto pendiente
      const tableAfter = dbInstance.getTableById(tableId);
      if (tableAfter && tableAfter.status === "pendiente_pago" && tableAfter.currentBillTotal > 0) {
        const remainingOrders = dbInstance.getOrders().filter(
          o => o.tableId === tableId && o.sessionId === tableAfter.activeSessionId && o.status !== "cancelado"
        );
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
            remainingTax += line.priceTotal * (line.destination === "bar" ? 0.21 : 0.10);
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
    broadcastEvent("table:updated", { tableId, status: "closed" });
    res.json({ success: true, receipt: closed });
  } else {
    res.status(404).json({ error: "La mesa no está ocupada o no tiene sesión activa que cerrar" });
  }
});

// 6b. IMPRIMIR TICKET MANUALMENTE
app.post("/api/tables/:id/print-ticket", requireStaff, (req, res) => {
  const table = dbInstance.getTableById(req.params.id);
  if (!table) return res.status(404).json({ error: "Mesa no encontrada" });

  if (!table.activeSessionId) {
    return res.status(400).json({ error: "La mesa no tiene sesión activa" });
  }

  const sessionOrders = dbInstance.getOrders().filter(
    o => o.tableId === table.id && o.sessionId === table.activeSessionId && o.status !== "cancelado"
  );

  if (sessionOrders.length === 0) {
    return res.status(400).json({ error: "No hay pedidos activos para esta mesa" });
  }

  const items: Array<{ name: string; quantity: number; priceTotal: number }> = [];
  let subtotal = 0;
  let taxAmount = 0;

  sessionOrders.forEach(order => {
    order.items.forEach(line => {
      items.push({
        name: line.name + (line.selectedExtras.length > 0 ? ` (${line.selectedExtras.map(e => e.optionName).join(", ")})` : ""),
        quantity: line.quantity,
        priceTotal: line.priceTotal
      });
      subtotal += line.priceTotal;
      taxAmount += line.priceTotal * (line.destination === "bar" ? 0.21 : 0.10);
    });
  });

  queueTicketPrintJob({
    tableName: table.name,
    items,
    subtotal,
    taxAmount,
    total: subtotal,
    timestamp: new Date().toISOString(),
    title: "Consulta de Mesa (Pre-factura)"
  }).catch(err => console.error("Error en impresión manual de ticket:", err));

  res.json({ success: true, message: "Ticket enviado a la impresora" });
});

// 6c. REIMPRIMIR RECIBO (para tickets modificados)
app.post("/api/print-receipt", requireStaff, (req, res) => {
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
  if (!order) {
    return res.status(404).json({ error: "Pedido no encontrado" });
  }
  const kitchenItems = order.items.filter(i => i.destination === "cocina");
  const zpl = kitchenItems.length > 0 ? generateZplTicket(order, kitchenItems) : generateZplTicket(order, order.items);
  res.json({
    id: order.id,
    tableName: order.tableName,
    timestamp: order.timestamp,
    zpl,
    items: order.items
  });
});

// 6e. ENDPOINT PARA RECIBIR ZPL E IMPRIMIR (proxy desde navegador)
app.post("/api/print/zpl", requireStaff, (req, res) => {
  const { zpl, ip, port } = req.body;
  if (!zpl) return res.status(400).json({ error: "ZPL es obligatorio" });

  const targetIp = ip || dbInstance.getPrinterConfig().ip;
  const targetPort = port || dbInstance.getPrinterConfig().port;

  sendRawZplToNetworkPrinter(targetIp, targetPort, zpl, 10000)
    .then(() => {
      dbInstance.addPrintLog({ orderId: `direct-${Date.now()}`, zpl, status: "sent", errorMessage: null });
      res.json({ success: true });
    })
    .catch((err) => {
      res.status(502).json({ success: false, error: err.message });
    });
});

// 7. CONFIGURACIÓN DE IMPRESION E HISTORIAL
app.get("/api/printer-config", requireStaff, (req, res) => {
  res.json(dbInstance.getPrinterConfig());
});

app.post("/api/printer-config", requireStaff, (req, res) => {
  const config = dbInstance.updatePrinterConfig(req.body);
  res.json(config);
});

// 7b. CONFIGURACIÓN DE IMPRESORA DE TICKETS
app.get("/api/ticket-printer-config", requireStaff, (req, res) => {
  res.json(dbInstance.getTicketPrinterConfig());
});

app.post("/api/ticket-printer-config", requireStaff, (req, res) => {
  const config = dbInstance.updateTicketPrinterConfig(req.body);
  res.json(config);
});

app.get("/api/print-logs", requireStaff, (req, res) => {
  res.json(dbInstance.getPrintLogs());
});

// 7c. PLANTILLA DE TICKET PERSONALIZABLE DESDE ADMIN
app.get("/api/ticket-template", requireStaff, (req: any, res) => {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Acceso denegado. Se requieren privilegios de Administrador." });
  }
  res.json(dbInstance.getTicketTemplate());
});

app.put("/api/ticket-template", requireStaff, (req: any, res) => {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Acceso denegado. Se requieren privilegios de Administrador." });
  }
  const updated = dbInstance.updateTicketTemplate(req.body);
  res.json(updated);
});

app.post("/api/print-test", requireStaff, (req, res) => {
  const { type } = req.body || {};
  const mockOrder: Order = {
    id: "ord-test",
    tableId: "table-test",
    tableName: "Mesa VIP",
    sessionId: "sess-test",
    timestamp: new Date().toISOString(),
    status: "pendiente",
    items: [
      {
        id: "line-test-1",
        productId: "prod-1",
        name: type === "ticket" ? "Prueba Ticket Cliente" : "Test Impresión Directa",
        quantity: 2,
        priceUnit: 5.00,
        priceTotal: 10.00,
        notes: type === "ticket" ? "Prueba ZPL Factura" : "Prueba ZPL por red",
        selectedExtras: [],
        destination: type === "ticket" ? "bar" : "cocina"
      }
    ],
    totalAmount: 10.00
  };

  const zpl = generateZplTicket(mockOrder, mockOrder.items);
  const config = type === "ticket" ? dbInstance.getTicketPrinterConfig() : dbInstance.getPrinterConfig();

  // Test de socket directo de la API
  sendRawZplToNetworkPrinter(config.ip, config.port, zpl, 10000)
    .then(() => {
      dbInstance.addPrintLog({
        orderId: mockOrder.id,
        zpl,
        status: "sent",
        errorMessage: null
      });
      res.json({ success: true, message: `ZPL enviado exitosamente a la impresora en ${config.ip}:${config.port}` });
    })
    .catch((err) => {
      dbInstance.addPrintLog({
        orderId: mockOrder.id,
        zpl,
        status: "failed",
        errorMessage: err.message
      });
      res.status(502).json({
        success: false,
        error: err.message,
        zpl,
        message: "No se pudo alcanzar la impresora local desde el host en la nube. Imprimiendo de forma simulada."
      });
    });
});

// 8. ESTADÍSTICAS ADMIN
app.get("/api/stats", requireStaff, (req, res) => {
  res.json(dbInstance.getStats());
});

// 9. VENTAS POR MESA
app.get("/api/sales-by-table", requireStaff, (req, res) => {
  res.json(dbInstance.getSalesByTable());
});

// 10. HISTORIAL DE TICKETS CERRADOS (admin)
app.get("/api/closed-receipts", requireStaff, (req, res) => {
  res.json(dbInstance.getClosedReceipts());
});

app.put("/api/closed-receipts/:id", requireStaff, (req, res) => {
  const updated = dbInstance.updateClosedReceipt(req.params.id, req.body);
  if (updated) {
    res.json(updated);
  } else {
    res.status(404).json({ error: "Ticket no encontrado" });
  }
});

// 11. LLAMADAS AL CAMARERO (WAITER CALLS)
app.get("/api/waiter-calls", (req, res) => {
  res.json(dbInstance.getPendingWaiterCalls());
});

app.post("/api/waiter-calls", (req, res) => {
  const { tableId, reason } = req.body;
  if (!tableId || !reason) {
    return res.status(400).json({ error: "Faltan parámetros tableId o reason" });
  }
  const table = dbInstance.getTableById(tableId);
  const tableName = table ? table.name : `Mesa ${tableId}`;
  
  const call = dbInstance.addWaiterCall({ tableId, tableName, reason });
  broadcastEvent("waiter_call_new", call);

  // Notificación push a todos los camareros registrados
  const reasonLabels: Record<string, string> = {
    cuenta: "💳 Solicita la cuenta",
    ayuda: "🙋 Necesita ayuda",
    cubiertos: "🍴 Pide cubiertos",
    limpieza: "🧹 Solicita limpieza",
    duda: "❓ Tiene una pregunta"
  };
  sendPushToRole("camarero", {
    title: `🛎️ Llamada — ${tableName}`,
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

app.put("/api/waiter-calls/:id/resolve", requireStaff, (req, res) => {
  const success = dbInstance.resolveWaiterCall(req.params.id);
  if (success) {
    broadcastEvent("waiter_call_resolved", { id: req.params.id });
    res.json({ success: true });
  } else {
    res.status(404).json({ error: "Llamada no encontrada o ya resuelta" });
  }
});

// 11b. WEB PUSH SUBSCRIPTIONS
app.get("/api/push/vapid-public-key", (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

app.post("/api/push/subscribe", requireStaff, (req, res) => {
  const { subscription, role } = req.body;
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return res.status(400).json({ error: "Suscripción inválida" });
  }
  const user = (req as any).user;
  dbInstance.savePushSubscription(user?.id || "unknown", role || user?.role || "camarero", subscription);
  console.log(`[WebPush] Suscripción guardada para ${user?.username} (${role})`);
  res.json({ success: true });
});

app.post("/api/push/unsubscribe", (req, res) => {
  const { endpoint } = req.body;
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
app.delete("/api/tables/:tableId/bill/items", requireStaff, (req, res) => {
  const { productId, notes, selectedExtras } = req.body;
  const success = dbInstance.deleteBillItem(req.params.tableId, productId, notes, selectedExtras);
  if (success) {
    broadcastEvent("tables_updated", {});
    broadcastEvent("orders_updated", {});
    res.json({ success: true });
  } else {
    res.status(400).json({ error: "No se pudo eliminar el producto de la cuenta" });
  }
});

app.put("/api/tables/:tableId/bill/items/note", requireStaff, (req, res) => {
  const { productId, oldNotes, selectedExtras, newNotes } = req.body;
  const success = dbInstance.updateBillItemNote(req.params.tableId, productId, oldNotes, selectedExtras, newNotes);
  if (success) {
    broadcastEvent("tables_updated", {});
    broadcastEvent("orders_updated", {});
    res.json({ success: true });
  } else {
    res.status(400).json({ error: "No se pudo actualizar la nota" });
  }
});

app.put("/api/tables/:tableId/bill/items/serve", requireStaff, (req, res) => {
  const { productId, notes, selectedExtras } = req.body;
  const success = dbInstance.serveBillItem(req.params.tableId, productId, notes, selectedExtras);
  if (success) {
    broadcastEvent("tables_updated", {});
    broadcastEvent("orders_updated", {});
    res.json({ success: true });
  } else {
    res.status(400).json({ error: "No se pudo marcar el producto como servido" });
  }
});

// -------------------------------------------------------------
// SSE ENDPOINT PARA EVENTOS EN TIEMPO REAL
// -------------------------------------------------------------

let sseClients: Array<{ id: string; res: any }> = [];

app.get("/api/events", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });
  res.write("data: {\"type\":\"connected\"}\n\n");

  const clientId = `sse-${Date.now()}`;
  const client = { id: clientId, res };
  sseClients.push(client);
  console.log(`[SSE] Client ${clientId} connected (${sseClients.length} total)`);

  req.on("close", () => {
    sseClients = sseClients.filter(c => c.id !== clientId);
    console.log(`[SSE] Client ${clientId} disconnected (${sseClients.length} remaining)`);
  });
});

function broadcastEvent(event: string, data: any) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(c => {
    try { c.res.write(msg); } catch { /* ignore */ }
  });
}

// -------------------------------------------------------------
// VITE INTEGRATION Y SERVIDORES DE ARCHIVOS ESTATICO
// -------------------------------------------------------------

async function startServer() {
  // Integrar Vite como middleware para desarrollo caliente
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    // Traspasar peticiones no API al frontend Vite
    app.use(vite.middlewares);
  } else {
    // Servir dist en producción
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Unified Restaurant] Server running on http://localhost:${PORT} in ${process.env.NODE_ENV || "development"} mode`);
  });
}

startServer().catch((error) => {
  console.error("Error iniciando servidor unificado:", error);
});
