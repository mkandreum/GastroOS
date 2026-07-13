/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { 
  motion, AnimatePresence 
} from "motion/react";
import { 
  UtensilsCrossed, Clock, Check, CookingPot, AlertCircle, FileText, Download, Copy, Play, RefreshCw, X, Printer, User
} from "lucide-react";
import { Order, OrderLine, OrderStatus, Table } from "../types";
import { useToast } from "./ToastProvider";
import { useSSE } from "./useSSE";

export default function ChefView() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [selectedZplOrder, setSelectedZplOrder] = useState<Order | null>(null);
  const [selectedZplText, setSelectedZplText] = useState("");
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [prevPendingCount, setPrevPendingCount] = useState(0);
  const [pushBanner, setPushBanner] = useState<string | null>(null);
  const { toast } = useToast();
  const [isHighContrast, setIsHighContrast] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Obtener el camarero asignado a una mesa, si lo hay
  const getAssignedWaiter = (tableId: string): string | null => {
    const table = tables.find(t => t.id === tableId);
    return table?.assignedWaiterName || null;
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => {
        setIsFullscreen(true);
      }).catch((err) => {
        console.warn(err);
      });
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  const ProgressRing = ({ timestamp }: { timestamp: string }) => {
    const { mins, secs } = getElapsed(timestamp);
    const totalSecs = mins * 60 + secs;
    const maxSecs = 720;
    const percentage = Math.min(100, (totalSecs / maxSecs) * 100);
    const radius = 14;
    const strokeWidth = 3;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference - (percentage / 100) * circumference;

    let color = isHighContrast ? "stroke-green-400" : "stroke-emerald-500";
    let textColor = isHighContrast ? "text-green-400 font-black" : "text-emerald-400";
    
    if (mins >= 12) {
      color = isHighContrast ? "stroke-red-500 animate-pulse" : "stroke-rose-600 animate-pulse";
      textColor = isHighContrast ? "text-red-500 font-extrabold animate-pulse" : "text-rose-500 font-extrabold animate-pulse";
    } else if (mins >= 5) {
      color = isHighContrast ? "stroke-yellow-400" : "stroke-amber-500";
      textColor = isHighContrast ? "text-yellow-400 font-bold" : "text-amber-400";
    }

    return (
      <div className="flex items-center space-x-1.5">
        <div className="relative w-8 h-8 flex items-center justify-center shrink-0">
          <svg className="w-full h-full transform -rotate-90">
            <circle
              cx="16"
              cy="16"
              r={radius}
              className={`${isHighContrast ? 'stroke-slate-900' : 'stroke-slate-800'} fill-transparent`}
              strokeWidth={strokeWidth}
            />
            <circle
              cx="16"
              cy="16"
              r={radius}
              className={`${color} fill-transparent transition-all duration-300`}
              strokeWidth={strokeWidth}
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
            />
          </svg>
          <span className="absolute text-[8px] font-mono font-bold text-slate-350">
            {mins}m
          </span>
        </div>
        <span className={`text-[10px] font-mono ${textColor}`}>
          {mins > 0 ? `${mins}m ${secs}s` : `${secs}s`}
        </span>
      </div>
    );
  };

  const handlePrintKitchenComanda = (order: Order) => {
    const kitchenItems = order.items.filter(i => i.destination === "cocina");
    if (kitchenItems.length === 0) {
      toast("No hay artículos de cocina en este pedido.", "warning");
      return;
    }
    window.dispatchEvent(new CustomEvent("print-ticket", {
      detail: {
        type: "kitchen",
        title: "Comanda de Cocina",
        tableName: order.tableName,
        items: kitchenItems,
        timestamp: order.timestamp || new Date().toISOString(),
        ticketNumber: order.id
      }
    }));
    toast("Abriendo diálogo de impresión...", "success");
  };

  const getElapsed = (timestamp: string) => {
    const diff = Date.now() - new Date(timestamp).getTime();
    const mins = Math.floor(diff / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    return { mins, secs, totalMs: diff };
  };

  const getTimeColor = (timestamp: string) => {
    const { mins } = getElapsed(timestamp);
    if (mins >= 15) return "border-red-500/50 bg-red-500/5";
    if (mins >= 10) return "border-amber-500/50 bg-amber-500/5";
    if (mins >= 5) return "border-yellow-500/30";
    return "border-slate-800";
  };

  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    fetchChefOrders();
    const interval = setInterval(fetchChefOrders, 4000);
    return () => clearInterval(interval);
  }, []);

  // SSE para eventos en tiempo real
  useSSE({
    "order:created": () => { fetchChefOrders(); },
    "order:status_changed": () => { fetchChefOrders(); },
    "tables_updated": () => { fetchChefOrders(); },
    "table:assigned": () => { fetchChefOrders(); },
    "table:unassigned": () => { fetchChefOrders(); }
  });

  useEffect(() => {
    const pending = orders.filter(o => o.status === "pendiente").length;
    if (pending > prevPendingCount && prevPendingCount > 0) {
      setPushBanner(`🔥 Nueva comanda entrante (${pending} pendientes)`);
      setTimeout(() => setPushBanner(null), 4000);
    }
    setPrevPendingCount(pending);
  }, [orders]);

  useEffect(() => {
    if ('wakeLock' in navigator) {
      navigator.wakeLock.request('screen').catch(() => {});
    }
  }, []);

  const fetchChefOrders = async () => {
    try {
      const [resOrd, resTab] = await Promise.all([
        fetch("/api/orders"),
        fetch("/api/tables")
      ]);
      if (resOrd.ok) {
        const list: Order[] = await resOrd.json();
        
        const chefFiltered = list.filter(o => 
          (o.status === "pendiente" || o.status === "en_preparacion" || o.status === "listo") &&
          o.items.some(line => line.destination === "cocina")
        );
        setOrders(chefFiltered);
      }
      if (resTab.ok) {
        setTables(await resTab.json());
      }
    } catch (err) {
      console.error(err);
      toast("Error al cargar pedidos de cocina.", "error");
    }
  };

  const handleUpdateStatus = async (orderId: string, nextStatus: OrderStatus) => {
    try {
      const res = await fetch(`/api/orders/${orderId}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus })
      });
      if (res.ok) {
        fetchChefOrders();
      }
    } catch (err) {
      console.error(err);
      toast("Error al actualizar estado del pedido.", "error");
    }
  };

  const loadZplDetails = async (order: Order) => {
    try {
      const logsRes = await fetch("/api/print-logs");
      if (logsRes.ok) {
        const logs = await logsRes.json();
        const found = logs.find((l: any) => l.orderId === order.id);
        if (found) {
          setSelectedZplText(found.zpl);
          setSelectedZplOrder(order);
        } else {
          // Si no hay log aún, generamos uno local ficticio o simulado basado en el endpoint anterior
          toast("El ZPL aún se está procesando en la cola.", "warning");
        }
      }
    } catch (err) {
      console.error(err);
      toast("Error al cargar ZPL.", "error");
    }
  };

  const handleCopyZpl = () => {
    navigator.clipboard.writeText(selectedZplText);
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 2000);
  };

  // Filtrar activos por estados
  const pendingOrders = orders.filter(o => o.status === "pendiente");
  const cookingOrders = orders.filter(o => o.status === "en_preparacion");
  const readyOrders = orders.filter(o => o.status === "listo");

  const rootBgClass = isHighContrast 
    ? "min-h-screen bg-black text-white p-4 md:p-6 pb-24 font-mono select-none border-8 border-yellow-400" 
    : "min-h-screen bg-slate-900 text-white p-4 md:p-6 pb-24 font-sans";

  return (
    <div className={rootBgClass} id="chef_root">
      
      {/* Push Banner */}
      {pushBanner && (
        <div className="fixed top-4 right-4 z-50 bg-rose-600 text-white px-4 py-3 rounded-xl shadow-2xl text-xs font-bold border border-rose-700 max-w-xs animate-bounce">
          {pushBanner}
        </div>
      )}

      {/* HEADER KDS */}
      <header className={`flex flex-col md:flex-row md:items-center justify-between border-b pb-5 mb-6 ${
        isHighContrast ? "border-yellow-400" : "border-slate-800"
      }`}>
        <div>
          <span className={`text-xs font-mono font-bold tracking-wider px-2.5 py-1 rounded-full uppercase ${
            isHighContrast ? "text-yellow-400 border border-yellow-400 bg-black" : "text-rose-500 bg-rose-500/10"
          }`}>KDS - Kitchen Display System</span>
          <h1 className="text-2xl font-black tracking-tight text-white mt-1.5 flex items-center col-span-2">
            <span>🍳 Terminal de Preparación de Cocina</span>
          </h1>
        </div>
        <div className="flex items-center space-x-3 mt-3 md:mt-0">
          {/* BOTONES DE CONTROL DE UI */}
          <button
            onClick={() => setIsHighContrast(!isHighContrast)}
            className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition cursor-pointer min-h-[38px] ${
              isHighContrast 
                ? "bg-yellow-400 text-black border-yellow-400 hover:bg-yellow-500" 
                : "bg-slate-800 text-white border-slate-700 hover:bg-slate-700"
            }`}
          >
            🌓 {isHighContrast ? "Contraste Estándar" : "Alto Contraste"}
          </button>
          <button
            onClick={toggleFullscreen}
            className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition cursor-pointer min-h-[38px] ${
              isHighContrast 
                ? "bg-black text-yellow-400 border-yellow-400 hover:bg-slate-900" 
                : "bg-slate-800 text-white border-slate-700 hover:bg-slate-700"
            }`}
          >
            🖥️ {isFullscreen ? "Salir Completo" : "Pantalla Completa"}
          </button>
          
          <span className={`text-xs border rounded-lg px-3 py-1.5 font-bold ${
            isHighContrast 
              ? "bg-black text-yellow-400 border-yellow-400" 
              : "bg-slate-800 border-slate-700 text-slate-300"
          }`}>
            Pendientes: {pendingOrders.length} | Preparando: {cookingOrders.length}
          </span>
        </div>
      </header>

      {/* KDS GRID (3 columnas de flujo) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" id="chef_kds_columns">
        
        {/* COLUMNA 1: PENDIENTES DE ENTRAR (Rojo/Amber) */}
        <div className="bg-slate-950/45 p-4 rounded-2xl border border-slate-800 flex flex-col min-h-[70vh]">
          <h2 className="text-xs font-black tracking-widest text-slate-400 uppercase mb-4 pb-2 border-b border-slate-800 flex justify-between items-center">
            <span>🔴 1. Por Preparar ({pendingOrders.length})</span>
            <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded">FUEGO</span>
          </h2>

          <div className="space-y-4 overflow-y-auto flex-1 max-h-[65vh]">
            <AnimatePresence mode="popLayout">
              {pendingOrders.length === 0 ? (
                <motion.div 
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="h-full flex flex-col justify-center items-center text-slate-600 py-16 text-center"
                >
                  <UtensilsCrossed className="w-8 h-8 opacity-20 mb-2" />
                  <p className="text-xs">No hay comandas entrantes</p>
                </motion.div>
              ) : (
                pendingOrders.map(order => (
                  <motion.div 
                    layout
                    initial={{ opacity: 0, y: 15, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -15, scale: 0.96 }}
                    transition={{ type: "spring", stiffness: 400, damping: 28 }}
                    key={order.id} 
                    className={`bg-slate-900 border ${getTimeColor(order.timestamp)} rounded-xl p-4 shadow-md hover:border-slate-700 transition`}
                    id={`kds_card_pending_${order.id}`}
                  >
                    <div className="flex justify-between items-start mb-2 pb-2 border-b border-slate-800">
                      <div>
                        <span className="text-xs bg-amber-500 text-slate-950 font-black px-2 py-0.5 rounded-md text-[11px]">
                          {order.tableName}
                        </span>
                        {(() => {
                          const waiterName = getAssignedWaiter(order.tableId);
                          return waiterName ? (
                            <span className="ml-1.5 text-[10px] bg-indigo-500 text-white font-bold px-1.5 py-0.5 rounded-md">
                              <User className="w-2.5 h-2.5 inline mr-0.5" />{waiterName}
                            </span>
                          ) : null;
                        })()}
                        <p className="text-[10px] font-mono text-slate-400 mt-1">ID: #{order.id.slice(-5).toUpperCase()}</p>
                      </div>

                      <div className="flex space-x-1.5 shrink-0">
                        <button
                          onClick={() => handlePrintKitchenComanda(order)}
                          className="text-slate-400 hover:text-white flex items-center space-x-1 border border-slate-800 hover:border-slate-700 rounded p-2.5 text-xs transition cursor-pointer min-h-[44px]"
                          title="Imprimir Comanda Cocina"
                          aria-label="Imprimir comanda del pedido"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          <span>Imprimir</span>
                        </button>
                        <button
                          onClick={() => loadZplDetails(order)}
                          className="text-slate-400 hover:text-white flex items-center space-x-1 border border-slate-800 hover:border-slate-700 rounded p-2.5 text-xs transition cursor-pointer min-h-[44px]"
                          title="Ver etiqueta ZPL"
                          aria-label="Ver código ZPL del pedido"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          <span>Ver ZPL</span>
                        </button>
                      </div>
                    </div>

                    {/* Líneas de plato (excluyendo bebidas ya que van a bar) */}
                    <div className="space-y-2 py-1">
                      {order.items.filter(i => i.destination === "cocina").map(line => (
                        <div key={line.id} className="text-sm">
                          <p className="font-extrabold text-white">
                            <span className="text-amber-400 font-black">{line.quantity}x</span> {line.name}
                          </p>
                          
                          {line.selectedExtras && line.selectedExtras.length > 0 && (
                            <p className="text-xs text-rose-400 font-medium ml-4">
                              + {line.selectedExtras.map((e: any) => e.optionName).join(", ")}
                            </p>
                          )}

                          {line.notes && (
                            <div className="mt-1 bg-amber-500/10 border border-amber-500/20 text-amber-300 p-1.5 rounded text-xs">
                              📝 "{line.notes}"
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Acciones */}
                    <div className="mt-4 pt-3 border-t border-slate-800 flex justify-between items-center text-xs text-slate-400">
                      <ProgressRing timestamp={order.timestamp} />
                      <button
                        onClick={() => handleUpdateStatus(order.id, "en_preparacion")}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-1.5 px-3 rounded-lg flex items-center space-x-1 transition cursor-pointer min-h-[44px]"
                        id={`btn_cook_${order.id}`}
                        aria-label="Pasar a preparación"
                      >
                        <CookingPot className="w-3.5 h-3.5" />
                        <span>Cocinar</span>
                      </button>
                    </div>
                  </motion.div>
                ))
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* COLUMNA 2: EN FUEGO / SE ESTÁ PREPARANDO (Indigo/Orange) */}
        <div className="bg-slate-950/45 p-4 rounded-2xl border border-slate-800 flex flex-col min-h-[70vh]">
          <h2 className="text-xs font-black tracking-widest text-slate-400 uppercase mb-4 pb-2 border-b border-slate-800 flex justify-between items-center">
            <span>🟡 2. En los Fogones ({cookingOrders.length})</span>
            <span className="text-[10px] bg-indigo-500/20 text-indigo-400 px-1.5 py-0.5 rounded animate-pulse">MARCHANDO</span>
          </h2>

          <div className="space-y-4 overflow-y-auto flex-1 max-h-[65vh]">
            <AnimatePresence mode="popLayout">
              {cookingOrders.length === 0 ? (
                <motion.div 
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="h-full flex flex-col justify-center items-center text-slate-600 py-16 text-center"
                >
                  <CookingPot className="w-8 h-8 opacity-20 mb-2" />
                  <p className="text-xs">No hay platos marchando actualmente</p>
                </motion.div>
              ) : (
                cookingOrders.map(order => (
                  <motion.div 
                    layout
                    initial={{ opacity: 0, y: 15, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -15, scale: 0.96 }}
                    transition={{ type: "spring", stiffness: 400, damping: 28 }}
                    key={order.id} 
                    className="bg-slate-900 border border-indigo-950/60 rounded-xl p-4 shadow-md border-l-4 border-l-amber-500"
                    id={`kds_card_cooking_${order.id}`}
                  >
                    <div className="flex justify-between items-start mb-2 pb-2 border-b border-slate-800">
                      <div>
                        <span className="text-xs bg-indigo-600 text-white font-black px-2 py-0.5 rounded-md text-[11px]">
                          {order.tableName}
                        </span>
                        {(() => {
                          const waiterName = getAssignedWaiter(order.tableId);
                          return waiterName ? (
                            <span className="ml-1.5 text-[10px] bg-indigo-500 text-white font-bold px-1.5 py-0.5 rounded-md">
                              <User className="w-2.5 h-2.5 inline mr-0.5" />{waiterName}
                            </span>
                          ) : null;
                        })()}
                        <p className="text-[10px] font-mono text-slate-400 mt-1">ID: #{order.id.slice(-5).toUpperCase()}</p>
                      </div>
                      
                      <button
                        onClick={() => loadZplDetails(order)}
                        className="text-slate-400 hover:text-white flex items-center space-x-1 border border-slate-800 hover:border-slate-700 rounded p-2.5 text-xs transition cursor-pointer min-h-[44px]"
                        aria-label="Ver código ZPL del pedido"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span>Ver ZPL</span>
                      </button>
                    </div>

                    {/* Listado */}
                    <div className="space-y-2 py-1">
                      {order.items.filter(i => i.destination === "cocina").map(line => (
                        <div key={line.id} className="text-sm">
                          <p className="font-extrabold text-white">
                            <span className="text-amber-400 font-black">{line.quantity}x</span> {line.name}
                          </p>
                          
                          {line.selectedExtras && line.selectedExtras.length > 0 && (
                            <p className="text-xs text-rose-400 font-medium ml-4">
                              + {line.selectedExtras.map((e: any) => e.optionName).join(", ")}
                            </p>
                          )}

                          {line.notes && (
                            <div className="mt-1 bg-amber-500/10 border border-amber-500/20 text-amber-300 p-1.5 rounded text-xs">
                              📝 "{line.notes}"
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Acciones */}
                    <div className="mt-4 pt-3 border-t border-slate-800 flex justify-between items-center text-xs">
                      <ProgressRing timestamp={order.timestamp} />
                      <button
                        onClick={() => handleUpdateStatus(order.id, "listo")}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-1.5 px-3 rounded-lg flex items-center space-x-1 transition cursor-pointer min-h-[44px]"
                        id={`btn_ready_${order.id}`}
                        aria-label="Marcar como listo"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Listo</span>
                      </button>
                    </div>
                  </motion.div>
                ))
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* COLUMNA 3: PREPARADOS/ESPERANDO SERVICIO (Verde/Gray) */}
        <div className="bg-slate-950/45 p-4 rounded-2xl border border-slate-800 flex flex-col min-h-[70vh]">
          <h2 className="text-xs font-black tracking-widest text-slate-400 uppercase mb-4 pb-2 border-b border-slate-800 flex justify-between items-center">
            <span>🟢 3. Listos en pase ({readyOrders.length})</span>
            <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded">PASE</span>
          </h2>

          <div className="space-y-4 overflow-y-auto flex-1 max-h-[65vh]">
            <AnimatePresence mode="popLayout">
              {readyOrders.length === 0 ? (
                <motion.div 
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="h-full flex flex-col justify-center items-center text-slate-600 py-16 text-center"
                >
                  <Check className="w-8 h-8 opacity-20 mb-2" />
                  <p className="text-xs">No hay entregas pendientes en pase</p>
                </motion.div>
              ) : (
                readyOrders.map(order => (
                  <motion.div 
                    layout
                    initial={{ opacity: 0, y: 15, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -15, scale: 0.96 }}
                    transition={{ type: "spring", stiffness: 400, damping: 28 }}
                    key={order.id} 
                    className="bg-slate-900 border border-emerald-950 rounded-xl p-4 opacity-75 shadow-sm"
                    id={`kds_card_ready_${order.id}`}
                  >
                    <div className="flex justify-between items-start mb-1 pb-1.5 border-b border-slate-800">
                      <span className="text-xs bg-emerald-600 text-white font-extrabold px-1.5 py-0.5 rounded">
                        {order.tableName}
                      </span>
                      {(() => {
                        const waiterName = getAssignedWaiter(order.tableId);
                        return waiterName ? (
                          <span className="ml-1.5 text-[10px] bg-indigo-500 text-white font-bold px-1.5 py-0.5 rounded">
                            <User className="w-2.5 h-2.5 inline mr-0.5" />{waiterName}
                          </span>
                        ) : null;
                      })()}
                      <span className="text-[10px] font-mono text-slate-500">#{order.id.slice(-5).toUpperCase()}</span>
                    </div>

                    <div className="space-y-1 text-xs text-slate-300 py-1.5">
                      {order.items.filter(i => i.destination === "cocina").map(line => (
                        <span key={line.id} className="block">• {line.quantity}x {line.name}</span>
                      ))}
                    </div>

                    <p className="text-[10px] text-emerald-400 font-bold flex items-center space-x-1 mt-1 pt-1.5 border-t border-slate-800/60">
                      <span>✓ Despachado, esperando camarero...</span>
                    </p>
                  </motion.div>
                ))
              )}
            </AnimatePresence>
          </div>
        </div>

      </div>

      {/* DIÁLOGO / MODAL DE DETALLE ZPL DE ETIQUETA */}
      <AnimatePresence>
        {selectedZplOrder && (
          <div className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="zpl-modal-title">
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              className="bg-slate-950 border border-slate-800 rounded-2xl w-full max-w-lg p-5 shadow-2xl relative"
              id="zpl_details_modal"
            >
              <div className="flex justify-between items-center border-b border-slate-800 pb-3 mb-4">
                <div>
                  <h3 className="font-extrabold text-sm text-white" id="zpl-modal-title">📄 Código de Impresión ZPL (Zebra)</h3>
                  <p className="text-[10px] text-slate-400">Comando crudo enviado a la cola de impresión de la comanda</p>
                </div>
                <button 
                  onClick={() => setSelectedZplOrder(null)}
                  className="p-2.5 rounded-full bg-slate-850 hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center"
                  data-close-modal
                  aria-label="Cerrar modal ZPL"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Contenedor del ZPL */}
              <div className="bg-slate-900 border border-slate-800 rounded-lg p-3.5 mb-4 my-2">
                <pre className="font-mono text-xs text-indigo-400 overflow-x-auto max-h-[250px] leading-relaxed whitespace-pre scrollbar-thin">
                  {selectedZplText}
                </pre>
              </div>

              {/* Botones de acción del ZPL */}
              <div className="flex items-center space-x-3">
                <button
                  onClick={handleCopyZpl}
                  className="flex-1 bg-slate-850 hover:bg-slate-800 text-white font-semibold text-xs py-2.5 rounded-lg flex items-center justify-center space-x-1.5 transition cursor-pointer min-h-[44px]"
                  id="btn_copy_zpl"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>{copyFeedback ? "¡Copiado!" : "Copiar ZPL"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const blob = new Blob([selectedZplText], { type: "text/plain" });
                    const link = document.createElement("a");
                    link.href = URL.createObjectURL(blob);
                    link.download = `comanda_zpl_${selectedZplOrder.tableName.replace(" ", "_")}.zpl`;
                    link.click();
                  }}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs py-2.5 px-4 rounded-lg flex items-center justify-center space-x-1 transition cursor-pointer min-h-[44px]"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Descargar</span>
                </button>
              </div>

            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
