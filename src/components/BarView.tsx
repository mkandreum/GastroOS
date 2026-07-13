/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { 
  motion, AnimatePresence 
} from "motion/react";
import { 
  Wine, GlassWater, Clock, Check, Coffee, Volume2, RefreshCw, Printer
} from "lucide-react";
import { Order, OrderLine, OrderStatus } from "../types";
import { useToast } from "./ToastProvider";

export default function BarView() {
  const [orders, setOrders] = useState<Order[]>([]);
  const { toast } = useToast();
  const [isHighContrast, setIsHighContrast] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [now, setNow] = useState(Date.now());

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
          <span className="absolute text-[8px] font-mono font-bold text-slate-355">
            {mins}m
          </span>
        </div>
        <span className={`text-[10px] font-mono ${textColor}`}>
          {mins > 0 ? `${mins}m ${secs}s` : `${secs}s`}
        </span>
      </div>
    );
  };
  const [prevCount, setPrevCount] = useState(0);

  const handlePrintBarComanda = (order: Order) => {
    const barItems = order.items.filter(line => line.destination === "bar");
    if (barItems.length === 0) {
      toast("No hay bebidas en este pedido.", "warning");
      return;
    }
    window.dispatchEvent(new CustomEvent("print-ticket", {
      detail: {
        type: "bar",
        title: "Comanda de Barra",
        tableName: order.tableName,
        items: barItems,
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
    const mins = getElapsed(timestamp).mins;
    if (mins >= 15) return "border-red-500/50";
    if (mins >= 10) return "border-amber-500/50";
    if (mins >= 5) return "border-yellow-500/30";
    return "";
  };

  useEffect(() => {
    fetchBarOrders();
    const interval = setInterval(fetchBarOrders, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if ('wakeLock' in navigator) {
      navigator.wakeLock.request('screen').catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (orders.length > prevCount && prevCount > 0) {
      toast("Nuevo pedido de bebidas recibido", "info");
    }
    setPrevCount(orders.length);
  }, [orders]);

  const fetchBarOrders = async () => {
    try {
      const res = await fetch("/api/orders");
      if (res.ok) {
        const list: Order[] = await res.json();
        
        // La barra gestiona bebidas (destination === "bar" o categoría cat-3).
        // Filtramos órdenes pendientes, en preparación o listas.
        const barFiltered = list.filter(o => 
          (o.status === "pendiente" || o.status === "en_preparacion" || o.status === "listo") &&
          o.items.some(line => line.destination === "bar")
        );
        setOrders(barFiltered);
      }
    } catch (err) {
      console.error(err);
      toast("Error al cargar pedidos de barra.", "error");
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
        fetchBarOrders();
      }
    } catch (err) {
      console.error(err);
      toast("Error al actualizar estado del pedido.", "error");
    }
  };

  const pending = orders.filter(o => o.status === "pendiente");
  const compiling = orders.filter(o => o.status === "en_preparacion");
  const ready = orders.filter(o => o.status === "listo");

  const rootBgClass = isHighContrast 
    ? "min-h-screen bg-black text-white p-4 md:p-6 pb-24 font-mono select-none border-8 border-yellow-400" 
    : "min-h-screen bg-slate-900 text-white p-4 md:p-6 pb-24 font-sans";

  return (
    <div className={rootBgClass} id="bar_root">
      
      {/* HEADER BARRA */}
      <header className={`flex flex-col md:flex-row md:items-center justify-between border-b pb-5 mb-6 ${
        isHighContrast ? "border-yellow-400" : "border-indigo-950"
      }`}>
        <div>
          <span className={`text-xs font-mono font-bold tracking-wider px-2.5 py-1 rounded-full uppercase ${
            isHighContrast ? "text-yellow-400 border border-yellow-400 bg-black" : "text-sky-400 bg-sky-400/10"
          }`}>KDS - Bar & Beverage Terminal</span>
          <h1 className="text-2xl font-black tracking-tight text-white mt-1.5 flex items-center col-span-2">
            <span>🍹 Control de Bebidas y Barra</span>
          </h1>
        </div>
        <div className="flex items-center space-x-3 mt-3 md:mt-0">
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
            Pendientes: {pending.length} | Listo en barra: {ready.length}
          </span>
        </div>
      </header>

      {/* RECEPTÁCULOS DE BEBIDAS */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        
        <AnimatePresence mode="popLayout">
          {orders.length === 0 ? (
            <motion.div 
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="col-span-full bg-slate-950/30 border border-dashed border-slate-800 rounded-2xl py-16 text-center text-slate-500"
            >
              <GlassWater className="w-10 h-10 mx-auto opacity-20 mb-2" />
              <p className="text-xs">No hay tickets de bebidas por preparar en barra</p>
            </motion.div>
          ) : (
            orders.map((order) => {
              const isCompleted = order.status === "listo";
              const isCooking = order.status === "en_preparacion";
              const isPending = order.status === "pendiente";

              return (
                <motion.div
                  layout
                  initial={{ opacity: 0, y: 15, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -15, scale: 0.96 }}
                  transition={{ type: "spring", stiffness: 450, damping: 28 }}
                  key={order.id}
                  className={`bg-slate-950/80 rounded-2xl border p-4.5 flex flex-col justify-between ${
                    isCompleted 
                      ? "border-emerald-950 opacity-60" 
                      : isCooking 
                      ? "border-indigo-900 shadow-md" 
                      : "border-slate-800 bg-slate-950"
                  } ${order.timestamp ? getTimeColor(order.timestamp) : ""}`}
                  id={`bar_ticket_${order.id}`}
                >
                  <div>
                    <div className="flex justify-between items-center pb-2.5 border-b border-indigo-950/50 mb-3">
                      <div className="flex items-center space-x-2">
                        <span className="text-xs font-black bg-indigo-900/50 text-indigo-200 px-2 py-0.5 rounded-md">
                          {order.tableName}
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">#{order.id.slice(-5).toUpperCase()}</span>
                      </div>
                      <button
                        onClick={() => handlePrintBarComanda(order)}
                        className="text-slate-400 hover:text-white p-1 hover:bg-slate-800 rounded transition cursor-pointer"
                        title="Imprimir comanda de barra"
                        aria-label="Imprimir comanda de barra"
                      >
                        <Printer className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Lista de bebidas de esta orden */}
                    <div className="space-y-3 py-1">
                      {order.items.filter(line => line.destination === "bar").map(line => (
                        <div key={line.id} className="text-xs">
                          <p className="font-extrabold text-white">
                            <span className="text-sky-400 font-black">{line.quantity}x</span> {line.name}
                          </p>
                          {line.selectedExtras && line.selectedExtras.length > 0 && (
                            <p className="text-[10px] text-slate-500 font-medium ml-4">
                              + {line.selectedExtras.map((e: any) => e.optionName).join(", ")}
                            </p>
                          )}
                          {line.notes && (
                            <p className="text-[10px] font-mono bg-indigo-500/10 text-sky-300 p-1 rounded inline-block mt-1">
                              📝 "{line.notes}"
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Acciones de Barra */}
                  <div className="mt-5 pt-3.5 border-t border-indigo-950/50 flex justify-between items-center text-xs">
                    {order.timestamp && (
                      <ProgressRing timestamp={order.timestamp} />
                    )}

                    {isPending && (
                      <button
                        onClick={() => handleUpdateStatus(order.id, "en_preparacion")}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-1.5 px-3 min-h-[44px] rounded-lg flex items-center space-x-1 cursor-pointer transition"
                        aria-label="Poner en preparación"
                        id={`btn_bar_cook_${order.id}`}
                      >
                        <Clock className="w-3.5 h-3.5" />
                        <span>Servir Copa</span>
                      </button>
                    )}

                    {isCooking && (
                      <button
                        onClick={() => handleUpdateStatus(order.id, "listo")}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-1.5 px-3 min-h-[44px] rounded-lg flex items-center space-x-1 cursor-pointer transition"
                        aria-label="Marcar como listo"
                        id={`btn_bar_ready_${order.id}`}
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Listo</span>
                      </button>
                    )}

                    {isCompleted && (
                      <span className="font-bold text-emerald-400 flex items-center space-x-1">
                        <Check className="w-4 h-4" />
                        <span>Listo en barra</span>
                      </span>
                    )}
                  </div>
                </motion.div>
              );
            })
          )}
        </AnimatePresence>

      </div>

    </div>
  );
}
