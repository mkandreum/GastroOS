/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { 
  motion, AnimatePresence
} from "motion/react";
import { 
  BarChart3, Settings, Table as TableIcon, BookOpen, Printer, Shield, ChevronRight, 
  Trash2, PlusCircle, Edit3, Check, Eye, Download, Info, RefreshCw, AlertTriangle, UserCheck
} from "lucide-react";
import { useToast } from "./ToastProvider";
import ConfirmDialog from "./ConfirmDialog";
import { useConfirm } from "./useConfirm";
import { authHeaders } from "./api";
import { Table, Category, Product, PrinterConfig, PrintLog, AdminStats, Allergen, TicketTemplate } from "../types";
import { sendZplDirectToPrinter } from "../utils/directPrint";

export default function AdminView() {
  const [activeTab, setActiveTab] = useState<"dashboard" | "catalog" | "tables" | "printer" | "tickets" | "users" | "ticket-tpl">("dashboard");
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [tables, setTables] = useState<Table[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [printer, setPrinter] = useState<PrinterConfig | null>(null);
  const [printLogs, setPrintLogs] = useState<PrintLog[]>([]);
  const [closedReceipts, setClosedReceipts] = useState<any[]>([]);
  
  // Estados de interacción para los gráficos SVG interactivos
  const [hoveredHourPoint, setHoveredHourPoint] = useState<any | null>(null);
  const [hoveredProductIndex, setHoveredProductIndex] = useState<number | null>(null);
  const [hoveredTableIndex, setHoveredTableIndex] = useState<number | null>(null);
  const [showHeatmap, setShowHeatmap] = useState(false);
  
  // Estados para añadir/editar categorías
  const [editCategoryMode, setEditCategoryMode] = useState<Category | null>(null);
  const [isCatModalOpen, setIsCatModalOpen] = useState(false);
  const [catName, setCatName] = useState("");
  const [catDesc, setCatDesc] = useState("");

  // Estados para añadir/editar productos
  const [editProductMode, setEditProductMode] = useState<Product | null>(null);
  const [isProdModalOpen, setIsProdModalOpen] = useState(false);
  const [prodCatId, setProdCatId] = useState("");
  const [prodName, setProdName] = useState("");
  const [prodDesc, setProdDesc] = useState("");
  const [prodPrice, setProdPrice] = useState("");
  const [prodStock, setProdStock] = useState("");
  const [prodAllergens, setProdAllergens] = useState<Allergen[]>([]);
  const [prodIva, setProdIva] = useState("10");

  // Estados para crear mesas
  const [newTableNumber, setNewTableNumber] = useState("");
  const [newTableName, setNewTableName] = useState("");

  // Guardando IP de impresora cocina
  const [printerIp, setPrinterIp] = useState("");
  const [printerPort, setPrinterPort] = useState("");
  const [printerName, setPrinterName] = useState("");
  const [printerEnabled, setPrinterEnabled] = useState(true);
  const [printerMode, setPrinterMode] = useState<"server" | "browser">("browser");

  // Guardando IP de impresora tickets
  const [ticketPrinterIp, setTicketPrinterIp] = useState("");
  const [ticketPrinterPort, setTicketPrinterPort] = useState("");
  const [ticketPrinterName, setTicketPrinterName] = useState("");
  const [ticketPrinterEnabled, setTicketPrinterEnabled] = useState(false);
  const [ticketPrinterMode, setTicketPrinterMode] = useState<"server" | "browser">("browser");
  
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testPrintStatus, setTestPrintStatus] = useState<{ success?: boolean, msg?: string } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Estados para gestión de usuarios
  const [users, setUsers] = useState<any[]>([]);
  const [newUserName, setNewUserName] = useState("");
  const [newUserUsername, setNewUserUsername] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState("camarero");

  // Estados para importar CSV
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importMode, setImportMode] = useState<"append" | "replace">("append");
  const [importItems, setImportItems] = useState<any[]>([]);

  // Estados para plantilla de ticket
  const [ticketTpl, setTicketTpl] = useState<TicketTemplate | null>(null);
  const [tplSaving, setTplSaving] = useState(false);

  useEffect(() => {
    fetchGlobalData();
  }, [activeTab]);

  const { toast } = useToast();
  const { confirm, dialogProps: confirmDialogProps } = useConfirm();

  const fetchGlobalData = async () => {
    setLoading(true);
    try {
      const [resStats, resTables, resCats, resProds, resPrint, resTicketPrint, resLogs, resUsers] = await Promise.all([
        fetch("/api/stats"),
        fetch("/api/tables"),
        fetch("/api/categories"),
        fetch("/api/products"),
        fetch("/api/printer-config"),
        fetch("/api/ticket-printer-config"),
        fetch("/api/print-logs"),
        fetch("/api/users")
      ]);

      if (resStats.ok) setStats(await resStats.json());
      if (resTables.ok) {
        const tList = await resTables.json();
        setTables(tList);
      }
      if (resCats.ok) setCategories(await resCats.json());
      if (resProds.ok) setProducts(await resProds.json());
      if (resPrint.ok) {
        const pConf: PrinterConfig = await resPrint.json();
        setPrinter(pConf);
        setPrinterIp(pConf.ip);
        setPrinterPort(String(pConf.port));
        setPrinterName(pConf.name);
        setPrinterEnabled(pConf.enabled);
        setPrinterMode(pConf.printMode || "browser");
      }
      if (resTicketPrint.ok) {
        const tpConf: PrinterConfig = await resTicketPrint.json();
        setTicketPrinterIp(tpConf.ip);
        setTicketPrinterPort(String(tpConf.port));
        setTicketPrinterName(tpConf.name);
        setTicketPrinterEnabled(tpConf.enabled);
        setTicketPrinterMode(tpConf.printMode || "browser");
      }
      if (resLogs.ok) setPrintLogs(await resLogs.json());
      if (resUsers.ok) setUsers(await resUsers.json());
      // Cargar historial de tickets cerrados
      const resClosed = await fetch("/api/closed-receipts");
      if (resClosed.ok) setClosedReceipts(await resClosed.json());
      // Cargar plantilla de ticket
      const resTpl = await fetch("/api/ticket-template");
      if (resTpl.ok) setTicketTpl(await resTpl.json());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // OPERACIONES DE CATEGORÍAS
  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!catName) return;
    setSaving(true);

    const payload = {
      name: catName,
      description: catDesc,
      icon: editCategoryMode?.icon || "Utensils"
    };

    const url = editCategoryMode 
      ? `/api/categories/${editCategoryMode.id}` 
      : "/api/categories";

    const method = editCategoryMode ? "PUT" : "POST";

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        setIsCatModalOpen(false);
        setCatName("");
        setCatDesc("");
        setEditCategoryMode(null);
        fetchGlobalData();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCategory = async (id: string) => {
    const ok = await confirm("Eliminar categoría", "Al eliminar una categoría, también se eliminarán todos sus productos. ¿Siguiente?", "danger");
    if (!ok) return;
    try {
      const res = await fetch(`/api/categories/${id}`, { method: "DELETE", headers: authHeaders() });
      if (res.ok) fetchGlobalData();
    } catch (err) {
      console.error(err);
    }
  };

  // OPERACIONES DE PRODUCTOS
  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prodName || !prodCatId || !prodPrice) {
      toast("Por favor rellena el nombre, la categoría y el precio.", "error");
      return;
    }
    setSaving(true);

    const payload = {
      categoryId: prodCatId,
      name: prodName,
      description: prodDesc,
      price: parseFloat(prodPrice),
      iva: parseInt(prodIva),
      stock: prodStock && prodStock !== "unlimited" ? parseInt(prodStock) : null,
      allergens: prodAllergens,
      available: editProductMode ? editProductMode.available : true,
      modifierGroups: editProductMode?.modifierGroups || (
        prodCatId === "cat-2" ? [ // Si es platos principales/carnes, añadimos el punto por comodidad
          {
            id: "modg-1",
            name: "Punto de la carne",
            required: true,
            maxSelections: 1,
            options: [
              { id: "modo-1", name: "Poco hecho (Sangrante)", price: 0 },
              { id: "modo-2", name: "Al punto", price: 0 },
              { id: "modo-3", name: "Muy hecho", price: 0 }
            ]
          }
        ] : []
      )
    };

    const url = editProductMode 
      ? `/api/products/${editProductMode.id}` 
      : "/api/products";

    const method = editProductMode ? "PUT" : "POST";

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        setIsProdModalOpen(false);
        setEditProductMode(null);
        setProdName("");
        setProdDesc("");
        setProdPrice("");
        setProdStock("");
        setProdAllergens([]);
        fetchGlobalData();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProduct = async (id: string) => {
    const ok = await confirm("Dar de baja", "¿Seguro que deseas dar de baja este producto de la carta?", "danger");
    if (!ok) return;
    try {
      const res = await fetch(`/api/products/${id}`, { method: "DELETE", headers: authHeaders() });
      if (res.ok) fetchGlobalData();
    } catch (err) {
      console.error(err);
    }
  };

  const toggleAllergen = (al: Allergen) => {
    setProdAllergens(prev => 
      prev.includes(al) ? prev.filter(x => x !== al) : [...prev, al]
    );
  };

  // OPERACIONES DE MESAS
  const handleAddTable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTableNumber || !newTableName) return;
    try {
      const res = await fetch("/api/tables", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          number: parseInt(newTableNumber),
          name: newTableName
        })
      });
      if (res.ok) {
        setNewTableNumber("");
        setNewTableName("");
        fetchGlobalData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteTable = async (id: string) => {
    const ok = await confirm("Dar de baja mesa", "¿Deseas dar de baja esta mesa del sistema?", "danger");
    if (!ok) return;
    try {
      const res = await fetch(`/api/tables/${id}`, { method: "DELETE", headers: authHeaders() });
      if (res.ok) fetchGlobalData();
    } catch (err) {
      console.error(err);
    }
  };

  // OPERACIONES DE IMPRESORA
  const handleSavePrinter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!printerIp || !printerPort) return;
    try {
      const res = await fetch("/api/printer-config", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          ip: printerIp,
          port: parseInt(printerPort),
          name: printerName,
          enabled: printerEnabled,
          printMode: printerMode
        })
      });
      if (res.ok) {
        toast("Configuración actualizada.", "success");
        fetchGlobalData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSaveTicketPrinter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticketPrinterIp || !ticketPrinterPort) return;
    try {
      const res = await fetch("/api/ticket-printer-config", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          ip: ticketPrinterIp,
          port: parseInt(ticketPrinterPort),
          name: ticketPrinterName,
          enabled: ticketPrinterEnabled,
          printMode: ticketPrinterMode
        })
      });
      if (res.ok) {
        toast("Configuración de tickets actualizada.", "success");
        fetchGlobalData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const triggerTestPrint = async (type: "kitchen" | "ticket" = "kitchen") => {
    const isBrowser = type === "ticket" ? ticketPrinterMode === "browser" : printerMode === "browser";
    const ip = type === "ticket" ? ticketPrinterIp : printerIp;
    const port = type === "ticket" ? ticketPrinterPort : printerPort;
    const name = type === "ticket" ? ticketPrinterName : printerName;

    if (isBrowser) {
      setTestPrintStatus({ msg: `Iniciando prueba directa desde navegador a ${ip}:${port} (${name})...` });
      try {
        const testZpl = 
          "^XA\n" +
          "^CF0,40,40\n" +
          "^FO50,50^FDTEST IMPRESION RAPIDA^FS\n" +
          "^CF0,30,30\n" +
          "^FO50,120^FDModo: Navegador Directo^FS\n" +
          "^FO50,165^FDIP: " + ip + "^FS\n" +
          "^FO50,210^FDPuerto: " + port + "^FS\n" +
          "^XZ";
        
        // Intentar envío por socket directo a la IP local (no-cors fetch)
        const success = await sendZplDirectToPrinter(testZpl, ip, parseInt(port) || 9100);
        
        if (success) {
          setTestPrintStatus({ 
            success: true, 
            msg: `ZPL enviado desde el navegador a la impresora en ${ip}:${port}. Si la impresora no imprime, verifica que no esté bloqueado el puerto (ej. 9100 en Chrome). Abriendo ventana de impresión HTML de respaldo...` 
          });
        } else {
          setTestPrintStatus({ 
            success: false, 
            msg: `⚠️ Bloqueado por seguridad del navegador (Mixed Content HTTPS a HTTP) o impresora fuera de línea. Abriendo ventana de impresión HTML/CSS de respaldo. Para impresión ZPL directa, por favor lee las instrucciones adjuntas.` 
          });
        }
        
        // Disparar ventana de impresión del navegador
        window.dispatchEvent(new CustomEvent("print-ticket", {
          detail: {
            type: "comanda",
            title: `PRUEBA IMPRESION (${name})`,
            tableName: "Mesa VIP de Test",
            timestamp: new Date().toISOString(),
            items: [
              {
                quantity: 1,
                name: "Prueba Impresión Browser",
                notes: `Modo: Navegador Directo | IP: ${ip} | Puerto: ${port}`
              }
            ]
          }
        }));

      } catch (err: any) {
        setTestPrintStatus({ success: false, msg: `Error en prueba local: ${err.message}` });
      }
    } else {
      // Modo Servidor TCP
      setTestPrintStatus({ msg: `Iniciando prueba directa TCP socket desde el servidor a ${ip}:${port}...` });
      try {
        const res = await fetch("/api/print-test", { 
          method: "POST", 
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ type })
        });
        const statusData = await res.json();
        if (res.ok) {
          setTestPrintStatus({ success: true, msg: statusData.message });
        } else {
          setTestPrintStatus({ success: false, msg: statusData.error || statusData.message });
        }
        fetchGlobalData();
      } catch (err) {
        setTestPrintStatus({ success: false, msg: "Fallo de comunicación IP con el servidor central." });
      }
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserName || !newUserUsername || !newUserPassword || !newUserRole) return;
    setSaving(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          name: newUserName,
          username: newUserUsername,
          password: newUserPassword,
          role: newUserRole
        })
      });
      if (res.ok) {
        setNewUserName("");
        setNewUserUsername("");
        setNewUserPassword("");
        setNewUserRole("camarero");
        toast("Usuario registrado con éxito.", "success");
        fetchGlobalData();
      } else {
        const errData = await res.json();
        toast(errData.error || "Error al crear el usuario.", "error");
      }
    } catch (err) {
      console.error(err);
      toast("Error de red al crear el usuario.", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteUser = async (id: string, name: string) => {
    const ok = await confirm("Eliminar usuario", `¿Seguro que deseas eliminar la cuenta de ${name}?`, "danger");
    if (!ok) return;
    try {
      const res = await fetch(`/api/users/${id}`, { 
        method: "DELETE", 
        headers: authHeaders() 
      });
      if (res.ok) {
        toast("Usuario eliminado correctamente.", "success");
        fetchGlobalData();
      } else {
        const errData = await res.json();
        toast(errData.error || "No se pudo eliminar el usuario.", "error");
      }
    } catch (err) {
      console.error(err);
      toast("Error de red al eliminar el usuario.", "error");
    }
  };

  const downloadSampleCSV = () => {
    const csvContent = 
      "Categoría;Nombre;Descripción;Precio;IVA;Stock;Alérgenos;Disponible\n" +
      "Entrantes;Patatas Bravas;Patatas crujientes con salsa brava casera y alioli;6.50;10;unlimited;huevo;true\n" +
      "Entrantes;Croquetas de Jamón;Croquetas cremosas de jamón ibérico (6 uds);8.00;10;30;gluten, lacteos, huevo;true\n" +
      "Platos Principales;Hamburguesa Gastro;200g de ternera, queso de cabra, cebolla caramelizada y rúcula;14.90;10;50;gluten, lacteos;true\n" +
      "Platos Principales;Entrecot a la Brasa;Entrecot de ternera gallega (350g) con patatas y pimientos;22.00;10;15;;true\n" +
      "Postres;Tarta de Queso Casera;Tarta de queso al horno cremosa con base de galleta;5.50;10;12;lacteos, gluten, huevo;true\n" +
      "Postres;Brownie con Helado;Brownie de chocolate templado con helado de vainilla;6.00;10;unlimited;frutos_secos, lacteos, gluten, huevo;true\n" +
      "Bebidas y Bodega;Refresco de Cola;Refresco de cola de 33cl;2.50;21;unlimited;;true\n" +
      "Bebidas y Bodega;Cerveza Doble;Doble de cerveza de barril premium;3.00;21;unlimited;gluten;true\n" +
      "Bebidas y Bodega;Vino Tinto Rioja Crianza;Copa de vino tinto crianza D.O. Ca. Rioja;3.50;21;unlimited;sulfitos;true";
      
    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "ejemplo_carta_gastroos.csv");
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (text) {
        parseAndSetCSV(text);
      }
    };
    reader.readAsText(file, "UTF-8");
  };

  const parseAndSetCSV = (text: string) => {
    try {
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
      if (lines.length < 2) {
        toast("El archivo CSV está vacío o no tiene el formato correcto.", "error");
        return;
      }
      
      const header = lines[0].replace(/^\uFEFF/, "");
      const sep = header.includes(";") ? ";" : ",";
      const columns = header.split(sep).map(c => c.trim().toLowerCase());
      
      const colCat = columns.indexOf("categoría") !== -1 ? columns.indexOf("categoría") : columns.indexOf("categoria");
      const colName = columns.indexOf("nombre");
      const colDesc = columns.indexOf("descripción") !== -1 ? columns.indexOf("descripción") : columns.indexOf("descripcion");
      const colPrice = columns.indexOf("precio");
      const colIva = columns.indexOf("iva");
      const colStock = columns.indexOf("stock");
      const colAllergens = columns.indexOf("alérgenos") !== -1 ? columns.indexOf("alérgenos") : columns.indexOf("alergenos");
      const colAvailable = columns.indexOf("disponible");
      
      if (colCat === -1 || colName === -1 || colPrice === -1) {
        toast("Formato incorrecto. El CSV debe contener al menos las columnas: Categoría, Nombre, Precio.", "error");
        return;
      }
      
      const parsedItems: any[] = [];
      
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        let values: string[] = [];
        
        let matches = [];
        if (sep === ";") {
          matches = line.match(/(".*?"|[^;]+)(?=\s*;|\s*$)/g) || [];
          if (matches.length === 0 || line.includes(";;")) {
            values = line.split(";");
          } else {
            values = matches.map(v => v.replace(/^"|"$/g, "").trim());
          }
        } else {
          matches = line.match(/(".*?"|[^,]+)(?=\s*,|\s*$)/g) || [];
          if (matches.length === 0 || line.includes(",,")) {
            values = line.split(",");
          } else {
            values = matches.map(v => v.replace(/^"|"$/g, "").trim());
          }
        }
        
        while (values.length < columns.length) {
          values.push("");
        }
        
        const categoryName = values[colCat]?.trim();
        const name = values[colName]?.trim();
        const priceStr = values[colPrice]?.trim().replace(",", ".");
        
        if (!categoryName || !name || !priceStr) {
          continue;
        }
        
        const price = parseFloat(priceStr);
        if (isNaN(price)) continue;
        
        const description = colDesc !== -1 ? values[colDesc]?.trim() : "";
        const iva = colIva !== -1 ? parseInt(values[colIva]) || 10 : 10;
        
        let stock: number | null = null;
        if (colStock !== -1) {
          const stockStr = values[colStock]?.trim().toLowerCase();
          if (stockStr && stockStr !== "unlimited" && stockStr !== "ilimitado" && stockStr !== "null" && stockStr !== "") {
            const parsedStock = parseInt(stockStr);
            if (!isNaN(parsedStock)) stock = parsedStock;
          }
        }
        
        const allergensStr = colAllergens !== -1 ? values[colAllergens]?.trim() : "";
        const allergens = allergensStr
          ? allergensStr.split(",").map(a => a.trim().toLowerCase()).filter(a => a.length > 0)
          : [];
          
        const availableStr = colAvailable !== -1 ? values[colAvailable]?.trim().toLowerCase() : "true";
        const available = availableStr === "true" || availableStr === "1" || availableStr === "sí" || availableStr === "si";
        
        parsedItems.push({
          categoryName,
          name,
          description,
          price,
          iva,
          stock,
          allergens,
          available
        });
      }
      
      setImportItems(parsedItems);
      toast(`Se han pre-procesado ${parsedItems.length} platos listos para importar.`, "success");
    } catch (err) {
      console.error(err);
      toast("Error al procesar el archivo CSV.", "error");
    }
  };

  const handleCommitImport = async () => {
    if (importItems.length === 0) return;
    setSaving(true);
    try {
      const res = await fetch("/api/catalog/import", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          mode: importMode,
          items: importItems
        })
      });
      if (res.ok) {
        toast("Catálogo importado exitosamente.", "success");
        setIsImportModalOpen(false);
        setImportItems([]);
        fetchGlobalData();
      } else {
        const errData = await res.json();
        toast(errData.error || "Fallo al importar el catálogo.", "error");
      }
    } catch (err) {
      console.error(err);
      toast("Error de red al realizar la importación.", "error");
    } finally {
      setSaving(false);
    }
  };

  // Guardar plantilla de ticket
  const handleSaveTicketTpl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticketTpl) return;
    setTplSaving(true);
    try {
      const res = await fetch("/api/ticket-template", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(ticketTpl)
      });
      if (res.ok) {
        toast("Plantilla de ticket guardada exitosamente.", "success");
      } else {
        const err = await res.json();
        toast(err.error || "Error al guardar la plantilla.", "error");
      }
    } catch {
      toast("Error de red al guardar la plantilla.", "error");
    } finally {
      setTplSaving(false);
    }
  };

  // Formateo monetario con Intl
  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(amount);

  // Alérgenos catálogo listado
  const AVAILABLE_ALLERGENS: Allergen[] = [
    "gluten", "lacteos", "frutos_secos", "huevo", "pescado", "soja", "crustaceos", "moluscos", "sulfitos"
  ];

  return (
    <div className="min-h-screen bg-slate-50 font-sans flex flex-col md:flex-row pb-12" id="admin_root">
      
      {/* SIDEBAR NAVIGATION ADMIN */}
      {/* Hamburger toggle for mobile */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="fixed top-4 left-4 z-50 md:hidden bg-slate-900 text-white p-2.5 rounded-lg shadow-lg"
        aria-label={sidebarOpen ? "Cerrar menú" : "Abrir menú"}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {sidebarOpen
            ? <path strokeLinecap="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            : <path strokeLinecap="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          }
        </svg>
      </button>

      {/* Overlay when sidebar is open on mobile */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/40 z-40 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside className={`fixed md:relative z-50 inset-y-0 left-0 w-72 md:w-64 shrink-0 bg-slate-900 text-slate-300 flex flex-col justify-between border-r border-slate-800 transform transition-transform duration-200 ${
        sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
      }`}>
        <div className="p-5">
          <div className="flex items-center space-x-2 mb-6">
            <span className="p-1.5 bg-indigo-600 rounded text-white text-xs font-black">AD</span>
            <span className="text-sm font-black text-white tracking-wider uppercase">ADMINISTRACIÓN</span>
          </div>

          <nav className="space-y-1.5 text-xs font-bold uppercase tracking-wider">
            <button
              onClick={() => setActiveTab("dashboard")}
              className={`w-full flex items-center space-x-2.5 p-3 min-h-[44px] rounded-lg transition ${
                activeTab === "dashboard" ? "bg-slate-800 text-white" : "hover:bg-slate-850 hover:text-white"
              }`}
            >
              <BarChart3 className="w-4 h-4" />
              <span>Resumen y Ventas</span>
            </button>

            <button
              onClick={() => setActiveTab("catalog")}
              className={`w-full flex items-center space-x-2.5 p-3 min-h-[44px] rounded-lg transition ${
                activeTab === "catalog" ? "bg-slate-800 text-white" : "hover:bg-slate-850 hover:text-white"
              }`}
            >
              <BookOpen className="w-4 h-4" />
              <span>Cuidar la Carta</span>
            </button>

            <button
              onClick={() => setActiveTab("tables")}
              className={`w-full flex items-center space-x-2.5 p-3 min-h-[44px] rounded-lg transition ${
                activeTab === "tables" ? "bg-slate-800 text-white" : "hover:bg-slate-850 hover:text-white"
              }`}
            >
              <TableIcon className="w-4 h-4" />
              <span>Mesas y QR Generador</span>
            </button>

            <button
              onClick={() => setActiveTab("printer")}
              className={`w-full flex items-center space-x-2.5 p-3 min-h-[44px] rounded-lg transition ${
                activeTab === "printer" ? "bg-slate-800 text-white" : "hover:bg-slate-850 hover:text-white"
              }`}
            >
              <Printer className="w-4 h-4" />
              <span>Impresoras IP / Cola</span>
            </button>

            <button
              onClick={() => setActiveTab("tickets")}
              className={`w-full flex items-center space-x-2.5 p-3 min-h-[44px] rounded-lg transition ${
                activeTab === "tickets" ? "bg-slate-800 text-white" : "hover:bg-slate-850 hover:text-white"
              }`}
            >
              <span className="text-base">🧾</span>
              <span>Historial Tickets</span>
            </button>

            <button
              onClick={() => setActiveTab("ticket-tpl")}
              className={`w-full flex items-center space-x-2.5 p-3 min-h-[44px] rounded-lg transition ${
                activeTab === "ticket-tpl" ? "bg-slate-800 text-white" : "hover:bg-slate-850 hover:text-white"
              }`}
            >
              <span className="text-base">🎨</span>
              <span>Diseño Ticket</span>
            </button>

            <button
              onClick={() => setActiveTab("users")}
              className={`w-full flex items-center space-x-2.5 p-3 min-h-[44px] rounded-lg transition ${
                activeTab === "users" ? "bg-slate-800 text-white" : "hover:bg-slate-850 hover:text-white"
              }`}
            >
              <UserCheck className="w-4 h-4" />
              <span>Personal / Usuarios</span>
            </button>
          </nav>
        </div>

        {/* Acceso rápido a credenciales */}
        <div className="p-4 bg-slate-950/60 m-4 rounded-xl text-[11px] border border-slate-850">
          <h4 className="font-extrabold text-white mb-1.5 uppercase flex items-center space-x-1">
            <Shield className="w-3.5 h-3.5 text-indigo-500" />
            <span>Usuarios de Demostración</span>
          </h4>
          <span className="block text-slate-500">Prueba loguearte con:</span>
          <div className="space-y-1 mt-1 font-mono">
            <p className="text-slate-500">Camarero: <span className="text-amber-300 font-bold">camarero1</span> / camarero123</p>
            <p className="text-slate-500">Cocina: <span className="text-rose-300 font-bold">cocina1</span> / cocina123</p>
            <p className="text-slate-500">Barra: <span className="text-sky-300 font-bold">bar1</span> / bar123</p>
          </div>
        </div>
      </aside>

      {/* RECEPTÁCULO CONTENIDO DE PANTALLA */}
      <main className="flex-1 p-5 md:p-8 max-w-5xl mx-auto w-full pt-16 md:pt-8">
        {loading && (
          <div className="fixed top-4 right-4 z-50 bg-slate-950 text-white px-3 py-2 rounded-lg text-xs font-bold flex items-center space-x-1.5 border border-slate-800">
            <RefreshCw className="w-3 animate-spin text-indigo-400" />
            <span>Actualizando datos...</span>
          </div>
        )}

        {/* TAB 1: DASHBOARD METRICS */}
        {activeTab === "dashboard" && stats && (
          <div className="space-y-6">
            <h2 className="text-lg font-black text-slate-800 tracking-tight">Ventas y Métricas Recientes</h2>

            {/* Tarjetas KPI */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5" id="stats_cards_grid">
              <div className="bg-white p-5 rounded-2xl border border-slate-200">
                <span className="text-[10px] font-extrabold text-slate-500 uppercase">Ingresos Históricos</span>
                <p className="text-2xl font-black text-slate-800 mt-1">{formatCurrency(stats.totalSales)}</p>
                <span className="text-[10.5px] text-emerald-600 font-semibold block mt-1.5">✓ Contabilidad integrada</span>
              </div>

              <div className="bg-white p-5 rounded-2xl border border-slate-200">
                <span className="text-[10px] font-extrabold text-slate-500 uppercase">Mesas Activas</span>
                <p className="text-2xl font-black text-violet-600 mt-1">{stats.activeTablesCount}</p>
                <span className="text-[10.5px] text-slate-500 block mt-1.5">Mesas consumiendo carta</span>
              </div>

              <div className="bg-white p-5 rounded-2xl border border-slate-200">
                <span className="text-[10px] font-extrabold text-slate-500 uppercase">Ticket Medio por Mesa</span>
                <p className="text-2xl font-black text-indigo-600 mt-1">{formatCurrency(stats.avgTicket)}</p>
                <span className="text-[10.5px] text-slate-500 block mt-1.5">Ingreso promedio por cuenta</span>
              </div>
            </div>

            {/* 1. GRÁFICO DE AREA INTERACTIVO DE VENTAS POR HORA */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm relative">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h3 className="text-xs font-black text-slate-700 uppercase tracking-wider">Curva Dinámica de Facturación</h3>
                  <p className="text-[10px] text-slate-400">Ventas brutas acumuladas por franja horaria</p>
                </div>
                {hoveredHourPoint && (
                  <div className="bg-slate-900 text-white px-3 py-1.5 rounded-lg text-[10px] font-bold shadow-md animate-fade-in shrink-0">
                    🕒 {hoveredHourPoint.hour} | <span className="text-indigo-300">{hoveredHourPoint.sales.toFixed(2)}€</span>
                  </div>
                )}
              </div>
              
              <div className="w-full overflow-hidden select-none">
                <svg viewBox="0 0 600 220" className="w-full h-auto overflow-visible">
                  <defs>
                    <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#4f46e5" stopOpacity="0.4" />
                      <stop offset="100%" stopColor="#4f46e5" stopOpacity="0" />
                    </linearGradient>
                    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                      <feGaussianBlur stdDeviation="3" result="blur" />
                      <feComposite in="SourceGraphic" in2="blur" operator="over" />
                    </filter>
                  </defs>

                  {/* Líneas de cuadrícula horizontal */}
                  {[0, 0.25, 0.5, 0.75, 1].map((ratio, idx) => (
                    <line
                      key={idx}
                      x1="50"
                      y1={20 + ratio * 160}
                      x2="570"
                      y2={20 + ratio * 160}
                      className="stroke-slate-100"
                      strokeWidth="1"
                      strokeDasharray="4 4"
                    />
                  ))}

                  {(() => {
                    const data = stats.salesByHour;
                    if (data.length === 0) return null;
                    const maxVal = Math.max(...data.map(d => d.sales), 50) * 1.15;
                    
                    const points = data.map((pt, i) => ({
                      x: 50 + (i * 520) / (data.length - 1),
                      y: 180 - (pt.sales / maxVal) * 160,
                      raw: pt
                    }));

                    // Generar líneas de conexión L
                    const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(" ");
                    const fillPath = `${linePath} L ${points[points.length - 1].x} 180 L ${points[0].x} 180 Z`;

                    return (
                      <>
                        {/* Relleno de área degradada */}
                        <path d={fillPath} fill="url(#areaGrad)" />
                        
                        {/* Línea principal brillante */}
                        <path
                          d={linePath}
                          fill="none"
                          stroke="#4f46e5"
                          strokeWidth="3.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          filter="url(#glow)"
                        />

                        {/* Puntos / Marcadores */}
                        {points.map((p, idx) => {
                          const isHovered = hoveredHourPoint?.hour === p.raw.hour;
                          return (
                            <g key={idx}>
                              {/* Círculo invisible para ampliar área de hover */}
                              <circle
                                cx={p.x}
                                cy={p.y}
                                r="22"
                                className="fill-transparent cursor-pointer"
                                onMouseEnter={() => setHoveredHourPoint(p.raw)}
                                onMouseLeave={() => setHoveredHourPoint(null)}
                              />
                              {/* Marcador interno visible */}
                              <circle
                                cx={p.x}
                                cy={p.y}
                                r={isHovered ? "7" : "4.5"}
                                className="fill-indigo-600 stroke-white cursor-pointer transition-all duration-150"
                                strokeWidth="2"
                              />
                            </g>
                          );
                        })}

                        {/* Etiquetas X (Horas) */}
                        {points.map((p, idx) => (
                          <text
                            key={idx}
                            x={p.x}
                            y="202"
                            textAnchor="middle"
                            className="fill-slate-400 font-mono text-[9px] font-bold"
                          >
                            {p.raw.hour}
                          </text>
                        ))}

                        {/* Etiquetas Y (Moneda) */}
                        {[0, 0.5, 1].map((ratio, idx) => (
                          <text
                            key={idx}
                            x="42"
                            y={20 + ratio * 160 + 3.5}
                            textAnchor="end"
                            className="fill-slate-400 font-mono text-[9px] font-bold"
                          >
                            {((1 - ratio) * maxVal).toFixed(0)}€
                          </text>
                        ))}
                      </>
                    );
                  })()}
                </svg>
              </div>
            </div>

            {/* 2. GRÁFICO DE BARRAS HORIZONTAL INTERACTIVO DE TOP PRODUCTOS */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
              <div>
                <h3 className="text-xs font-black text-slate-700 uppercase tracking-wider mb-1">Top 5 Platos con Mayor Demanda</h3>
                <p className="text-[10px] text-slate-400 mb-4">Productos ordenados por facturación y popularidad</p>
              </div>

              {stats.topProducts.length === 0 ? (
                <p className="py-8 text-xs text-slate-500 text-center">Registra o cierra comensales para ver estadísticas de ventas.</p>
              ) : (
                <div className="w-full select-none">
                  <svg viewBox="0 0 500 200" className="w-full h-auto overflow-visible">
                    <defs>
                      <linearGradient id="barGrad" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#818cf8" />
                        <stop offset="100%" stopColor="#4f46e5" />
                      </linearGradient>
                    </defs>

                    {(() => {
                      const data = stats.topProducts;
                      const maxRevenue = Math.max(...data.map(d => d.revenue), 50);
                      const barHeight = 24;
                      const gap = 12;

                      return data.map((p, idx) => {
                        const y = idx * (barHeight + gap) + 10;
                        const scaleWidth = 300;
                        const w = (p.revenue / maxRevenue) * scaleWidth;
                        const isHovered = hoveredProductIndex === idx;

                        return (
                          <g 
                            key={idx}
                            onMouseEnter={() => setHoveredProductIndex(idx)}
                            onMouseLeave={() => setHoveredProductIndex(null)}
                            className="cursor-pointer"
                          >
                            {/* Nombre del producto */}
                            <text
                              x="5"
                              y={y + 16}
                              className={`fill-slate-800 text-[10px] font-black transition-colors ${
                                isHovered ? "fill-indigo-600" : ""
                              }`}
                            >
                              {p.name.length > 20 ? p.name.substring(0, 18) + ".." : p.name}
                            </text>

                            {/* Barra de fondo */}
                            <rect
                              x="130"
                              y={y}
                              width={scaleWidth}
                              height={barHeight}
                              className="fill-slate-50 rounded-md"
                              rx="6"
                            />

                            {/* Barra activa */}
                            <rect
                              x="130"
                              y={y}
                              width={w}
                              height={barHeight}
                              fill="url(#barGrad)"
                              rx="6"
                              className="transition-all duration-500 ease-out"
                              opacity={isHovered ? 1 : 0.85}
                            />

                            {/* Unidades vendidas (dentro de la barra si cabe, o al final) */}
                            <text
                              x={130 + w - 8 > 155 ? 130 + w - 8 : 130 + w + 8}
                              y={y + 15}
                              textAnchor={130 + w - 8 > 155 ? "end" : "start"}
                              className={`text-[9px] font-bold ${
                                130 + w - 8 > 155 ? "fill-white" : "fill-slate-500"
                              }`}
                            >
                              {p.salesCount} uds
                            </text>

                            {/* Total de ingresos */}
                            <text
                              x="495"
                              y={y + 16}
                              textAnchor="end"
                              className={`font-mono text-[10px] font-extrabold transition-colors ${
                                isHovered ? "fill-indigo-600 text-xs" : "fill-slate-900"
                              }`}
                            >
                              {p.revenue.toFixed(2)}€
                            </text>
                          </g>
                        );
                      });
                    })()}
                  </svg>
                </div>
              )}
            </div>

            {/* 3. GRÁFICO DONUT INTERACTIVO PARA APORTACIÓN POR MESA */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
              <div>
                <h3 className="text-xs font-black text-slate-700 uppercase tracking-wider mb-1">Aportación de Facturación por Mesa</h3>
                <p className="text-[10px] text-slate-400 mb-4">Visualización de ingresos acumulados por punto de venta</p>
              </div>

              {(() => {
                const salesByTable = (stats as any).salesByTable || [];
                if (salesByTable.length === 0) {
                  return <p className="py-8 text-xs text-slate-500 text-center">No hay registros de ventas para graficar.</p>;
                }

                const totalSales = salesByTable.reduce((acc: number, cur: any) => acc + cur.totalSales, 0);
                const colors = [
                  "#4f46e5", // Indigo
                  "#7c3aed", // Violet
                  "#10b981", // Emerald
                  "#f59e0b", // Amber
                  "#f43f5e", // Rose
                  "#0ea5e9", // Sky
                  "#06b6d4", // Cyan
                  "#64748b"  // Slate
                ];

                // Preparación de segmentos para la rosquilla
                let accumulatedPercent = 0;
                const r = 50;
                const circumference = 2 * Math.PI * r;

                const segments = salesByTable.map((t: any, idx: number) => {
                  const percent = totalSales > 0 ? t.totalSales / totalSales : 0;
                  const strokeOffset = circumference - (percent * circumference);
                  const strokeDashoffset = strokeOffset;
                  const rotationAngle = accumulatedPercent * 360 - 90;
                  accumulatedPercent += percent;

                  return {
                    ...t,
                    percent,
                    strokeDashoffset,
                    rotationAngle,
                    color: colors[idx % colors.length]
                  };
                });

                const activeSegment = hoveredTableIndex !== null ? segments[hoveredTableIndex] : null;

                return (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
                    
                    {/* Donut Canvas */}
                    <div className="flex justify-center items-center relative select-none">
                      <svg viewBox="0 0 200 200" className="w-48 h-48 overflow-visible">
                        {segments.map((seg: any, idx: number) => {
                          const isHovered = hoveredTableIndex === idx;
                          return (
                            <circle
                              key={idx}
                              cx="100"
                              cy="100"
                              r={r}
                              fill="transparent"
                              stroke={seg.color}
                              strokeWidth={isHovered ? 14 : 10}
                              strokeDasharray={circumference}
                              strokeDashoffset={seg.strokeDashoffset}
                              transform={`rotate(${seg.rotationAngle} 100 100)`}
                              strokeLinecap="round"
                              onMouseEnter={() => setHoveredTableIndex(idx)}
                              onMouseLeave={() => setHoveredTableIndex(null)}
                              className="transition-all duration-200 cursor-pointer"
                            />
                          );
                        })}

                        {/* Texto central */}
                        <g className="pointer-events-none">
                          <text
                            x="100"
                            y="95"
                            textAnchor="middle"
                            className="fill-slate-400 text-[9px] font-bold uppercase tracking-wider"
                          >
                            {activeSegment ? activeSegment.tableName : "Total"}
                          </text>
                          <text
                            x="100"
                            y="114"
                            textAnchor="middle"
                            className="fill-slate-800 text-sm font-black"
                          >
                            {activeSegment 
                              ? `${activeSegment.totalSales.toFixed(1)}€`
                              : `${totalSales.toFixed(1)}€`
                            }
                          </text>
                          {activeSegment && (
                            <text
                              x="100"
                              y="128"
                              textAnchor="middle"
                              className="fill-indigo-600 text-[9px] font-mono font-bold"
                            >
                              {(activeSegment.percent * 100).toFixed(0)}% del total
                            </text>
                          )}
                        </g>
                      </svg>
                    </div>

                    {/* Leyenda interactiva */}
                    <div className="space-y-2">
                      {segments.map((seg: any, idx: number) => {
                        const isHovered = hoveredTableIndex === idx;
                        return (
                          <div
                            key={idx}
                            onMouseEnter={() => setHoveredTableIndex(idx)}
                            onMouseLeave={() => setHoveredTableIndex(null)}
                            className={`flex justify-between items-center p-2 rounded-xl border transition-all cursor-pointer ${
                              isHovered 
                                ? "bg-slate-50 border-indigo-200 shadow-sm translate-x-1" 
                                : "bg-white border-slate-100 hover:bg-slate-50"
                            }`}
                          >
                            <div className="flex items-center space-x-2.5">
                              <span 
                                className="w-2.5 h-2.5 rounded-full shrink-0" 
                                style={{ backgroundColor: seg.color }}
                              />
                              <span className={`text-xs font-bold ${
                                isHovered ? "text-indigo-950 font-black" : "text-slate-700"
                              }`}>
                                {seg.tableName}
                              </span>
                            </div>
                            <div className="text-right">
                              <span className="text-xs font-extrabold text-slate-900 block">
                                {seg.totalSales.toFixed(2)}€
                              </span>
                              <span className="text-[9px] text-slate-400 block font-mono">
                                {seg.ticketCount} tkt ({(seg.percent * 100).toFixed(0)}%)
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* TAB 2: CLEMENTINA LA CARTA (Catalog Manager) */}
        {activeTab === "catalog" && (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-black text-slate-800">Cuidar la Carta y los Precios</h2>
              <div className="flex space-x-2">
                <button
                  type="button"
                  onClick={() => {
                    setImportItems([]);
                    setIsImportModalOpen(true);
                  }}
                  className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-extrabold text-xs px-3.5 py-2 rounded-xl border border-indigo-200 flex items-center space-x-1 cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>Importar CSV</span>
                </button>
                <button
                  onClick={() => {
                    setEditCategoryMode(null);
                    setCatName("");
                    setCatDesc("");
                    setIsCatModalOpen(true);
                  }}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold text-xs px-3.5 py-2 rounded-xl border border-slate-200 flex items-center space-x-1 cursor-pointer"
                >
                  <PlusCircle className="w-4 h-4 text-slate-500" />
                  <span>Categoría</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditProductMode(null);
                    setProdName("");
                    setProdDesc("");
                    setProdPrice("");
                    setProdStock("");
                    setProdAllergens([]);
                    if (categories.length > 0) setProdCatId(categories[0].id);
                    setIsProdModalOpen(true);
                  }}
                  className="bg-slate-900 hover:bg-indigo-600 text-white font-extrabold text-xs px-3.5 py-2 rounded-xl flex items-center space-x-1 cursor-pointer"
                >
                  <PlusCircle className="w-4 h-4" />
                  <span>Plato Nuevo</span>
                </button>
              </div>
            </div>

            {/* Listado de categorías y sus productos integrados */}
            <div className="space-y-6">
              {categories.map(cat => {
                const catProducts = products.filter(p => p.categoryId === cat.id);

                return (
                  <div key={cat.id} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs" id={`catalog_group_${cat.id}`}>
                    <div className="flex justify-between items-center border-b border-slate-100 pb-3.5 mb-4">
                      <div>
                        <h3 className="font-extrabold text-sm text-slate-900">{cat.name}</h3>
                        <p className="text-[11px] text-slate-500">{cat.description || "Sin descripción de categoría"}</p>
                      </div>
                      <div className="flex space-x-1 text-xs">
                        <button
                          onClick={() => {
                            setEditCategoryMode(cat);
                            setCatName(cat.name);
                            setCatDesc(cat.description || "");
                            setIsCatModalOpen(true);
                          }}
                          className="p-1 px-2.5 min-h-[44px] rounded bg-slate-50 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-200 text-slate-600 hover:text-indigo-700 flex items-center space-x-1 font-bold cursor-pointer transition"
                        >
                          <Edit3 className="w-3 h-3" />
                          <span>Editar</span>
                        </button>
                        <button
                          onClick={() => handleDeleteCategory(cat.id)}
                          className="p-1 px-2.5 min-h-[44px] rounded hover:bg-red-50 hover:border-red-200 text-slate-500 hover:text-red-600 flex items-center space-x-1 font-bold cursor-pointer transition border border-transparent"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    {/* Tabla productos */}
                    {catProducts.length === 0 ? (
                      <p className="text-center text-slate-500 text-xs py-5 border border-dashed border-slate-100 rounded-xl">No hay productos en esta categoría. Agrega uno arriba.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs text-left">
                          <thead>
                            <tr className="border-b border-slate-100 text-slate-500 uppercase tracking-wider text-[10px]">
                              <th className="pb-2.5 font-bold">Plato / Bebida</th>
                              <th className="pb-2.5 font-bold">Precio</th>
                              <th className="pb-2.5 font-bold">Impuesto (IVA)</th>
                              <th className="pb-2.5 font-bold">Stock</th>
                              <th className="pb-2.5 font-bold text-right">Acciones</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50 text-slate-700">
                            {catProducts.map(p => (
                              <tr key={p.id} className="hover:bg-slate-50/50">
                                <td className="py-3">
                                  <span className="font-extrabold text-slate-900 block">{p.name}</span>
                                  {p.allergens.length > 0 && (
                                    <span className="text-[10px] text-slate-500">Alérgenos: {p.allergens.join(", ")}</span>
                                  )}
                                </td>
                                <td className="py-3 font-bold">{p.price.toFixed(2)}€</td>
                                <td className="py-3 font-mono">{p.iva}%</td>
                                <td className="py-3">
                                  {p.stock !== null ? (
                                    <span className={`font-bold ${p.stock < 5 ? "text-red-500" : "text-slate-500"}`}>{p.stock} raciones</span>
                                  ) : (
                                    <span className="text-slate-500">Ilimitado</span>
                                  )}
                                </td>
                                <td className="py-3 text-right">
                                  <div className="inline-flex space-x-2 text-xs">
                                    <button
                                      onClick={() => {
                                        setEditProductMode(p);
                                        setProdName(p.name);
                                        setProdDesc(p.description);
                                        setProdPrice(String(p.price));
                                        setProdStock(p.stock !== null ? String(p.stock) : "unlimited");
                                        setProdAllergens(p.allergens);
                                        setProdIva(String(p.iva));
                                        setProdCatId(p.categoryId);
                                        setIsProdModalOpen(true);
                                      }}
                                      className="p-1.5 min-h-[44px] rounded bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-600 transition cursor-pointer"
                                    >
                                      Editar
                                    </button>
                                    <button
                                      onClick={() => handleDeleteProduct(p.id)}
                                      className="p-1.5 min-h-[44px] rounded hover:bg-red-50 hover:border-red-100 text-slate-500 hover:text-red-600 transition cursor-pointer"
                                    >
                                      Baja
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 3: REGISTRO DE MESAS Y CODIGO QR */}
        {activeTab === "tables" && (
          <div className="space-y-6">
            <h2 className="text-lg font-black text-slate-800">Gestión de Mesas y Diseño del Salón</h2>
            
            <p className="text-xs text-slate-500 leading-relaxed max-w-2xl bg-white p-3.5 rounded-xl border border-slate-200">
              💡 Cada mesa del restaurante cuenta con un código QR único. Puedes crearlas, eliminarlas y organizar su posición en el plano del salón arrastrándolas.
            </p>

            {/* Formulario crear mesa */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
              <h3 className="text-xs font-black text-slate-700 uppercase tracking-widest mb-3.5 flex items-center">
                <span>Crear Nueva Mesa</span>
              </h3>

              <form onSubmit={handleAddTable} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Número de Mesa</label>
                  <input
                    type="number"
                    value={newTableNumber}
                    onChange={(e) => setNewTableNumber(e.target.value)}
                    placeholder="Ej: 9"
                    required
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-xs text-slate-700 outline-none focus:border-indigo-400 focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Nombre Descriptivo</label>
                  <input
                    type="text"
                    value={newTableName}
                    onChange={(e) => setNewTableName(e.target.value)}
                    placeholder="Ej: Mesa Terraza 1"
                    required
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-xs text-slate-700 outline-none focus:border-indigo-400 focus:bg-white"
                  />
                </div>

                <div className="flex items-end">
                  <button
                    type="submit"
                    className="w-full bg-slate-900 hover:bg-indigo-600 text-white font-extrabold text-xs py-3 px-4 rounded-lg flex justify-center items-center space-x-1 cursor-pointer transition"
                  >
                    <PlusCircle className="w-4 h-4" />
                    <span>Dar de Alta</span>
                  </button>
                </div>
              </form>
            </div>

            {/* EDITOR DE DISEÑO DEL SALÓN */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
                <div className="flex items-center space-x-3">
                  <h3 className="text-xs font-black text-slate-700 uppercase tracking-widest flex items-center space-x-1.5">
                    <span>📐 Diseño del Salón</span>
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowHeatmap(!showHeatmap)}
                    className={`text-[10px] font-bold py-1 px-2.5 rounded-lg border transition cursor-pointer flex items-center space-x-1 ${
                      showHeatmap 
                        ? "bg-rose-500 text-white border-rose-500" 
                        : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
                    }`}
                  >
                    <span>🔥 Mapa Térmico de Facturación</span>
                  </button>
                </div>
                <span className="text-[10px] text-slate-500">Arrastra las mesas para colocarlas</span>
              </div>

              <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl p-4 overflow-auto touch-pan-x touch-pan-y" style={{ minHeight: "400px" }}>
                <div className="relative mx-auto" style={{ width: 900, height: 500, maxWidth: "none" }}>
                  {/* Grid de fondo */}
                  <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ opacity: 0.15 }}>
                    <defs>
                      <pattern id="grid-small" width="20" height="20" patternUnits="userSpaceOnUse">
                        <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#94a3b8" strokeWidth="0.5"/>
                      </pattern>
                    </defs>
                    <rect width="100%" height="100%" fill="url(#grid-small)" />
                  </svg>

                  {tables.map(table => {
                    const isFree = table.status === "libre";
                    const isOccupied = table.status === "ocupada";
                    const isPending = table.status === "pendiente_pago";
                    const bgColor = isFree ? "bg-emerald-50 border-emerald-200" : isOccupied ? "bg-amber-50 border-amber-200" : "bg-sky-50 border-sky-200";
                    const statusColor = isFree ? "bg-emerald-200 text-emerald-800" : isOccupied ? "bg-amber-200 text-amber-800" : "bg-sky-200 text-sky-800";

                    // Mapa térmico calculations
                    const tableStats = stats ? (stats as any).salesByTable?.find((s: any) => s.tableName === table.name) : null;
                    const revenue = tableStats ? tableStats.totalSales : 0;
                    const maxTableRevenue = Math.max(...((stats as any)?.salesByTable || []).map((s: any) => s.totalSales), 1);
                    
                    let heatmapBg = "bg-slate-100 border-slate-200 text-slate-400 opacity-60";
                    
                    if (revenue > 0) {
                      const ratio = revenue / maxTableRevenue;
                      if (ratio >= 0.7) {
                        heatmapBg = "bg-rose-50 border-rose-350 ring-4 ring-rose-500/10 text-rose-950 font-black shadow-md";
                      } else if (ratio >= 0.3) {
                        heatmapBg = "bg-amber-55 border-amber-300 ring-2 ring-amber-500/5 text-amber-950 font-extrabold";
                      } else {
                        heatmapBg = "bg-emerald-50 border-emerald-300 text-emerald-950";
                      }
                    }

                    const finalBgColor = showHeatmap ? heatmapBg : bgColor;

                    return (
                      <div
                        key={table.id}
                        className={`absolute select-none ${finalBgColor} border-2 rounded-2xl shadow-sm cursor-grab active:cursor-grabbing group`}
                        style={{
                          left: table.posX,
                          top: table.posY,
                          width: table.width || 140,
                          height: table.height || 100,
                          touchAction: "none",
                          willChange: "left, top"
                        }}
                        onMouseDown={(e) => {
                          if ((e.target as HTMLElement).closest(".resize-handle")) return;
                          e.preventDefault();
                          const startX = e.clientX;
                          const startY = e.clientY;
                          const startPosX = table.posX;
                          const startPosY = table.posY;

                          const onMove = (me: MouseEvent) => {
                            const dx = me.clientX - startX;
                            const dy = me.clientY - startY;
                            const newX = Math.max(0, startPosX + dx);
                            const newY = Math.max(0, startPosY + dy);
                            setTables(prev => prev.map(t => t.id === table.id ? { ...t, posX: newX, posY: newY } : t));
                          };

                          const onUp = (ue: MouseEvent) => {
                            window.removeEventListener("mousemove", onMove);
                            window.removeEventListener("mouseup", onUp);
                            const dx = ue.clientX - startX;
                            const dy = ue.clientY - startY;
                            const newX = Math.max(0, startPosX + dx);
                            const newY = Math.max(0, startPosY + dy);
                            setTables(prev => prev.map(t => t.id === table.id ? { ...t, posX: newX, posY: newY } : t));
                            fetch(`/api/tables/${table.id}/position`, {
                              method: "PUT",
                              headers: { "Content-Type": "application/json", ...authHeaders() },
                              body: JSON.stringify({ posX: newX, posY: newY, width: table.width, height: table.height })
                            }).catch(() => {});
                          };

                          window.addEventListener("mousemove", onMove);
                          window.addEventListener("mouseup", onUp);
                        }}
                        onTouchStart={(e) => {
                          if ((e.target as HTMLElement).closest(".resize-handle")) return;
                          const touch = e.touches[0];
                          const startX = touch.clientX;
                          const startY = touch.clientY;
                          const startPosX = table.posX;
                          const startPosY = table.posY;

                          const onMove = (te: TouchEvent) => {
                            te.preventDefault();
                            const t = te.touches[0];
                            const dx = t.clientX - startX;
                            const dy = t.clientY - startY;
                            const newX = Math.max(0, startPosX + dx);
                            const newY = Math.max(0, startPosY + dy);
                            setTables(prev => prev.map(t => t.id === table.id ? { ...t, posX: newX, posY: newY } : t));
                          };

                          const onEnd = (te: TouchEvent) => {
                            window.removeEventListener("touchmove", onMove);
                            window.removeEventListener("touchend", onEnd);
                            const changedTouch = te.changedTouches[0];
                            const dx = changedTouch.clientX - startX;
                            const dy = changedTouch.clientY - startY;
                            const newX = Math.max(0, startPosX + dx);
                            const newY = Math.max(0, startPosY + dy);
                            const tNew = { posX: newX, posY: newY, width: table.width, height: table.height };
                            setTables(prev => prev.map(t => t.id === table.id ? { ...t, ...tNew } : t));
                            fetch(`/api/tables/${table.id}/position`, {
                              method: "PUT",
                              headers: { "Content-Type": "application/json", ...authHeaders() },
                              body: JSON.stringify(tNew)
                            }).catch(() => {});
                          };

                          window.addEventListener("touchmove", onMove, { passive: false });
                          window.addEventListener("touchend", onEnd);
                        }}
                      >
                        <div className="flex flex-col items-center justify-center h-full p-1.5">
                          <span className="text-xs font-mono font-bold text-slate-500">#{table.number}</span>
                          <span className="font-extrabold text-sm text-slate-800 text-center leading-tight mt-0.5">{table.name}</span>
                          {(() => {
                            // Re-calculate the badge color and label locally
                            const tableStats = stats ? (stats as any).salesByTable?.find((s: any) => s.tableName === table.name) : null;
                            const revenue = tableStats ? tableStats.totalSales : 0;
                            const maxTableRevenue = Math.max(...((stats as any)?.salesByTable || []).map((s: any) => s.totalSales), 1);
                            
                            let heatmapBadge = "bg-slate-200 text-slate-600";
                            if (revenue > 0) {
                              const ratio = revenue / maxTableRevenue;
                              if (ratio >= 0.7) {
                                heatmapBadge = "bg-rose-500 text-white font-black";
                              } else if (ratio >= 0.3) {
                                heatmapBadge = "bg-amber-550 text-slate-950 font-bold";
                              } else {
                                heatmapBadge = "bg-emerald-500 text-white font-semibold";
                              }
                            }
                            const finalStatusColor = showHeatmap ? heatmapBadge : statusColor;

                            return (
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded mt-1 ${finalStatusColor}`}>
                                {showHeatmap ? `${revenue.toFixed(2)}€` : (isFree ? "Libre" : isOccupied ? "Ocupada" : "Pago")}
                              </span>
                            );
                          })()}
                        </div>
                        {/* Resize handle */}
                        <div
                          className="resize-handle absolute bottom-0 right-0 w-5 h-5 bg-slate-800/60 hover:bg-slate-900 rounded-tl-lg cursor-se-resize flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          onMouseDown={(re) => {
                            re.preventDefault();
                            re.stopPropagation();
                            const startX = re.clientX;
                            const startY = re.clientY;
                            const startW = table.width || 140;
                            const startH = table.height || 100;

                            const onResizeMove = (rme: MouseEvent) => {
                              const dw = rme.clientX - startX;
                              const dh = rme.clientY - startY;
                              const newW = Math.max(80, startW + dw);
                              const newH = Math.max(60, startH + dh);
                              setTables(prev => prev.map(t => t.id === table.id ? { ...t, width: newW, height: newH } : t));
                            };

                            const onResizeUp = () => {
                              window.removeEventListener("mousemove", onResizeMove);
                              window.removeEventListener("mouseup", onResizeUp);
                            };

                            window.addEventListener("mousemove", onResizeMove);
                            window.addEventListener("mouseup", onResizeUp);
                          }}
                        >
                          <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Listado de mesas con su QR imprimible */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
              <h3 className="text-xs font-black text-slate-700 uppercase tracking-widest mb-4 pb-3 border-b border-slate-100">
                <span>Mesas y Códigos QR</span>
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" id="tables_qr_cards_list">
                {tables.map(table => {
                  const appUrlBase = window.location.origin;
                  const finalTargetUrl = `${appUrlBase}?mesa=${table.number}`;
                  const qrEndpoint = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(finalTargetUrl)}`;

                  return (
                    <div 
                      key={table.id} 
                      className="border border-slate-200 rounded-xl p-3.5 flex items-center justify-between hover:border-slate-300 transition"
                    >
                      <div className="flex-1 pr-3 min-w-0">
                        <span className="text-[10px] font-mono text-slate-500 font-bold uppercase">Mesa</span>
                        <h4 className="font-extrabold text-slate-900 text-sm">{table.name}</h4>
                        
                        <div className="bg-slate-50 border p-1.5 rounded-lg font-mono text-[10px] text-slate-500 mt-1.5 truncate">
                          {finalTargetUrl}
                        </div>

                        <div className="mt-3 flex space-x-2">
                          <button
                            onClick={() => {
                              const link = document.createElement("a");
                              link.href = qrEndpoint;
                              link.target = "_blank";
                              link.click();
                            }}
                            className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-[10px] px-2 py-1.5 min-h-[44px] rounded-md flex items-center space-x-1 cursor-pointer transition border border-indigo-100"
                          >
                            <Eye className="w-3 h-3" />
                            <span>QR</span>
                          </button>
                          <button
                            onClick={() => handleDeleteTable(table.id)}
                            className="hover:bg-red-50 text-slate-500 hover:text-red-600 font-bold text-[10px] px-2 py-1.5 min-h-[44px] rounded-md transition"
                          >
                            Eliminar
                          </button>
                        </div>
                      </div>

                      <div className="w-16 h-16 bg-white border border-slate-150 rounded-lg shrink-0 flex items-center justify-center">
                        <img 
                          src={qrEndpoint} 
                          alt="QR" 
                          className="w-full h-full"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: CONFIGURADOR IMPRESORA IP */}
        {activeTab === "printer" && (
          <div className="space-y-6">
            <h2 className="text-lg font-black text-slate-800">Parámetros de Impresoras Térmicas Zebra (ZPL)</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              
              {/* Ajustes de Red - Cocina */}
              <div className="lg:col-span-1 bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
                <h3 className="text-xs font-black text-slate-700 uppercase tracking-wider mb-4 pb-1.5 border-b border-slate-100 flex items-center">
                  <span>🍳 Impresora de Cocina por IP Fija</span>
                </h3>

                <form onSubmit={handleSavePrinter} className="space-y-3.5 text-xs text-slate-600">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">Nombre del Host / Apodo</label>
                    <input
                      type="text"
                      value={printerName}
                      onChange={(e) => setPrinterName(e.target.value)}
                      required
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-slate-700 outline-none focus:border-indigo-400 focus:bg-white"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">Dirección IP de Red</label>
                    <input
                      type="text"
                      value={printerIp}
                      onChange={(e) => setPrinterIp(e.target.value)}
                      placeholder="Ej: 192.168.1.100"
                      required
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-slate-700 outline-none focus:border-indigo-400 focus:bg-white"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">Puerto de Servicio (Raw TCP)</label>
                    <input
                      type="number"
                      value={printerPort}
                      onChange={(e) => setPrinterPort(e.target.value)}
                      required
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-slate-700 outline-none focus:border-indigo-400 focus:bg-white"
                    />
                  </div>

                  <div className="flex items-center space-x-2 pt-1 pb-2">
                    <input
                      type="checkbox"
                      id="ip_printer_toggle"
                      checked={printerEnabled}
                      onChange={(e) => setPrinterEnabled(e.target.checked)}
                      className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500"
                    />
                    <label htmlFor="ip_printer_toggle" className="font-bold cursor-pointer">Impresora en funcionamiento (Habilitar)</label>
                  </div>

                  <div className="space-y-1.5 pt-1 pb-2">
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">Modo de Impresión</label>
                    <div className="flex space-x-2">
                      <button
                        type="button"
                        onClick={() => setPrinterMode("browser")}
                        className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold border transition cursor-pointer ${
                          printerMode === "browser"
                            ? "bg-indigo-100 text-indigo-700 border-indigo-300"
                            : "bg-slate-50 text-slate-500 border-slate-200 hover:border-indigo-200"
                        }`}
                      >
                        🌐 Navegador Directo
                      </button>
                      <button
                        type="button"
                        onClick={() => setPrinterMode("server")}
                        className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold border transition cursor-pointer ${
                          printerMode === "server"
                            ? "bg-indigo-100 text-indigo-700 border-indigo-300"
                            : "bg-slate-50 text-slate-500 border-slate-200 hover:border-indigo-200"
                        }`}
                      >
                        🖥️ Servidor TCP
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1">
                      {printerMode === "browser"
                        ? "El navegador envía ZPL directo a la IP de la impresora. Ideal para red local."
                        : "El servidor Express conecta por TCP a la IP de la impresora."}
                    </p>
                  </div>

                  <button
                    type="submit"
                    className="w-full bg-slate-900 hover:bg-indigo-600 text-white font-extrabold py-2.5 px-4 rounded-lg flex justify-center items-center cursor-pointer transition"
                  >
                    Guardar Configuración
                  </button>

                  <button
                    type="button"
                    onClick={() => triggerTestPrint("kitchen")}
                    className="w-full bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 font-extrabold py-2.5 px-4 rounded-lg flex justify-center items-center cursor-pointer transition"
                  >
                    <span>🎯 Mandar Comanda de Prueba</span>
                  </button>
                </form>

                {/* Status log del test */}
                {testPrintStatus && (
                  <div className={`mt-4 p-3 rounded-lg text-[11px] border ${
                    testPrintStatus.success === undefined ? "bg-slate-100 text-slate-600 border-slate-200" :
                    testPrintStatus.success ? "bg-emerald-50 text-emerald-800 border-emerald-200" :
                    "bg-amber-50 text-amber-800 border-amber-200"
                  }`}>
                    {testPrintStatus.success === false && (
                      <span className="font-extrabold block mb-1">⚠️ Error de red local simulado:</span>
                    )}
                    <p className="font-mono leading-relaxed">{testPrintStatus.msg}</p>
                  </div>
                )}
              </div>

              {/* Ajustes de Red - Tickets */}
              <div className="lg:col-span-1 bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
                <h3 className="text-xs font-black text-slate-700 uppercase tracking-wider mb-4 pb-1.5 border-b border-slate-100 flex items-center">
                  <span>🧾 Impresora de Tickets por IP Fija</span>
                </h3>

                <form onSubmit={handleSaveTicketPrinter} className="space-y-3.5 text-xs text-slate-600">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">Nombre del Host / Apodo</label>
                    <input
                      type="text"
                      value={ticketPrinterName}
                      onChange={(e) => setTicketPrinterName(e.target.value)}
                      required
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-slate-700 outline-none focus:border-indigo-400 focus:bg-white"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">Dirección IP de Red</label>
                    <input
                      type="text"
                      value={ticketPrinterIp}
                      onChange={(e) => setTicketPrinterIp(e.target.value)}
                      placeholder="Ej: 192.168.1.101"
                      required
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-slate-700 outline-none focus:border-indigo-400 focus:bg-white"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">Puerto de Servicio (Raw TCP)</label>
                    <input
                      type="number"
                      value={ticketPrinterPort}
                      onChange={(e) => setTicketPrinterPort(e.target.value)}
                      required
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-slate-700 outline-none focus:border-indigo-400 focus:bg-white"
                    />
                  </div>

                  <div className="flex items-center space-x-2 pt-1 pb-2">
                    <input
                      type="checkbox"
                      id="ticket_printer_toggle"
                      checked={ticketPrinterEnabled}
                      onChange={(e) => setTicketPrinterEnabled(e.target.checked)}
                      className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500"
                    />
                    <label htmlFor="ticket_printer_toggle" className="font-bold cursor-pointer">Impresora de tickets habilitada</label>
                  </div>

                  <div className="space-y-1.5 pt-1 pb-2">
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">Modo de Impresión</label>
                    <div className="flex space-x-2">
                      <button
                        type="button"
                        onClick={() => setTicketPrinterMode("browser")}
                        className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold border transition cursor-pointer ${
                          ticketPrinterMode === "browser"
                            ? "bg-indigo-100 text-indigo-700 border-indigo-300"
                            : "bg-slate-50 text-slate-500 border-slate-200 hover:border-indigo-200"
                        }`}
                      >
                        🌐 Navegador Directo
                      </button>
                      <button
                        type="button"
                        onClick={() => setTicketPrinterMode("server")}
                        className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold border transition cursor-pointer ${
                          ticketPrinterMode === "server"
                            ? "bg-indigo-100 text-indigo-700 border-indigo-300"
                            : "bg-slate-50 text-slate-500 border-slate-200 hover:border-indigo-200"
                        }`}
                      >
                        🖥️ Servidor TCP
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1">
                      {ticketPrinterMode === "browser"
                        ? "El navegador envía ZPL directo a la IP de la impresora. Ideal para red local."
                        : "El servidor Express conecta por TCP a la IP de la impresora."}
                    </p>
                  </div>

                  <button
                    type="submit"
                    className="w-full bg-slate-900 hover:bg-indigo-600 text-white font-extrabold py-2.5 px-4 rounded-lg flex justify-center items-center cursor-pointer transition"
                  >
                    Guardar Configuración
                  </button>

                  <button
                    type="button"
                    onClick={() => triggerTestPrint("ticket")}
                    className="w-full bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 font-extrabold py-2.5 px-4 rounded-lg flex justify-center items-center cursor-pointer transition mt-2"
                  >
                    <span>🎯 Mandar Ticket de Prueba</span>
                  </button>
                </form>
              </div>

              {/* Historial log terminal */}
              <div className="lg:col-span-1 bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-col">
                <h3 className="text-xs font-black text-slate-700 uppercase tracking-wider mb-4 pb-1.5 border-b border-slate-100">
                  <span>Monitor de Cola de Impresión</span>
                </h3>

                <div className="font-mono bg-slate-950 text-indigo-400 p-4 rounded-xl text-xs space-y-2.5 max-h-[360px] overflow-y-auto w-full flex-1 scrollbar-thin">
                  <p className="text-slate-500 text-[10px] pb-1 border-b border-slate-900 border-dashed">// MONITOR DE SERVIDOR ACTIVO. CONEXIONES DIRECTAS TCP/IP</p>
                  {printLogs.length === 0 ? (
                    <p className="text-slate-600 italic py-4 text-center">La cola de impresión de red está vacía. Haz pedidos desde un QR para llenarla.</p>
                  ) : (
                    printLogs.slice().reverse().map((log) => {
                      const isSent = log.status === "sent";
                      const isFailed = log.status === "failed";
                      
                      return (
                        <div key={log.id} className="pb-2.5 border-b border-slate-900 last:border-b-0">
                          <div className="flex justify-between text-[11px]">
                            <span className="text-slate-500">CMD ID: #{log.id.slice(-5).toUpperCase()}</span>
                            <span className={isSent ? "text-emerald-400" : isFailed ? "text-rose-500 font-bold" : "text-amber-400"}>
                              [{log.status.toUpperCase()}]
                            </span>
                          </div>
                          
                          <p className="text-slate-500 text-[10px] mt-0.5">Order link: #{log.orderId.slice(-6).toUpperCase()} | Retries: {log.retries}/3</p>
                          
                          {log.errorMessage && (
                            <p className="text-amber-500 text-[10px] mt-1 bg-amber-500/10 border border-amber-950 p-1 rounded">
                              ERROR: "{log.errorMessage.slice(0, 80)}"
                            </p>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

            </div>
          </div>
        )}

        {/* TAB 5: HISTORIAL DE TICKETS CERRADOS */}
        {activeTab === "tickets" && (
          <div className="space-y-6">
            <h2 className="text-lg font-black text-slate-800">Historial de Tickets Cerrados</h2>
            <p className="text-xs text-slate-500 leading-relaxed max-w-2xl bg-white p-3.5 rounded-xl border border-slate-200">
              Revisa tickets ya cobrados. Para modificaciones, usa el panel de Camarero con autorización de Admin.
            </p>
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
              <div className="space-y-3 max-h-[600px] overflow-y-auto">
                {closedReceipts.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-8">No hay tickets cerrados en el historial.</p>
                ) : (
                  closedReceipts.slice().reverse().map((rec: any) => (
                    <div key={rec.id} className="border border-slate-200 rounded-xl p-3.5 text-xs">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <span className="font-bold text-slate-800">{rec.tableName}</span>
                          <span className="text-slate-500 ml-2 font-mono">#{rec.id.slice(-8).toUpperCase()}</span>
                          <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                            {new Date(rec.timestamp).toLocaleString("es-ES")} | {rec.splitMethod || "completa"}
                          </p>
                        </div>
                        <span className="font-extrabold text-slate-900">{rec.total.toFixed(2)}€</span>
                      </div>
                      <div className="border-t border-slate-100 pt-2 space-y-1">
                        {rec.items && rec.items.map((item: any, ii: number) => (
                          <div key={ii} className="flex justify-between text-[11px] text-slate-600">
                            <span>{item.quantity}x {item.name}</span>
                            <span className="font-medium text-slate-800">{item.priceTotal.toFixed(2)}€</span>
                          </div>
                        ))}
                      </div>
                      <div className="border-t border-slate-100 mt-2 pt-2 flex justify-between items-center text-xs">
                        <div className="flex space-x-3 font-bold text-slate-700">
                          <span>Subtotal: {rec.subtotal?.toFixed(2)}€</span>
                          <span>IVA: {rec.taxAmount?.toFixed(2)}€</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            window.dispatchEvent(new CustomEvent("print-ticket", {
                              detail: {
                                type: "bill",
                                title: rec.splitMethod === "completa" ? "Factura Simplificada" : "Pago Parcial (Ticket)",
                                tableName: rec.tableName,
                                items: rec.items,
                                subtotal: rec.subtotal,
                                taxAmount: rec.taxAmount,
                                total: rec.total,
                                timestamp: rec.timestamp,
                                ticketNumber: rec.id,
                                splitMethod: rec.splitMethod
                              }
                            }));
                            toast("Reenviando ticket del historial a la impresora...", "success");
                          }}
                          className="bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 text-[10px] font-black py-1 px-2.5 rounded-lg flex items-center space-x-1 cursor-pointer transition"
                        >
                          <Printer className="w-3 h-3" />
                          <span>Reimprimir</span>
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 6: GESTIÓN DE PERSONAL / USUARIOS */}
        {activeTab === "ticket-tpl" && ticketTpl && (
          <div className="space-y-6">
            <h2 className="text-lg font-black text-slate-800">Diseño de Ticket / Plantilla ZPL</h2>
            <p className="text-xs text-slate-500 leading-relaxed max-w-2xl bg-white p-3.5 rounded-xl border border-slate-200">
              Personaliza los textos y el tamaño del papel del ticket térmico. Los cambios se aplican automáticamente al ZPL que se envía a la impresora y reajustan las proporciones.
            </p>

            <form onSubmit={handleSaveTicketTpl} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
              <h3 className="text-xs font-black text-slate-700 uppercase tracking-widest mb-4">Textos del Ticket</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Nombre del negocio</label>
                  <input type="text" value={ticketTpl.businessName} onChange={e => setTicketTpl({...ticketTpl, businessName: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-xs text-slate-700 outline-none focus:border-indigo-400 focus:bg-white" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Cabecera ticket cliente</label>
                  <input type="text" value={ticketTpl.headerTitle} onChange={e => setTicketTpl({...ticketTpl, headerTitle: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-xs text-slate-700 outline-none focus:border-indigo-400 focus:bg-white" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Cabecera comanda cocina</label>
                  <input type="text" value={ticketTpl.kitchenHeader} onChange={e => setTicketTpl({...ticketTpl, kitchenHeader: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-xs text-slate-700 outline-none focus:border-indigo-400 focus:bg-white" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Footer comanda cocina</label>
                  <input type="text" value={ticketTpl.kitchenFooter} onChange={e => setTicketTpl({...ticketTpl, kitchenFooter: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-xs text-slate-700 outline-none focus:border-indigo-400 focus:bg-white" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Texto agradecimiento</label>
                  <input type="text" value={ticketTpl.footerThanks} onChange={e => setTicketTpl({...ticketTpl, footerThanks: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-xs text-slate-700 outline-none focus:border-indigo-400 focus:bg-white" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">URL / Pie de página</label>
                  <input type="text" value={ticketTpl.footerUrl} onChange={e => setTicketTpl({...ticketTpl, footerUrl: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-xs text-slate-700 outline-none focus:border-indigo-400 focus:bg-white" />
                </div>
              </div>

              <h3 className="text-xs font-black text-slate-700 uppercase tracking-widest mb-4 mt-6">Etiquetas de columnas</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">CANT</label>
                  <input type="text" value={ticketTpl.labelCant} onChange={e => setTicketTpl({...ticketTpl, labelCant: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-xs text-slate-700 outline-none focus:border-indigo-400 focus:bg-white" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">DESCRIPCION</label>
                  <input type="text" value={ticketTpl.labelDescripcion} onChange={e => setTicketTpl({...ticketTpl, labelDescripcion: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-xs text-slate-700 outline-none focus:border-indigo-400 focus:bg-white" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">TOTAL</label>
                  <input type="text" value={ticketTpl.labelTotal} onChange={e => setTicketTpl({...ticketTpl, labelTotal: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-xs text-slate-700 outline-none focus:border-indigo-400 focus:bg-white" />
                </div>
              </div>

              <h3 className="text-xs font-black text-slate-700 uppercase tracking-widest mb-4 mt-6">Etiquetas de información</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Factura</label>
                  <input type="text" value={ticketTpl.labelFactura} onChange={e => setTicketTpl({...ticketTpl, labelFactura: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-xs text-slate-700 outline-none focus:border-indigo-400 focus:bg-white" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Mesa</label>
                  <input type="text" value={ticketTpl.labelMesa} onChange={e => setTicketTpl({...ticketTpl, labelMesa: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-xs text-slate-700 outline-none focus:border-indigo-400 focus:bg-white" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Ticket #</label>
                  <input type="text" value={ticketTpl.labelTicket} onChange={e => setTicketTpl({...ticketTpl, labelTicket: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-xs text-slate-700 outline-none focus:border-indigo-400 focus:bg-white" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Metodo Pago</label>
                  <input type="text" value={ticketTpl.labelMetodoPago} onChange={e => setTicketTpl({...ticketTpl, labelMetodoPago: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-xs text-slate-700 outline-none focus:border-indigo-400 focus:bg-white" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Subtotal</label>
                  <input type="text" value={ticketTpl.labelSubtotal} onChange={e => setTicketTpl({...ticketTpl, labelSubtotal: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-xs text-slate-700 outline-none focus:border-indigo-400 focus:bg-white" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">IVA</label>
                  <input type="text" value={ticketTpl.labelIva} onChange={e => setTicketTpl({...ticketTpl, labelIva: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-xs text-slate-700 outline-none focus:border-indigo-400 focus:bg-white" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">TOTAL (final)</label>
                  <input type="text" value={ticketTpl.labelTotalFinal} onChange={e => setTicketTpl({...ticketTpl, labelTotalFinal: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-xs text-slate-700 outline-none focus:border-indigo-400 focus:bg-white" />
                </div>
              </div>

              <h3 className="text-xs font-black text-slate-700 uppercase tracking-widest mb-4 mt-6">Tamaño del papel (etiqueta)</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xs">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Ancho (cm)</label>
                  <input type="number" step="0.01" value={ticketTpl.paperWidth} onChange={e => setTicketTpl({...ticketTpl, paperWidth: parseFloat(e.target.value) || 10.45})} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-xs text-slate-700 outline-none focus:border-indigo-400 focus:bg-white" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Alto (cm)</label>
                  <input type="number" step="0.01" value={ticketTpl.paperHeight} onChange={e => setTicketTpl({...ticketTpl, paperHeight: parseFloat(e.target.value) || 14.50})} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-xs text-slate-700 outline-none focus:border-indigo-400 focus:bg-white" />
                </div>
              </div>

              <div className="mt-6 flex justify-end">
                <button type="submit" disabled={tplSaving} className="bg-slate-950 hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-2.5 px-6 rounded-lg text-xs cursor-pointer transition">
                  {tplSaving ? "Guardando..." : "Guardar Plantilla"}
                </button>
              </div>
            </form>
          </div>
        )}

        {activeTab === "users" && (
          <div className="space-y-6">
            <h2 className="text-lg font-black text-slate-800">Gestión de Personal / Usuarios</h2>
            
            <p className="text-xs text-slate-500 leading-relaxed max-w-2xl bg-white p-3.5 rounded-xl border border-slate-200">
              💡 Registra las cuentas del personal. Sus permisos y accesos estarán determinados por el rol asignado. Los camareros, cocineros y baristas no tendrán acceso al panel de administración ni a los terminales de otros roles.
            </p>

            {/* Formulario Crear Usuario */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
              <h3 className="text-xs font-black text-slate-700 uppercase tracking-widest mb-3.5 flex items-center">
                <span>Registrar Nuevo Empleado</span>
              </h3>

              <form onSubmit={handleCreateUser} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4">
                <div className="sm:col-span-1">
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Nombre Completo</label>
                  <input
                    type="text"
                    value={newUserName}
                    onChange={(e) => setNewUserName(e.target.value)}
                    placeholder="Ej: Juan Pérez"
                    required
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-xs text-slate-700 outline-none focus:border-indigo-400 focus:bg-white"
                  />
                </div>

                <div className="sm:col-span-1">
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Nombre de Usuario (Login)</label>
                  <input
                    type="text"
                    value={newUserUsername}
                    onChange={(e) => setNewUserUsername(e.target.value)}
                    placeholder="Ej: juanp"
                    required
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-xs text-slate-700 outline-none focus:border-indigo-400 focus:bg-white"
                  />
                </div>

                <div className="sm:col-span-1">
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Contraseña</label>
                  <input
                    type="password"
                    value={newUserPassword}
                    onChange={(e) => setNewUserPassword(e.target.value)}
                    placeholder="Contraseña de acceso"
                    required
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-xs text-slate-700 outline-none focus:border-indigo-400 focus:bg-white"
                  />
                </div>

                <div className="sm:col-span-1">
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Rol de Acceso</label>
                  <select
                    value={newUserRole}
                    onChange={(e) => setNewUserRole(e.target.value)}
                    required
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-xs text-slate-700 outline-none focus:border-indigo-400 focus:bg-white"
                  >
                    <option value="camarero">🤵 Camarero</option>
                    <option value="cocina">🍳 Cocina</option>
                    <option value="bar">🍹 Barra</option>
                    <option value="admin">⚙️ Administrador</option>
                  </select>
                </div>

                <div className="sm:col-span-1 md:col-span-1 flex items-end">
                  <button
                    type="submit"
                    className="w-full bg-slate-900 hover:bg-indigo-600 text-white font-extrabold text-xs py-3 px-4 rounded-lg flex justify-center items-center space-x-1 cursor-pointer transition"
                  >
                    <PlusCircle className="w-4 h-4" />
                    <span>Dar de Alta</span>
                  </button>
                </div>
              </form>
            </div>

            {/* Listado de Personal */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
              <h3 className="text-xs font-black text-slate-700 uppercase tracking-widest mb-4 pb-3 border-b border-slate-100">
                <span>Personal Activo en GastroOS</span>
              </h3>
              
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="border-b border-slate-100 text-slate-500 uppercase tracking-wider text-[10px]">
                      <th className="pb-2.5 font-bold">Nombre</th>
                      <th className="pb-2.5 font-bold">Usuario</th>
                      <th className="pb-2.5 font-bold">Rol</th>
                      <th className="pb-2.5 font-bold text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 text-slate-700">
                    {users.map(u => {
                      const isRootAdmin = u.id === "usr-admin";
                      const roleLabel = u.role === "admin" ? "Administrador" : u.role === "camarero" ? "Camarero" : u.role === "cocina" ? "Cocina" : "Barra";
                      const roleColor = u.role === "admin" ? "bg-indigo-100 text-indigo-700 border-indigo-200" : u.role === "camarero" ? "bg-amber-100 text-amber-800 border-amber-200" : u.role === "cocina" ? "bg-red-100 text-red-700 border-red-200" : "bg-sky-100 text-sky-850 border-sky-200";

                      return (
                        <tr key={u.id} className="hover:bg-slate-50/50">
                          <td className="py-3 font-extrabold text-slate-900">{u.name}</td>
                          <td className="py-3 font-mono">{u.username}</td>
                          <td className="py-3">
                            <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${roleColor}`}>
                              {roleLabel}
                            </span>
                          </td>
                          <td className="py-3 text-right">
                            {!isRootAdmin ? (
                              <button
                                onClick={() => handleDeleteUser(u.id, u.name)}
                                className="p-1 px-2.5 min-h-[36px] rounded hover:bg-red-50 hover:border-red-200 text-slate-500 hover:text-red-600 transition cursor-pointer font-bold border border-transparent"
                              >
                                <Trash2 className="w-4 h-4 inline mr-1" />
                                <span>Eliminar</span>
                              </button>
                            ) : (
                              <span className="text-[10px] text-slate-400 font-mono">Protegido</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

      </main>

      {/* MODAL / FORM DE CATEGORIA */}
      <AnimatePresence>
        {isCatModalOpen && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="cat-modal-title">
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="bg-white rounded-2xl w-full max-w-sm p-5 shadow-2xl relative"
            >
              <h3 className="font-extrabold text-slate-900 text-sm mb-4" id="cat-modal-title">
                {editCategoryMode ? "Editar Categoría" : "Agregar Nueva Categoría"}
              </h3>

              <form onSubmit={handleSaveCategory} className="space-y-3.5 text-xs">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Nombre de la Categoría</label>
                  <input
                    type="text"
                    value={catName}
                    onChange={(e) => setCatName(e.target.value)}
                    placeholder="Ej: Carnes y Parrilla"
                    required
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-700 outline-none focus:border-indigo-400 focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Breve Descripción</label>
                  <textarea
                    rows={2}
                    value={catDesc}
                    onChange={(e) => setCatDesc(e.target.value)}
                    placeholder="Ej: Cortes especiales de ternera y cerdo..."
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-700 outline-none focus:border-indigo-400 focus:bg-white"
                  />
                </div>

                <div className="flex space-x-2 pt-3">
                  <button
                    type="button"
                    onClick={() => setIsCatModalOpen(false)}
                    data-close-modal
                    className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold py-2.5 rounded-lg text-center cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex-1 bg-slate-950 hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-2.5 rounded-lg text-center cursor-pointer"
                  >
                    {saving ? "Guardando..." : "Guardar"}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL / FORM DE PRODUCTO */}
      <AnimatePresence>
        {isProdModalOpen && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="prod-modal-title">
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="bg-white rounded-2xl w-full max-w-md p-5 shadow-2xl relative max-h-[90vh] overflow-y-auto"
            >
              <h3 className="font-extrabold text-slate-900 text-sm mb-4" id="prod-modal-title">
                {editProductMode ? "Editar Plato Cuidando los Alérgenos" : "Dar de Alta Plato o Bebida"}
              </h3>

              <form onSubmit={handleSaveProduct} className="space-y-4 text-xs">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Nombre Comercial</label>
                  <input
                    type="text"
                    value={prodName}
                    onChange={(e) => setProdName(e.target.value)}
                    placeholder="Ej: Hamburguesa de Atún Rojo"
                    required
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-700 outline-none focus:border-indigo-400 focus:bg-white"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">Categoría</label>
                    <select
                      value={prodCatId}
                      onChange={(e) => setProdCatId(e.target.value)}
                      required
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-700 outline-none focus:border-indigo-400 focus:bg-white"
                    >
                      {categories.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">Precio Público (€)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={prodPrice}
                      onChange={(e) => setProdPrice(e.target.value)}
                      placeholder="Ej: 14.90"
                      required
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-700 outline-none focus:border-indigo-400 focus:bg-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">Stock Inicial (Num o Ilimitado)</label>
                    <select
                      value={prodStock}
                      onChange={(e) => setProdStock(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-700 outline-none focus:border-indigo-400 focus:bg-white"
                    >
                      <option value="unlimited">Ilimitado/Consumo normal</option>
                      <option value="5">Últimas 5 raciones</option>
                      <option value="15">15 Raciones diarias</option>
                      <option value="30">30 raciones básicas</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">Tipo de IVA (%)</label>
                    <select
                      value={prodIva}
                      onChange={(e) => setProdIva(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-700 outline-none focus:border-indigo-400 focus:bg-white"
                    >
                      <option value="10">10% (Alimentación normal)</option>
                      <option value="21">21% (Bebidas alcohólicas)</option>
                      <option value="4">4% (Superreducido primario)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Visual Receta / Ingredientes</label>
                  <textarea
                    rows={2}
                    value={prodDesc}
                    onChange={(e) => setProdDesc(e.target.value)}
                    placeholder="Ej: Con rúcula fresca, salsa especial ahumada..."
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-700 outline-none focus:border-indigo-400 focus:bg-white"
                  />
                </div>

                {/* Selección de Alérgenos */}
                <div>
                  <span className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-tight mb-1.5">Presencia de Alérgenos obligatorios</span>
                  <div className="grid grid-cols-3 gap-2 bg-slate-50 p-2.5 rounded-lg border border-slate-150">
                    {AVAILABLE_ALLERGENS.map(al => {
                      const isChecked = prodAllergens.includes(al);
                      return (
                        <button
                          type="button"
                          key={al}
                          onClick={() => toggleAllergen(al)}
                          className={`p-1 text-[10px] font-semibold border rounded-md text-center hover:bg-slate-100 transition whitespace-nowrap capitalize ${
                            isChecked 
                              ? "bg-amber-100 text-amber-900 border-amber-300 font-bold" 
                              : "bg-white text-slate-500 border-slate-200"
                          }`}
                        >
                          {al}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex space-x-2 pt-3">
                  <button
                    type="button"
                    onClick={() => setIsProdModalOpen(false)}
                    data-close-modal
                    className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold py-2.5 rounded-lg text-center cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex-1 bg-slate-950 hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-2.5 rounded-lg text-center cursor-pointer"
                  >
                    {saving ? "Guardando..." : "Guardar Plato"}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
 
      {/* MODAL IMPORTAR CSV */}
      <AnimatePresence>
        {isImportModalOpen && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="import-modal-title">
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="bg-white rounded-2xl w-full max-w-md p-5 shadow-2xl relative max-h-[90vh] overflow-y-auto"
            >
              <h3 className="font-extrabold text-slate-900 text-sm mb-2" id="import-modal-title">
                📥 Importar Catálogo desde CSV
              </h3>
              <p className="text-[11px] text-slate-505 mb-4 leading-relaxed">
                Puedes importar múltiples platos y categorías en lote utilizando un archivo CSV. Las categorías que no existan se crearán automáticamente.
              </p>

              <div className="space-y-4 text-xs">
                {/* Botón descargar plantilla */}
                <div className="bg-indigo-50 border border-indigo-150 p-3 rounded-xl flex items-center justify-between">
                  <div>
                    <p className="font-bold text-indigo-900">Plantilla de Ejemplo CSV</p>
                    <p className="text-[10px] text-indigo-700 mt-0.5">Descarga el formato de ejemplo configurado para Excel.</p>
                  </div>
                  <button
                    type="button"
                    onClick={downloadSampleCSV}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-[10px] px-3 py-1.5 rounded-lg cursor-pointer transition whitespace-nowrap"
                  >
                    Descargar ejemplo.csv
                  </button>
                </div>

                {/* Modo de importación */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-505 mb-1.5">Modo de Importación</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setImportMode("append")}
                      className={`p-2.5 border rounded-xl font-bold transition text-center cursor-pointer ${
                        importMode === "append" 
                          ? "bg-slate-900 text-white border-slate-900 shadow-xs" 
                          : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      Añadir (Mantener carta actual)
                    </button>
                    <button
                      type="button"
                      onClick={() => setImportMode("replace")}
                      className={`p-2.5 border rounded-xl font-bold transition text-center cursor-pointer ${
                        importMode === "replace" 
                          ? "bg-red-50 text-red-700 border-red-200 shadow-xs" 
                          : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      Sobrescribir (Borrar carta actual)
                    </button>
                  </div>
                </div>

                {/* Subir archivo */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-550 mb-1">Seleccionar Archivo CSV</label>
                  <input
                    type="file"
                    accept=".csv"
                    onChange={handleCSVUpload}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-slate-707 outline-none focus:border-indigo-400 focus:bg-white cursor-pointer"
                  />
                </div>

                {/* Previsualización del lote */}
                {importItems.length > 0 && (
                  <div className="bg-emerald-50 border border-emerald-150 p-3 rounded-xl">
                    <p className="font-bold text-emerald-950">Previsualización del Lote</p>
                    <p className="text-[10px] text-emerald-700 mt-0.5">Se han detectado y validado {importItems.length} platos listos para insertar en el sistema.</p>
                  </div>
                )}

                {/* Acciones */}
                <div className="flex space-x-2 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => {
                      setIsImportModalOpen(false);
                      setImportItems([]);
                    }}
                    className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold py-2.5 rounded-lg text-center cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={importItems.length === 0 || saving}
                    onClick={handleCommitImport}
                    className="flex-1 bg-slate-950 hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-2.5 rounded-lg text-center cursor-pointer"
                  >
                    {saving ? "Importando..." : `Importar ${importItems.length > 0 ? `${importItems.length} platos` : ""}`}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
