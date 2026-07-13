/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { 
  motion, AnimatePresence 
} from "motion/react";
import { 
  Clock, CheckCircle, Table as TableIcon, DollarSign, Split, Info, Bell, X, Check, Users, ShoppingCart, Loader2, Printer, Trash, MessageSquare
} from "lucide-react";
import { useToast } from "./ToastProvider";
import ConfirmDialog from "./ConfirmDialog";
import { useConfirm } from "./useConfirm";
import { authHeaders } from "./api";
import { Table, Receipt, ReceiptLine, Order, OrderLine, OrderStatus, Product, WaiterCall } from "../types";

// Utilidades de feedback háptico y sonoro
const triggerHaptic = () => {
  if (typeof navigator !== "undefined" && navigator.vibrate) {
    try {
      navigator.vibrate([60, 40, 60]);
    } catch { /* ignore */ }
  }
};

const playNotificationSound = () => {
  if (typeof window === "undefined" || !("AudioContext" in window || "webkitAudioContext" in window)) return;
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = "sine";
    osc.frequency.setValueAtTime(2200, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1600, ctx.currentTime + 0.35);
    
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch (err) {
    console.warn("AudioContext error:", err);
  }
};

export default function CamareroView() {
  const [tables, setTables] = useState<Table[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [waiterCalls, setWaiterCalls] = useState<WaiterCall[]>([]);
  const [prevCallsCount, setPrevCallsCount] = useState(0);
  const [selectedTable, setSelectedTable] = useState<Table | null>(null);
  const [activeBill, setActiveBill] = useState<any | null>(null);
  const [loadingBill, setLoadingBill] = useState(false);
  const [editingItemNote, setEditingItemNote] = useState<{ item: any; notes: string } | null>(null);
  
  // Controles de división de cuenta
  const [isSplitOpen, setIsSplitOpen] = useState(false);
  const [splitMethod, setSplitMethod] = useState<"completa" | "partes_iguales" | "por_lineas">("completa");
  const [dinersCount, setDinersCount] = useState<number>(2);
  const [selectedSplitLineIds, setSelectedSplitLineIds] = useState<{ [key: string]: number }>({}); // Clave line key, Valor cantidad a pagar

  // Vista de mesas: "mapa" (posición personalizada) o "grid" (cuadrícula)
  const [tableViewMode, setTableViewMode] = useState<"mapa" | "grid">("mapa");

  // Resumen de ventas
  const [salesSummary, setSalesSummary] = useState<any[] | null>(null);
  const [showSalesSummary, setShowSalesSummary] = useState(false);

  // Modificar ticket cerrado con auth admin
  const [modifyTicketMode, setModifyTicketMode] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [adminAuthError, setAdminAuthError] = useState("");
  const [authSuccess, setAuthSuccess] = useState(false);
  const [closedTickets, setClosedTickets] = useState<any[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<any | null>(null);
  const [ticketEditItems, setTicketEditItems] = useState<any[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [showProductPicker, setShowProductPicker] = useState(false);

  // Notificación de comidas preparadas pendientes de servir
  const [readyOrders, setReadyOrders] = useState<Order[]>([]);
  const [prevReadyCount, setPrevReadyCount] = useState(0);
  const [pushBanner, setPushBanner] = useState<{ msg: string; type: "info" | "success" | "warning" } | null>(null);
  const [closingBill, setClosingBill] = useState(false);
  const { toast } = useToast();
  const { confirm, dialogProps: confirmDialogProps } = useConfirm();

  useEffect(() => {
    fetchTablesAndOrders();
    const interval = setInterval(fetchTablesAndOrders, 5000);
    return () => clearInterval(interval);
  }, []);

  // Push notification cuando llegan nuevos platos listos
  useEffect(() => {
    if (readyOrders.length > prevReadyCount && prevReadyCount > 0) {
      const newOnes = readyOrders.slice(0, readyOrders.length - prevReadyCount);
      const names = newOnes.map(o => o.tableName).join(", ");
      setPushBanner({ msg: `🍽️ Nuevos platos listos: ${names}`, type: "success" });
      setTimeout(() => setPushBanner(null), 4000);
      triggerHaptic();
      playNotificationSound();
    }
    setPrevReadyCount(readyOrders.length);
  }, [readyOrders]);

  // Alerta de llamadas de mesas activas
  useEffect(() => {
    if (waiterCalls.length > prevCallsCount && prevCallsCount > 0) {
      triggerHaptic();
      playNotificationSound();
    }
    setPrevCallsCount(waiterCalls.length);
  }, [waiterCalls]);

  const fetchTablesAndOrders = async () => {
    try {
      const [resTab, resOrd, resCalls] = await Promise.all([
        fetch("/api/tables"),
        fetch("/api/orders"),
        fetch("/api/waiter-calls")
      ]);
      if (resTab.ok && resOrd.ok && resCalls.ok) {
        const tableList = await resTab.json();
        setTables(tableList);
        
        const orderList: Order[] = await resOrd.json();
        setOrders(orderList);

        const callsList = await resCalls.json();
        setWaiterCalls(callsList);

        // Desglose de órdenes preparadas / listas para servir
        const ready = orderList.filter(o => o.status === "listo");
        setReadyOrders(ready);
      }
    } catch (err) {
      console.error("Fallo obteniendo mesas y órdenes:", err);
    }
  };

  const handleResolveCall = async (callId: string) => {
    try {
      const res = await fetch(`/api/waiter-calls/${callId}/resolve`, {
        method: "PUT",
        headers: authHeaders()
      });
      if (res.ok) {
        setWaiterCalls(prev => prev.filter(c => c.id !== callId));
        toast("🛎️ Llamada atendida con éxito.", "success");
      } else {
        toast("Error al marcar llamada como atendida.", "error");
      }
    } catch (err) {
      console.error(err);
      toast("Error de red al atender la llamada.", "error");
    }
  };

  const handleDeleteItem = async (item: any) => {
    if (!selectedTable) return;
    const ok = await confirm({
      title: "Eliminar producto",
      message: `¿Estás seguro de que quieres eliminar ${item.quantity}x ${item.name} de la cuenta de la ${selectedTable.name}?`,
      okLabel: "Eliminar",
      cancelLabel: "Cancelar"
    });
    if (!ok) return;
    
    try {
      const res = await fetch(`/api/tables/${selectedTable.id}/bill/items`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders()
        },
        body: JSON.stringify({
          productId: item.productId,
          notes: item.notes || "",
          selectedExtras: item.selectedExtras || []
        })
      });
      if (res.ok) {
        toast("Producto eliminado con éxito.", "success");
        loadActiveBill(selectedTable);
        fetchTablesAndOrders();
      } else {
        toast("No se pudo eliminar el producto.", "error");
      }
    } catch (err) {
      console.error(err);
      toast("Error de red al eliminar el producto.", "error");
    }
  };

  const handleServeItem = async (item: any) => {
    if (!selectedTable) return;
    try {
      const res = await fetch(`/api/tables/${selectedTable.id}/bill/items/serve`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders()
        },
        body: JSON.stringify({
          productId: item.productId,
          notes: item.notes || "",
          selectedExtras: item.selectedExtras || []
        })
      });
      if (res.ok) {
        toast("Pedido marcado como servido.", "success");
        loadActiveBill(selectedTable);
        fetchTablesAndOrders();
      } else {
        toast("No se pudo marcar como servido.", "error");
      }
    } catch (err) {
      console.error(err);
      toast("Error de red al marcar como servido.", "error");
    }
  };

  const handleStartEditNote = (item: any) => {
    setEditingItemNote({
      item,
      notes: item.notes || ""
    });
  };

  const handleSaveItemNote = async () => {
    if (!selectedTable || !editingItemNote) return;
    try {
      const res = await fetch(`/api/tables/${selectedTable.id}/bill/items/note`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders()
        },
        body: JSON.stringify({
          productId: editingItemNote.item.productId,
          oldNotes: editingItemNote.item.notes || "",
          selectedExtras: editingItemNote.item.selectedExtras || [],
          newNotes: editingItemNote.notes
        })
      });
      if (res.ok) {
        toast("Nota actualizada con éxito.", "success");
        setEditingItemNote(null);
        loadActiveBill(selectedTable);
      } else {
        toast("No se pudo actualizar la nota.", "error");
      }
    } catch (err) {
      console.error(err);
      toast("Error de red al actualizar la nota.", "error");
    }
  };

  const loadActiveBill = async (table: Table) => {
    setLoadingBill(true);
    setSelectedSplitLineIds({});
    try {
      const res = await fetch(`/api/tables/${table.id}/bill`);
      if (res.ok) {
        const bill = await res.json();
        setActiveBill(bill);
        setSelectedTable(table);
      }
    } catch (err) {
      console.error(err);
      toast("Error de comunicación con el servidor.", "error");
    } finally {
      setLoadingBill(false);
    }
  };

  const handleServeOrder = async (orderId: string) => {
    try {
      const res = await fetch(`/api/orders/${orderId}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "servido" })
      });
      if (res.ok) {
        fetchTablesAndOrders();
      }
    } catch (err) {
      console.error(err);
      toast("Error de comunicación con el servidor.", "error");
    }
  };

  // Modificar ticket cerrado con autenticación admin de un solo uso
  const handleAdminAuth = async () => {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: adminPassword })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setAuthSuccess(true);
          setAdminAuthError("");
        }
      } else {
        setAdminAuthError("Contraseña de administrador incorrecta");
      }
    } catch (err) {
      setAdminAuthError("Error de conexión");
    }
  };

  const selectTicketToEdit = (ticket: any) => {
    setSelectedTicket(ticket);
    setTicketEditItems(ticket.items ? ticket.items.map((i: any) => ({ ...i })) : []);
  };

  const updateTicketItem = (idx: number, field: string, value: any) => {
    setTicketEditItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  };

  const saveTicketChanges = async () => {
    if (!selectedTicket) return;
    const newTotal = ticketEditItems.reduce((sum: number, i: any) => {
      const total = i.priceUnit * i.quantity;
      return sum + (isNaN(total) ? 0 : total);
    }, 0);
    try {
      const res = await fetch(`/api/closed-receipts/${selectedTicket.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          items: ticketEditItems,
          total: parseFloat(newTotal.toFixed(2)),
          subtotal: parseFloat(newTotal.toFixed(2)),
          taxAmount: parseFloat((newTotal * 0.10).toFixed(2))
        })
      });
      if (res.ok) {
        setPushBanner({ msg: "✅ Ticket modificado correctamente", type: "success" });
        setTimeout(() => setPushBanner(null), 3000);
      } else {
        setAdminAuthError("Error al guardar cambios");
      }
    } catch (err) {
      console.error(err);
      toast("Error de comunicación con el servidor.", "error");
    }
  };

  const toggleSalesSummary = async () => {
    if (salesSummary) {
      setShowSalesSummary(!showSalesSummary);
      return;
    }
    try {
      const res = await fetch("/api/sales-by-table");
      if (res.ok) {
        const data = await res.json();
        setSalesSummary(data);
        setShowSalesSummary(true);
      }
    } catch (err) {
      console.error(err);
      toast("Error de comunicación con el servidor.", "error");
    }
  };

  const handlePrintTicket = () => {
    if (!selectedTable || !activeBill || !activeBill.items || activeBill.items.length === 0) {
      toast("No hay artículos en la cuenta para imprimir.", "warning");
      return;
    }
    window.dispatchEvent(new CustomEvent("print-ticket", {
      detail: {
        type: "bill",
        title: "Consulta de Mesa (Pre-factura)",
        tableName: selectedTable.name,
        items: activeBill.items,
        subtotal: activeBill.subtotal,
        taxAmount: activeBill.taxAmount,
        total: activeBill.total,
        timestamp: new Date().toISOString()
      }
    }));
    toast("Abriendo diálogo de impresión...", "success");
  };

  const handleCloseBill = async () => {
    if (!selectedTable) return;

    let payload: any = { splitMethod };

    // Si pagamos por líneas seleccionadas, construimos los items individuales correspondientes
    if (splitMethod === "por_lineas") {
      const customItemsToPay: any[] = [];
      Object.keys(selectedSplitLineIds).forEach(key => {
        const qtyToPay = selectedSplitLineIds[key];
        if (qtyToPay <= 0) return;

        // Buscar el item correspondiente en activeBill
        const item = activeBill.items.find(
          (i: any) => `${i.productId}-${i.notes}-${JSON.stringify(i.selectedExtras)}` === key
        );

        if (item) {
          customItemsToPay.push({
            productId: item.productId,
            name: item.name,
            quantity: qtyToPay,
            priceUnit: item.priceUnit,
            priceTotal: parseFloat((item.priceUnit * qtyToPay).toFixed(2)),
            notes: item.notes,
            selectedExtras: item.selectedExtras
          });
        }
      });

      if (customItemsToPay.length === 0) {
        toast("Selecciona al menos un artículo para cobrar por líneas.", "warning");
        return;
      }
      payload.customItems = customItemsToPay;
    } 
    // Si pagamos por partes iguales, calculamos el total correspondiente a una parte
    else if (splitMethod === "partes_iguales") {
      const totalPart = activeBill.total / dinersCount;
      payload.customItems = [
        {
          name: `Pago Fraccionado (1/${dinersCount} parte)`,
          quantity: 1,
          priceUnit: totalPart,
          priceTotal: totalPart
        }
      ];
    }

    setClosingBill(true);
    try {
      const res = await fetch(`/api/tables/${selectedTable.id}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const rData = await res.json();
        toast(`Factura cobrada: ${rData.receipt.total.toFixed(2)}€`, "success");
        
        // Disparar la impresión desde el navegador para el ticket cobrado
        if (rData.receipt && rData.receipt.items && rData.receipt.items.length > 0) {
          window.dispatchEvent(new CustomEvent("print-ticket", {
            detail: {
              type: "bill",
              title: rData.receipt.splitMethod === "completa" ? "Factura Simplificada" : "Pago Parcial (Ticket)",
              tableName: selectedTable.name,
              items: rData.receipt.items,
              subtotal: rData.receipt.subtotal,
              taxAmount: rData.receipt.taxAmount,
              total: rData.receipt.total,
              timestamp: rData.receipt.timestamp || new Date().toISOString(),
              ticketNumber: rData.receipt.id,
              splitMethod: rData.receipt.splitMethod
            }
          }));
        }

        setSelectedTable(null);
        setActiveBill(null);
        setIsSplitOpen(false);
        fetchTablesAndOrders();
      } else {
        toast("Error al procesar el pago.", "error");
      }
    } catch (err) {
      console.error(err);
      toast("Error de comunicación con el servidor.", "error");
    } finally {
      setClosingBill(false);
    }
  };

  // Ayudante para ajustar por líneas en la división manual
  const handleLineSplitQtyChange = (key: string, maxQty: number, delta: number) => {
    setSelectedSplitLineIds(prev => {
      const current = prev[key] || 0;
      const newVal = Math.max(0, Math.min(maxQty, current + delta));
      return { ...prev, [key]: newVal };
    });
  };

  const getSplitManualCost = () => {
    let sum = 0;
    Object.keys(selectedSplitLineIds).forEach(key => {
      const qty = selectedSplitLineIds[key];
      const item = activeBill?.items.find(
        (i: any) => `${i.productId}-${i.notes}-${JSON.stringify(i.selectedExtras)}` === key
      );
      if (item && qty > 0) {
        sum += item.priceUnit * qty;
      }
    });
    return sum;
  };

  return (
    <div className="min-h-screen bg-slate-100 p-3 md:p-4 pb-24 font-sans" id="camarero_root">
      
      {/* Push Banner */}
      {pushBanner && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-xl shadow-2xl text-xs font-bold border max-w-xs animate-bounce ${
          pushBanner.type === "success" ? "bg-emerald-600 text-white border-emerald-700" :
          pushBanner.type === "warning" ? "bg-amber-500 text-white border-amber-600" :
          "bg-indigo-600 text-white border-indigo-700"
        }`}>
          {pushBanner.msg}
        </div>
      )}

      {/* TÍTULO */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <span className="text-[10px] font-mono text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full font-bold tracking-wider uppercase">Operativa diaria de sala</span>
          <h1 className="text-xl font-black text-slate-800 tracking-tight mt-0.5 flex items-center space-x-1">
            <span>🤵 Panel de Camareros</span>
          </h1>
        </div>
        <button
          onClick={async () => {
            try {
              const res = await fetch("/api/closed-receipts");
              if (res.ok) {
                const all = await res.json();
                setClosedTickets(all);
                setModifyTicketMode(true);
                setAdminPassword("");
                setAdminAuthError("");
                setAuthSuccess(false);
                setSelectedTicket(null);
              }
            } catch (err) { console.error(err); toast("Error de comunicación con el servidor.", "error"); }
          }}
          className="text-[11px] bg-indigo-100 hover:bg-indigo-200 text-indigo-700 font-bold px-3 py-2 rounded-xl border border-indigo-200 cursor-pointer transition flex items-center space-x-1"
        >
          <span>✏️</span>
          <span>Modificar Tickets</span>
        </button>
      </div>

      {/* SECCIÓN DE LLAMADAS ACTIVAS DE MESAS */}
      <AnimatePresence>
        {waiterCalls.length > 0 && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mb-4 bg-amber-50 border border-amber-200 rounded-2xl p-4 shadow-xs"
            id="waiter_calls_banner"
          >
            <h2 className="text-xs font-black text-amber-800 uppercase tracking-wider mb-2.5 flex items-center space-x-1.5 animate-pulse">
              <span>🛎️</span>
              <span>Llamadas de Clientes Activas ({waiterCalls.length})</span>
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {waiterCalls.map(call => {
                const reasonText = 
                  call.reason === "cuenta" ? "Pide la Cuenta 🧾" :
                  call.reason === "ayuda" ? "Solicita Ayuda 🙋‍♂️" :
                  call.reason === "cubiertos" ? "Necesita Cubiertos 🍴" :
                  call.reason === "limpieza" ? "Pide Limpieza / Retirar 🧼" :
                  "Tiene una Duda 📖";
                return (
                  <motion.div 
                    layout
                    key={call.id} 
                    className="bg-white border border-amber-200 rounded-xl p-3 flex flex-col justify-between shadow-xxs"
                  >
                    <div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-black bg-amber-500 text-slate-950 px-2 py-0.5 rounded">
                          {call.tableName}
                        </span>
                        <span className="text-[9px] text-slate-400 font-mono">
                          {new Date(call.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-xs font-bold text-slate-800 mt-2">{reasonText}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleResolveCall(call.id)}
                      className="w-full mt-3 bg-slate-950 hover:bg-emerald-600 text-white font-bold py-1.5 rounded-lg text-[10px] uppercase transition cursor-pointer min-h-[30px]"
                    >
                      Atender
                    </button>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        
        {/* COLUMNA 1: MESAS SQUAD (2/3 de pantalla en desktop) */}
        <div className="lg:col-span-2 space-y-3">
          <div className="bg-white p-4 rounded-2xl border border-slate-200">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-black text-slate-700 uppercase tracking-wider flex items-center space-x-1.5">
                <TableIcon className="w-4 h-4 text-indigo-600" />
                <span>Salón</span>
              </h2>
              <div className="flex bg-slate-100 p-0.5 rounded-lg text-[11px] font-bold">
                <button
                  onClick={() => setTableViewMode("mapa")}
                  className={`px-2.5 py-1 rounded-md cursor-pointer transition ${tableViewMode === "mapa" ? "bg-white text-slate-900 shadow-xs" : "text-slate-500 hover:text-slate-700"}`}
                >
                  🗺 Mapa
                </button>
                <button
                  onClick={() => setTableViewMode("grid")}
                  className={`px-2.5 py-1 rounded-md cursor-pointer transition ${tableViewMode === "grid" ? "bg-white text-slate-900 shadow-xs" : "text-slate-500 hover:text-slate-700"}`}
                >
                  📋 Parrilla
                </button>
              </div>
            </div>

            {tableViewMode === "mapa" ? (
              <div className="bg-slate-50 border border-slate-200 rounded-xl overflow-auto touch-pan-x touch-pan-y" style={{ minHeight: 300 }}>
                <div className="relative mx-auto" style={{ width: 900, height: 450, minWidth: 800 }}>
                  {tables.map(table => {
                    const isFree = table.status === "libre";
                    const isOccupied = table.status === "ocupada";
                    const isPending = table.status === "pendiente_pago";
                    const hasCall = waiterCalls.some(c => c.tableId === String(table.number) || c.tableId === table.id);

                    const bgColor = hasCall
                      ? "bg-amber-400 border-amber-500 animate-pulse hover:bg-amber-500"
                      : isFree
                      ? "bg-emerald-50 border-emerald-200 hover:bg-emerald-100"
                      : isOccupied
                      ? "bg-amber-50 border-amber-200 hover:bg-amber-100"
                      : "bg-sky-50 border-sky-200 hover:bg-sky-100";

                    const statusColor = hasCall
                      ? "bg-red-600 text-white font-extrabold"
                      : isFree
                      ? "bg-emerald-200 text-emerald-800"
                      : isOccupied
                      ? "bg-amber-200 text-amber-800"
                      : "bg-sky-200 text-sky-800";

                    return (
                      <button
                        key={table.id}
                        onClick={() => loadActiveBill(table)}
                        className={`absolute select-none ${bgColor} border-2 rounded-2xl cursor-pointer active:scale-95 transition-all duration-150`}
                        style={{
                          left: table.posX,
                          top: table.posY,
                          width: 130,
                          height: 90
                        }}
                      >
                        {hasCall && (
                          <span className="absolute -top-2.5 -right-2.5 bg-red-600 border border-white text-white text-[10px] w-6 h-6 rounded-full flex items-center justify-center font-bold shadow-md animate-bounce z-10">
                            🛎️
                          </span>
                        )}
                        <div className="flex flex-col items-center justify-center h-full p-1">
                          <span className={`text-xs font-mono font-bold ${hasCall ? "text-amber-950" : "text-slate-500"}`}>#{table.number}</span>
                          <span className={`font-extrabold text-xs text-center leading-tight ${hasCall ? "text-slate-950" : "text-slate-800"}`}>{table.name}</span>
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded mt-0.5 ${statusColor}`}>
                            {hasCall ? "LLAMADA" : isFree ? "Libre" : isOccupied ? `${table.currentBillTotal.toFixed(1)}€` : "Pago"}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" id="waiter_tables_grid">
                {tables.map(table => {
                  const isFree = table.status === "libre";
                  const isOccupied = table.status === "ocupada";
                  const isPending = table.status === "pendiente_pago";
                  const hasCall = waiterCalls.some(c => c.tableId === String(table.number) || c.tableId === table.id);

                  const borderClass = hasCall
                    ? "bg-amber-400 border-amber-500 animate-pulse hover:bg-amber-500"
                    : isFree
                    ? "bg-emerald-50/70 hover:bg-emerald-100 border-emerald-200 hover:border-emerald-300"
                    : isOccupied
                    ? "bg-amber-50 hover:bg-amber-100 border-amber-200 hover:border-amber-300"
                    : "bg-sky-50 hover:bg-sky-100 border-sky-200 hover:border-sky-300";

                  const statusBadge = hasCall
                    ? "bg-red-600 text-white font-extrabold"
                    : isFree
                    ? "bg-emerald-200 text-emerald-800"
                    : isOccupied
                    ? "bg-amber-200 text-amber-800"
                    : "bg-sky-200 text-sky-800";

                  return (
                    <button
                      key={table.id}
                      onClick={() => loadActiveBill(table)}
                      className={`min-h-[44px] p-3 rounded-xl text-left border flex flex-col justify-between h-24 relative cursor-pointer active:scale-95 transition duration-150 ${borderClass}`}
                      id={`table_button_${table.id}`}
                    >
                      {hasCall && (
                        <span className="absolute -top-2 -right-2 bg-red-600 border border-white text-white text-[10px] w-6.5 h-6.5 rounded-full flex items-center justify-center font-bold shadow-md animate-bounce z-10">
                          🛎️
                        </span>
                      )}
                      <div>
                        <span className={`text-[11px] font-mono font-bold ${hasCall ? "text-amber-950" : "text-slate-500"}`}>#{table.number}</span>
                        <h4 className={`font-extrabold text-sm mt-0.5 ${hasCall ? "text-slate-950" : "text-slate-800"}`}>{table.name}</h4>
                      </div>

                      <div className="flex justify-between items-end w-full">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded leading-none ${statusBadge}`}>
                          {hasCall ? "Llamada" : isFree ? "Libre" : isOccupied ? "Ocupada" : "Plato listo"}
                        </span>

                        {!isFree && (
                          <span className={`font-extrabold text-xs mt-1 block ${hasCall ? "text-slate-950" : "text-slate-900"}`}>
                            {table.currentBillTotal.toFixed(2)}€
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* RESUMEN DE VENTAS */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200">
            <button
              onClick={toggleSalesSummary}
              className="w-full flex items-center justify-between text-xs font-black text-slate-700 uppercase tracking-wider cursor-pointer"
            >
              <span>📊 Resumen de Ventas por Mesa</span>
              <span className="text-slate-500">{showSalesSummary ? "▲" : "▼"}</span>
            </button>
            {showSalesSummary && salesSummary && (
              <div className="mt-4 divide-y divide-slate-100 max-h-48 overflow-y-auto">
                {salesSummary.length === 0 ? (
                  <p className="py-3 text-xs text-slate-500 text-center">Sin datos</p>
                ) : (
                  salesSummary.map((t: any, i: number) => (
                    <div key={i} className="flex justify-between items-center py-2 text-xs">
                      <span className="font-bold text-slate-800">{t.tableName}</span>
                      <div className="flex items-center space-x-3">
                        <span className="text-slate-500 text-[10px]">{t.ticketCount} tickets</span>
                        <span className="font-extrabold text-slate-900">{t.totalSales.toFixed(2)}€</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* COMANDAS PREPARADAS FEED */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200">
            <h2 className="text-xs font-black text-slate-700 uppercase tracking-wider mb-2.5 flex items-center space-x-1.5">
              <Bell className="w-4 h-4 text-indigo-600 animate-pulse" />
              <span>Platos listos para Servir ({readyOrders.length})</span>
            </h2>

            {readyOrders.length === 0 ? (
              <div className="text-center py-8 bg-slate-50 border border-dashed border-slate-200 rounded-xl">
                <p className="text-xs text-slate-500">No hay platos pendientes de entrega por los camareros.</p>
              </div>
            ) : (
              <div className="space-y-3" id="ready_orders_feed">
                {readyOrders.map(order => (
                  <div 
                    key={order.id} 
                    className="p-3.5 bg-emerald-50/50 border border-emerald-100 rounded-xl flex items-center justify-between"
                  >
                    <div>
                      <span className="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded font-black uppercase">
                        {order.tableName}
                      </span>
                      <div className="text-xs font-bold text-slate-800 mt-1 space-y-0.5">
                        {order.items.map((l, li) => (
                          <p key={li} className="flex items-baseline">
                            <span className="text-emerald-600 font-black mr-1">{l.quantity}x</span>
                            <span>{l.name}</span>
                            {l.selectedExtras && l.selectedExtras.length > 0 && (
                              <span className="text-[10px] text-slate-500 ml-1 font-normal">
                                ({l.selectedExtras.map((e: any) => e.optionName).join(", ")})
                              </span>
                            )}
                          </p>
                        ))}
                      </div>
                      <p className="text-[10px] text-slate-500 font-mono">Pedido: #{order.id.slice(-6).toUpperCase()}</p>
                    </div>

                    <button
                      onClick={() => handleServeOrder(order.id)}
                      aria-label="Marcar como entregado"
                      className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3.5 py-3 rounded-lg flex items-center space-x-1 cursor-pointer transition"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Entregado</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* COLUMNA 2: DETALLES DE CUENTA SELECCIONADA */}
        <div className="lg:col-span-1">
          <AnimatePresence mode="wait">
            {!selectedTable ? (
              <div className="bg-white p-6 rounded-2xl border border-slate-200 text-center h-full flex flex-col justify-center items-center py-16">
                <TableIcon className="w-10 h-10 text-slate-300 mb-2.5" />
                <h3 className="text-xs font-bold text-slate-500">Selecciona una mesa en el mapa</h3>
                <p className="text-[11px] text-slate-500 mt-1">Para revisar consumos, dividir facturas y hacer el cobro de la cuenta.</p>
              </div>
            ) : (
              <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs flex flex-col h-full"
                id="selected_table_billing_card"
              >
                {/* Header mesa */}
                <div className="flex justify-between items-center pb-2 border-b border-slate-100 mb-3">
                  <div>
                    <h3 className="font-extrabold text-sm text-slate-900">{selectedTable.name}</h3>
                    <p className="text-[10px] text-slate-500">Estado: {selectedTable.status.toUpperCase()}</p>
                  </div>
                  <div className="flex items-center space-x-1.5">
                    <button
                      onClick={async () => {
                        try {
                          const res = await fetch("/api/closed-receipts");
                          if (res.ok) {
                            const all = await res.json();
                            const tableTickets = all.filter((r: any) => r.tableId === selectedTable?.id);
                            setClosedTickets(tableTickets);
                            setModifyTicketMode(true);
                            setAdminPassword("");
                            setAdminAuthError("");
                            setAuthSuccess(false);
                            setSelectedTicket(null);
                            // Cargar productos para poder añadir nuevos artículos
                            fetch("/api/products").then(r => r.ok ? r.json() : []).then(d => setProducts(Array.isArray(d) ? d : [])).catch(() => {});
                          }
                          } catch (err) { console.error(err); toast("Error de comunicación con el servidor.", "error"); }
                      }}
                      className="text-[10px] bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold px-2 py-1 rounded-lg border border-indigo-100 cursor-pointer transition"
                      title="Modificar tickets de esta mesa"
                    >
                      ✏️ Tickets
                    </button>
                    <button 
                      onClick={() => {
                        setSelectedTable(null);
                        setActiveBill(null);
                      }}
                      aria-label="Cerrar"
                      className="p-1 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {loadingBill ? (
                  <div className="py-12 flex justify-center items-center">
                    <Loader2 className="w-6 h-6 text-indigo-600 animate-spin" />
                  </div>
                ) : !activeBill || activeBill.items.length === 0 ? (
                  <div className="py-8 text-center text-slate-500">
                    <p className="text-xs">No hay consumiciones registradas bajo esta cuenta.</p>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col justify-between">
                    {/* Lista consumos */}
                    <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
                      {activeBill.items.map((item: any, idx: number) => {
                        const key = `${item.productId}-${item.notes}-${JSON.stringify(item.selectedExtras)}`;
                        const isSplitted = splitMethod === "por_lineas";
                        const splitQty = selectedSplitLineIds[key] || 0;

                        return (
                          <div key={idx} className="relative overflow-hidden border-b border-slate-100 pb-2 bg-slate-50 rounded-xl mb-1.5">
                            {/* Panel de acciones de fondo (Swipe para revelar) */}
                            <div className="absolute right-0 top-0 bottom-0 flex items-center pr-2 space-x-1 z-0">
                              <button
                                type="button"
                                onClick={() => handleServeItem(item)}
                                className="h-[84%] px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg flex items-center justify-center transition cursor-pointer"
                                title="Marcar como servido"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleStartEditNote(item)}
                                className="h-[84%] px-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg flex items-center justify-center transition cursor-pointer"
                                title="Editar nota"
                              >
                                <MessageSquare className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteItem(item)}
                                className="h-[84%] px-3 bg-rose-600 hover:bg-rose-700 text-white rounded-lg flex items-center justify-center transition cursor-pointer"
                                title="Eliminar ítem"
                              >
                                <Trash className="w-3.5 h-3.5" />
                              </button>
                            </div>

                            {/* Contenido deslizable en primer plano */}
                            <motion.div
                              drag="x"
                              dragConstraints={{ left: -140, right: 0 }}
                              dragElastic={{ left: 0.1, right: 0.3 }}
                              className="bg-white p-3 flex justify-between items-start text-xs relative z-10 w-full rounded-xl border border-slate-100 shadow-xxs"
                            >
                              <div className="flex-1 pr-2">
                                <p className="font-bold text-slate-800">{item.quantity}x {item.name}</p>
                                {item.notes && <p className="text-[10px] text-indigo-500 font-mono mt-0.5">Note: "{item.notes}"</p>}
                                {item.selectedExtras && item.selectedExtras.length > 0 && (
                                  <p className="text-[10px] text-slate-500">Extras: {item.selectedExtras.map((e: any) => e.optionName).join(", ")}</p>
                                )}
                              </div>

                              <div className="flex flex-col items-end">
                                <span className="font-bold text-slate-900">{item.priceTotal.toFixed(2)}€</span>
                                
                                {/* Controles de selección para pago por líneas */}
                                {isSplitted && (
                                  <div className="flex items-center space-x-1.5 mt-2 bg-slate-100 p-0.5 rounded-md">
                                    <button
                                      onClick={() => handleLineSplitQtyChange(key, item.quantity, -1)}
                                      aria-label="Reducir"
                                      className="w-8 h-8 sm:w-9 sm:h-9 bg-white rounded flex items-center justify-center text-[10px] font-bold active:scale-95 transition"
                                    >
                                      -
                                    </button>
                                    <span className="font-mono text-[10px] px-1">{splitQty}</span>
                                    <button
                                      onClick={() => handleLineSplitQtyChange(key, item.quantity, 1)}
                                      aria-label="Aumentar"
                                      className="w-8 h-8 sm:w-9 sm:h-9 bg-white rounded flex items-center justify-center text-[10px] font-bold active:scale-95 transition"
                                    >
                                      +
                                    </button>
                                  </div>
                                )}
                              </div>
                            </motion.div>
                          </div>
                        );
                      })}
                    </div>

                    {/* DIVISION DE CUENTA CONTROLES */}
                    <div className="mt-4 pt-4 border-t border-slate-100 bg-slate-50/50 p-3 rounded-xl border border-slate-100">
                      <div className="flex justify-between items-center mb-3">
                        <span className="text-[10px] font-extrabold text-slate-500 uppercase">Configuración de Cobro</span>
                        <button
                          onClick={() => setIsSplitOpen(!isSplitOpen)}
                          className="text-[11px] text-indigo-700 font-bold hover:underline cursor-pointer flex items-center space-x-1"
                        >
                          <Split className="w-3 h-3" />
                          <span>Dividir cuenta</span>
                        </button>
                      </div>

                      {/* Panel de divisiones */}
                      {isSplitOpen && (
                        <div className="space-y-3 pb-3 mb-2 border-b border-dashed border-slate-200">
                          <div className="grid grid-cols-3 gap-1.5">
                            {["completa", "partes_iguales", "por_lineas"].map((m) => (
                              <button
                                type="button"
                                key={m}
                                onClick={() => {
                                  setSplitMethod(m as any);
                                  setSelectedSplitLineIds({});
                                }}
                                className={`p-1.5 rounded-md text-[10px] font-extrabold text-center border uppercase ${
                                  splitMethod === m 
                                    ? "bg-slate-900 text-white border-slate-900" 
                                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                                }`}
                                id={`split_btn_${m}`}
                              >
                                {{completa: "Completa", partes_iguales: "Partes Iguales", por_lineas: "Por Líneas"}[m] || m}
                              </button>
                            ))}
                          </div>

                          {/* Ajustes partes iguales */}
                          {splitMethod === "partes_iguales" && (
                            <div className="flex items-center justify-between bg-white px-2.5 py-1.5 rounded-lg border border-slate-200">
                              <span className="text-xs text-slate-500">¿Cuántos pagadores?</span>
                              <div className="flex items-center space-x-1.5">
                                <button
                                  onClick={() => setDinersCount(Math.max(2, dinersCount - 1))}
                                  aria-label="Reducir"
                                  className="w-8 h-8 sm:w-9 sm:h-9 bg-slate-100 hover:bg-slate-200 font-bold text-xs rounded-full flex items-center justify-center active:scale-95 transition"
                                >
                                  -
                                </button>
                                <span className="font-bold text-xs text-slate-700 w-4 text-center">{dinersCount}</span>
                                <button
                                  onClick={() => setDinersCount(dinersCount + 1)}
                                  aria-label="Aumentar"
                                  className="w-8 h-8 sm:w-9 sm:h-9 bg-slate-100 hover:bg-slate-200 font-bold text-xs rounded-full flex items-center justify-center active:scale-95 transition"
                                >
                                  +
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Totales y cobro */}
                      <div className="space-y-1.5 pt-1 text-slate-700">
                        {splitMethod === "completa" ? (
                          <>
                            <div className="flex justify-between text-xs">
                              <span>Subtotal</span>
                              <span>{activeBill.subtotal.toFixed(2)}€</span>
                            </div>
                            <div className="flex justify-between text-xs text-slate-500">
                              <span>IVA incl.</span>
                              <span>{activeBill.taxAmount.toFixed(2)}€</span>
                            </div>
                            <div className="flex justify-between text-sm font-black text-slate-900 pt-1.5 border-t border-slate-100">
                              <span>A Cobrar (Total)</span>
                              <span>{activeBill.total.toFixed(2)}€</span>
                            </div>
                          </>
                        ) : splitMethod === "partes_iguales" ? (
                          <>
                            <div className="flex justify-between text-xs">
                              <span>Monto Total de Mesa</span>
                              <span>{activeBill.total.toFixed(2)}€</span>
                            </div>
                            <div className="flex justify-between text-sm font-black text-indigo-700 pt-1.5 border-t border-slate-100">
                              <span>A Cobrar (1 de {dinersCount})</span>
                              <span>{(activeBill.total / dinersCount).toFixed(2)}€</span>
                            </div>
                            <p className="text-[10px] text-slate-500 italic mt-1 text-center">Se cobrará una parte parcial, reduciendo la fianza restante de la mesa.</p>
                          </>
                        ) : (
                          <>
                            <div className="flex justify-between text-xs">
                              <span>Líneas seleccionadas</span>
                              <span>{Object.values(selectedSplitLineIds).reduce((s: number, x: any) => s + Number(x || 0), 0)} ud</span>
                            </div>
                            <div className="flex justify-between text-sm font-black text-indigo-700 pt-1.5 border-t border-slate-100">
                              <span>A Cobrar (Parcial)</span>
                              <span>{getSplitManualCost().toFixed(2)}€</span>
                            </div>
                            <p className="text-[10px] text-slate-500 italic mt-1 text-center">Selecciona las unidades arriba para cobrarlas de forma independiente.</p>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Botón de cierre definitivo */}
                    <button
                      onClick={handleCloseBill}
                      disabled={closingBill}
                      className="w-full bg-slate-900 hover:bg-indigo-600 text-white text-xs font-bold py-3.5 px-4 rounded-xl shadow-md mt-4 cursor-pointer disabled:opacity-50 flex justify-center items-center space-x-1.5 active:scale-99 transition"
                      id="btn_waiter_close_bill"
                    >
                      {closingBill ? <Loader2 className="w-4 h-4 animate-spin" /> : <DollarSign className="w-4 h-4" />}
                      <span>
                        {closingBill ? "Procesando..." : splitMethod === "completa" ? "Cobrar Cuenta Completa" : "Cerrar Cobro Parcial"}
                      </span>
                    </button>

                    {/* Botón imprimir ticket manual */}
                    <button
                      onClick={handlePrintTicket}
                      className="w-full bg-white border-2 border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 text-slate-700 text-xs font-bold py-2.5 px-4 rounded-xl mt-2 cursor-pointer flex justify-center items-center space-x-1.5 active:scale-99 transition"
                      id="btn_print_ticket"
                    >
                      <Printer className="w-4 h-4" />
                      <span>Imprimir Ticket</span>
                    </button>

                    {/* Tickets ya cobrados en la sesión */}
                    {activeBill.closedReceipts && activeBill.closedReceipts.length > 0 && (
                      <div className="mt-5 pt-4 border-t border-slate-200">
                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">
                          🧾 Tickets Cobrados en esta Sesión ({activeBill.closedReceipts.length})
                        </span>
                        <div className="space-y-2 max-h-[160px] overflow-y-auto">
                          {activeBill.closedReceipts.map((rec: any) => (
                            <div key={rec.id} className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 flex justify-between items-center text-[11px]">
                              <div>
                                <span className="font-extrabold text-slate-700">Ticket Parcial #{rec.id.slice(-5).toUpperCase()}</span>
                                <p className="text-[9px] text-slate-500 font-mono">
                                  {new Date(rec.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} | {rec.items.length} items
                                </p>
                              </div>
                              <div className="flex items-center space-x-2 shrink-0">
                                <span className="font-mono font-black text-slate-900">{rec.total.toFixed(2)}€</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    window.dispatchEvent(new CustomEvent("print-ticket", {
                                      detail: {
                                        type: "bill",
                                        title: "Pago Parcial (Ticket)",
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
                                    toast("Reenviando ticket a la impresora...", "success");
                                  }}
                                  className="bg-white hover:bg-indigo-50 border border-slate-200 text-indigo-700 p-1.5 rounded-lg flex items-center justify-center cursor-pointer transition min-h-[30px]"
                                  title="Reimprimir Ticket"
                                >
                                  <Printer className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

      </div>

      {/* MODAL MODIFICAR TICKET CERRADO */}
      <AnimatePresence>
        {modifyTicketMode && (
          <div role="dialog" aria-modal="true" aria-labelledby="modify-ticket-title" className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl w-full max-w-md p-5 shadow-2xl max-h-[90vh] overflow-y-auto"
            >
              <h3 id="modify-ticket-title" className="font-extrabold text-slate-900 text-sm mb-4">✏️ Modificar Ticket Cerrado</h3>

              {!authSuccess ? (
                <>
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 mb-4">
                    Se requiere autorización de administrador para modificar tickets. Introduce la contraseña de admin (no queda almacenada).
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 mb-1">Contraseña de Administrador</label>
                      <input
                        type="password"
                        value={adminPassword}
                        onChange={(e) => setAdminPassword(e.target.value)}
                        placeholder="Contraseña admin..."
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-xs text-slate-700 focus:border-indigo-400"
                      />
                    </div>
                    {adminAuthError && <p className="text-red-500 text-[10px]">{adminAuthError}</p>}
                    <button
                      onClick={handleAdminAuth}
                      className="w-full bg-slate-900 hover:bg-indigo-600 text-white font-bold text-xs py-2.5 rounded-lg cursor-pointer transition"
                    >
                      Verificar y Acceder
                    </button>
                    <button
                      onClick={() => setModifyTicketMode(false)}
                      data-close-modal
                      className="w-full bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs py-2.5 rounded-lg cursor-pointer transition"
                    >
                      Cancelar
                    </button>
                  </div>
                </>
              ) : !selectedTicket ? (
                <>
                  <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-2.5 mb-4 font-bold">✅ Autorización correcta. Selecciona un ticket:</p>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {closedTickets.length === 0 ? (
                      <p className="text-xs text-slate-500 text-center py-4">No hay tickets cerrados para esta mesa.</p>
                    ) : (
                      closedTickets.slice().reverse().map((t: any) => (
                        <button
                          key={t.id}
                          onClick={() => selectTicketToEdit(t)}
                          className="w-full text-left p-3 rounded-xl border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 text-xs cursor-pointer transition"
                        >
                          <span className="font-bold text-slate-800">#{t.id.slice(-8).toUpperCase()}</span>
                          <span className="text-slate-500 ml-2">{new Date(t.timestamp).toLocaleString("es-ES")}</span>
                          <span className="float-right font-extrabold text-indigo-600">{t.total.toFixed(2)}€</span>
                        </button>
                      ))
                    )}
                  </div>
                  <button
                    onClick={() => { setModifyTicketMode(false); setAuthSuccess(false); }}
                    data-close-modal
                    className="w-full bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs py-2.5 rounded-lg mt-4 cursor-pointer transition"
                  >
                    Cancelar
                  </button>
                </>
              ) : (
                <>
                  <p className="text-xs text-slate-500 mb-2">Editando ticket #{selectedTicket.id.slice(-8).toUpperCase()} - {selectedTicket.tableName}</p>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto mb-2">
                    {ticketEditItems.map((item: any, idx: number) => (
                      <div key={idx} className="flex items-center space-x-1.5 text-xs border border-slate-200 rounded-lg p-1.5">
                        <span className="font-bold text-slate-500 min-w-[14px] text-[10px]">{idx + 1}.</span>
                        <input
                          value={item.name}
                          onChange={(e) => updateTicketItem(idx, "name", e.target.value)}
                          className="flex-1 bg-slate-50 border border-slate-200 rounded px-1 py-0.5 text-[10px]"
                        />
                        <input
                          type="number"
                          value={item.quantity}
                          onChange={(e) => updateTicketItem(idx, "quantity", parseInt(e.target.value) || 0)}
                          className="w-10 bg-slate-50 border border-slate-200 rounded px-1 py-0.5 text-[10px] text-center"
                        />
                        <input
                          type="number"
                          step="0.01"
                          value={item.priceUnit || item.priceTotal}
                          onChange={(e) => updateTicketItem(idx, "priceUnit", parseFloat(e.target.value) || 0)}
                          className="w-14 bg-slate-50 border border-slate-200 rounded px-1 py-0.5 text-[10px] text-right"
                        />
                        <span className="font-bold text-slate-700 w-12 text-right text-[10px]">
                          {((item.priceUnit || 0) * (item.quantity || 0)).toFixed(2)}€
                        </span>
                        <button
                          onClick={() => setTicketEditItems(prev => prev.filter((_, i) => i !== idx))}
                          className="text-red-400 hover:text-red-600 text-xs cursor-pointer"
                        >×</button>
                      </div>
                    ))}
                  </div>

                  {/* Selector rápido de productos */}
                  <div className="mb-2">
                    <button
                      onClick={() => setShowProductPicker(!showProductPicker)}
                      className="text-[10px] text-indigo-600 font-bold cursor-pointer hover:text-indigo-800"
                    >
                      {showProductPicker ? "▲ Ocultar productos" : "+ Añadir artículo de la carta"}
                    </button>
                    {showProductPicker && (
                      <div className="mt-1.5 grid grid-cols-2 gap-1 max-h-32 overflow-y-auto border border-slate-200 rounded-lg p-1.5 bg-slate-50">
                        {products.map((p: Product) => (
                          <button
                            key={p.id}
                            onClick={() => {
                              setTicketEditItems(prev => [...prev, { name: p.name, quantity: 1, priceUnit: p.price, priceTotal: p.price }]);
                              setShowProductPicker(false);
                            }}
                            className="text-[10px] text-left bg-white border border-slate-100 rounded px-1.5 py-1 hover:border-indigo-200 hover:bg-indigo-50 cursor-pointer transition"
                          >
                            <span className="font-bold text-slate-700 block truncate">{p.name}</span>
                            <span className="text-indigo-600">{p.price.toFixed(2)}€</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="text-right text-sm font-black text-slate-900 mb-2">
                    Total: {ticketEditItems.reduce((s: number, i: any) => s + ((i.priceUnit || 0) * (i.quantity || 0)), 0).toFixed(2)}€
                  </div>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => setSelectedTicket(null)}
                      className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs py-2 rounded-lg cursor-pointer transition"
                    >
                      Volver
                    </button>
                    <button
                      onClick={async () => {
                        await saveTicketChanges();
                        setPushBanner({ msg: "✅ Ticket guardado", type: "success" });
                        setTimeout(() => setPushBanner(null), 3000);
                      }}
                      className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs py-2 rounded-lg cursor-pointer transition"
                    >
                      💾 Guardar
                    </button>
                    <button
                      onClick={() => {
                        if (!selectedTicket || ticketEditItems.length === 0) return;
                        const total = ticketEditItems.reduce((s: number, i: any) => s + ((i.priceUnit || 0) * (i.quantity || 0)), 0);
                        
                        window.dispatchEvent(new CustomEvent("print-ticket", {
                          detail: {
                            type: "bill",
                            title: "Duplicado de Factura",
                            tableName: selectedTicket.tableName,
                            items: ticketEditItems,
                            subtotal: total,
                            taxAmount: total * 0.1,
                            total,
                            timestamp: new Date().toISOString(),
                            ticketNumber: selectedTicket.id
                          }
                        }));
                        
                        setPushBanner({ msg: "🖨️ Diálogo de reimpresión abierto", type: "success" });
                        setTimeout(() => setPushBanner(null), 3000);
                      }}
                      className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs py-2 rounded-lg cursor-pointer transition"
                    >
                      🖨️ Reimprimir
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL EDICIÓN RÁPIDA DE NOTA DE ITEM */}
      <AnimatePresence>
        {editingItemNote && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className="bg-white rounded-2xl p-5 max-w-sm w-full shadow-2xl relative"
            >
              <h3 className="font-extrabold text-slate-900 text-sm mb-3">📝 Editar nota del plato</h3>
              <p className="text-[11px] text-slate-500 mb-4">{editingItemNote.item.name}</p>
              <textarea
                value={editingItemNote.notes}
                onChange={e => setEditingItemNote({ ...editingItemNote, notes: e.target.value })}
                placeholder="Ej. Sin cebolla, extra picante..."
                className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-xs text-slate-700 outline-none focus:border-indigo-400 focus:bg-white mb-4"
                rows={3}
              />
              <div className="flex space-x-2 justify-end">
                <button
                  type="button"
                  onClick={() => setEditingItemNote(null)}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2 px-4 rounded-lg text-xs transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSaveItemNote}
                  className="bg-slate-950 hover:bg-indigo-650 text-white font-bold py-2 px-4 rounded-lg text-xs transition cursor-pointer"
                >
                  Guardar Nota
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmDialog {...confirmDialogProps} />
    </div>
  );
}
