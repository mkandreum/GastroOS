/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Roles de usuario del sistema
export type UserRole = "admin" | "camarero" | "cocina" | "bar" | "cliente";

export interface User {
  id: string;
  username: string;
  role: UserRole;
  name: string;
  passwordHash?: string;
}

// Estados posibles de una mesa
export type TableStatus = "libre" | "ocupada" | "pendiente_pago";

// Interfaz para representar una Mesa
export interface Table {
  id: string;
  number: number;
  name: string;
  status: TableStatus;
  activeSessionId: string | null;
  qrCodeData: string; // URL pública correspondiente a esta mesa
  currentBillTotal: number;
  posX: number; // Posición X en el mapa del salón
  posY: number; // Posición Y en el mapa del salón
  width?: number; // Ancho en píxeles para el editor de diseño
  height?: number; // Alto en píxeles para el editor de diseño
  assignedWaiterId?: string | null; // ID del camarero que ha tomado la mesa
  assignedWaiterName?: string | null; // Nombre del camarero asignado
}

// Concepto de categoría gastronómica
export interface Category {
  id: string;
  name: string;
  description?: string;
  icon?: string; // Nombre del icono de Lucide
}

// Opción de suplemento o modificador (ej. "Con queso +0.50€", "Poco hecho")
export interface ModifierOption {
  id: string;
  name: string;
  price: number; // Precio adicional (0 si no suma)
}

// Grupo de modificadores (ej: "Punto de la carne", "Salsas adicionales")
export interface ModifierGroup {
  id: string;
  name: string;
  required: boolean;
  maxSelections: number; // Generalmente 1 para opciones exclusivas
  options: ModifierOption[];
}

// Alérgenos reconocidos
export type Allergen = 
  | "gluten" 
  | "lacteos" 
  | "frutos_secos" 
  | "huevo" 
  | "pescado" 
  | "soja" 
  | "crustaceos" 
  | "mostaza" 
  | "sulfitos" 
  | "moluscos" 
  | "cacahuetes" 
  | "apio";

// Datos del Producto / Plato
export interface Product {
  id: string;
  categoryId: string;
  name: string;
  description: string;
  price: number;
  image: string; // URL o placeholder SVG
  allergens: Allergen[];
  iva: number; // Porcentaje, ej: 10 para alimentación normal
  available: boolean;
  stock: number | null; // null representa stock ilimitado
  modifierGroups?: ModifierGroup[];
}

// Estados del pedido
export type OrderStatus = "pendiente" | "en_preparacion" | "listo" | "servido" | "cancelado";

export interface SelectedModifier {
  groupName: string;
  optionName: string;
  price: number;
}

// Línea individual del pedido
export interface OrderLine {
  id: string;
  productId: string;
  name: string;
  quantity: number;
  priceUnit: number;
  priceTotal: number;
  notes: string;
  selectedExtras: SelectedModifier[];
  destination: "cocina" | "bar"; // Determina dónde se envía
}

// Pedido registrado
export interface Order {
  id: string;
  tableId: string;
  tableName: string;
  sessionId: string; // Para agrupar todos los pedidos de la misma sesión/cuenta
  timestamp: string; // ISO String
  status: OrderStatus;
  items: OrderLine[];
  totalAmount: number;
}

// Ticket/Cuenta por mesa
export interface ReceiptLine {
  id: string;
  name: string;
  quantity: number;
  priceUnit: number;
  priceTotal: number;
  notes?: string;
  selectedExtras?: SelectedModifier[];
}

export interface Receipt {
  tableId: string;
  tableName: string;
  sessionId: string;
  openedAt: string;
  items: ReceiptLine[];
  subtotal: number;
  taxAmount: number; // IVA acumulado
  total: number;
}

// Modo de impresión: servidor (Express TCP) o navegador (fetch directo a IP)
export type PrintMode = "server" | "browser";

// Impresora configurada
export interface PrinterConfig {
  ip: string;
  port: number;
  name: string;
  enabled: boolean;
  printMode?: PrintMode;
}

// Logs de impresión física
export interface PrintLog {
  id: string;
  timestamp: string;
  orderId: string;
  zpl: string;
  status: "sent" | "pending" | "failed";
  errorMessage: string | null;
  retries: number;
}

// Métricas de ventas para el panel de administración
// Plantilla de ticket personalizable desde Admin
export interface TicketTemplate {
  businessName: string;
  headerTitle: string;
  footerThanks: string;
  footerUrl: string;
  kitchenHeader: string;
  kitchenFooter: string;
  labelCant: string;
  labelDescripcion: string;
  labelTotal: string;
  labelFactura: string;
  labelMesa: string;
  labelTicket: string;
  labelMetodoPago: string;
  labelSubtotal: string;
  labelIva: string;
  labelTotalFinal: string;
  paperWidth: number;
  paperHeight: number;
}

export interface AdminStats {
  totalSales: number;
  activeTablesCount: number;
  avgTicket: number;
  topProducts: Array<{ name: string; salesCount: number; revenue: number }>;
  salesByHour: Array<{ hour: string; sales: number }>;
  salesByTable: Array<{ tableName: string; totalSales: number; ticketCount: number; lastTicket: string | null }>;
}

export interface WaiterCall {
  id: string;
  tableId: string;
  tableName: string;
  reason: "cuenta" | "ayuda" | "cubiertos" | "limpieza" | "duda";
  status: "pending" | "resolved";
  timestamp: string;
}
