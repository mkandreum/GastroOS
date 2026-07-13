/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from "react";
import { 
  motion, AnimatePresence 
} from "motion/react";
import { 
  ChefHat, ClipboardList, Utensils, GlassWater, Settings, LogOut, CheckSquare, 
  HelpCircle, MessageCircleCode, Star, AlertCircle
} from "lucide-react";

import { UserRole, User } from "./types";
import { ToastProvider } from "./components/ToastProvider";
import { tryDirectPrint } from "./utils/directPrint";
import ClientView from "./components/ClientView";
import CamareroView from "./components/CamareroView";
import ChefView from "./components/ChefView";
import BarView from "./components/BarView";
import AdminView from "./components/AdminView";
import AuthView from "./components/AuthView";

export default function App() {
  const [appType, setAppType] = useState<string>("both"); // "client", "internal", "both"
  // Roles de usuario y sesión
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<UserRole>("cliente");
  
  // Mesa seleccionada para simulaciones de Cliente
  const [selectedSimTable, setSelectedSimTable] = useState<number | null>(null);
  const [isKioskMode, setIsKioskMode] = useState(false); // Si entra escaneando QR físico
  const [activeTicketToPrint, setActiveTicketToPrint] = useState<any | null>(null);

  useEffect(() => {
    const handlePrintRequest = async (e: Event) => {
      const customEvent = e as CustomEvent;
      if (!customEvent.detail) return;

      const { ticketNumber } = customEvent.detail;

      // Intentar impresión directa desde el navegador a la IP de la impresora
      if (ticketNumber) {
        const sent = await tryDirectPrint(ticketNumber);
        if (sent) {
          console.log("[Print] Impresión directa exitosa");
          return;
        }
      }

      // Fallback: mostrar ventana de impresión del navegador
      setActiveTicketToPrint(customEvent.detail);
    };
    window.addEventListener("print-ticket", handlePrintRequest);
    return () => {
      window.removeEventListener("print-ticket", handlePrintRequest);
    };
  }, []);

  useEffect(() => {
    if (activeTicketToPrint) {
      const timer = setTimeout(() => {
        window.print();
        setActiveTicketToPrint(null);
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [activeTicketToPrint]);

  useEffect(() => {
    // 0. Obtener tipo de aplicación desde el backend
    fetch("/api/app-config")
      .then(res => res.json())
      .then(data => {
        if (data.appType) {
          setAppType(data.appType);
          const hasSavedUser = !!localStorage.getItem("auth_user");
          if (!hasSavedUser) {
            if (data.appType === "client") {
              setSelectedRole("cliente");
            } else {
              setSelectedSimTable(prev => prev === null ? 1 : prev);
              if (data.appType === "internal") {
                setSelectedRole("admin"); // Redirigir a Login por defecto
              }
            }
          } else {
            if (data.appType !== "client") {
              setSelectedSimTable(prev => prev === null ? 1 : prev);
            }
          }
        }
      })
      .catch(err => {
        console.error("Error al obtener la configuración de la app:", err);
        setSelectedSimTable(prev => prev === null ? 1 : prev);
      });

    // 1. Detectar si el usuario está accediendo escaneando un QR real
    // Ejemplo: URL/?mesa=4 o URL/?table=4
    const params = new URLSearchParams(window.location.search);
    const mesaParam = params.get("mesa") || params.get("table");
    
    // O vía path names, ej: /mesa/4
    const pathParts = window.location.pathname.split("/");
    const pathMesaIndex = pathParts.indexOf("mesa");
    let urlMesaNum = null;
    
    if (pathMesaIndex !== -1 && pathParts[pathMesaIndex + 1]) {
      urlMesaNum = parseInt(pathParts[pathMesaIndex + 1]);
    }

    if (mesaParam) {
      const num = parseInt(mesaParam);
      if (!isNaN(num)) {
        setSelectedSimTable(num);
        setSelectedRole("cliente");
        setIsKioskMode(true);
      }
    } else if (urlMesaNum && !isNaN(urlMesaNum)) {
      setSelectedSimTable(urlMesaNum);
      setSelectedRole("cliente");
      setIsKioskMode(true);
    }

    // 2. Cargar token guardado para agilizar testeo si existe
    const savedUser = localStorage.getItem("auth_user");
    const savedToken = localStorage.getItem("auth_token");
    if (savedUser && savedToken) {
      try {
        const u = JSON.parse(savedUser);
        setCurrentUser(u);
        setSessionToken(savedToken);
        setSelectedRole(u.role);
      } catch (e) {
        localStorage.removeItem("auth_user");
        localStorage.removeItem("auth_token");
      }
    }
  }, []);

  const handleLoginSuccess = useCallback((user: User, token: string) => {
    setCurrentUser(user);
    setSessionToken(token);
    setSelectedRole(user.role);
    localStorage.setItem("auth_user", JSON.stringify(user));
    localStorage.setItem("auth_token", token);
  }, []);

  const handleLogout = useCallback(() => {
    setCurrentUser(null);
    setSessionToken(null);
    localStorage.removeItem("auth_user");
    localStorage.removeItem("auth_token");
    if (appType === "client") {
      setSelectedRole("cliente");
    } else {
      setSelectedRole("admin");
    }
  }, [appType]);

  useEffect(() => {
    // Interceptor global de fetch para inyectar token de autorización y capturar respuestas 401
    const originalFetch = window.fetch;
    window.fetch = async function (input, init) {
      const token = localStorage.getItem("auth_token");
      let updatedInit = init || {};
      
      const urlString = typeof input === "string" 
        ? input 
        : (input && typeof input === "object" && "url" in input ? (input as any).url : String(input));
      
      const isLocal = urlString.startsWith("/") || 
                      urlString.startsWith(window.location.origin) || 
                      urlString.startsWith("http://localhost:3000");

      if (token && isLocal) {
        const headers = new Headers(updatedInit.headers);
        if (!headers.has("Authorization")) {
          headers.set("Authorization", `Bearer ${token}`);
        }
        updatedInit.headers = headers;
      }

      const response = await originalFetch(input, updatedInit);
      if (response.status === 401 && !urlString.includes("/api/auth/login")) {
        window.dispatchEvent(new Event("unauthorized"));
      }
      return response;
    };

    const handleUnauthorized = () => {
      handleLogout();
      
      window.dispatchEvent(new CustomEvent("show-toast", {
        detail: { message: "Tu sesión ha expirado. Por favor, inicia sesión de nuevo.", type: "error" }
      }));
    };

    window.addEventListener("unauthorized", handleUnauthorized);

    return () => {
      window.fetch = originalFetch;
      window.removeEventListener("unauthorized", handleUnauthorized);
    };
  }, [handleLogout]);

  const handleUnlockKiosk = () => {
    // Si están testeando sobre el QR de cliente locked y quieren volver a ver los controles de rol
    setIsKioskMode(false);
  };

  // Determinar si una terminal privada requiere login o ya está autenticada
  const isAuthorizedForRole = (role: UserRole) => {
    if (role === "cliente") return true; // Cliente no se valida a nivel personal
    if (!currentUser || !sessionToken) return false;
    
    // Si es administrador general, tiene llaves para todos los paneles
    if (currentUser.role === "admin") return true;
    
    // El rol del personal debe coincidir con la terminal correspondiente
    return currentUser.role === role;
  };

  return (
    <ToastProvider>
    <div className="min-h-screen bg-slate-50 grid-bg flex flex-col text-slate-800 selection:bg-indigo-600 selection:text-white" id="unified_master_app">
      
      {/* HEADER ACTORES / SIMULADOR GENERAL (Oculto en Kiosk QR real del comensal o si appType es client) */}
      {!isKioskMode && appType !== "client" && (
        <header className="h-auto md:h-16 bg-white border-b border-slate-250 flex flex-col md:flex-row items-center justify-between px-6 py-3 md:py-0 shrink-0 gap-4" id="sim_navigation_header">
          <div className="flex items-center gap-3 shrink-0">
            <div className="w-8 h-8 bg-slate-900 rounded flex items-center justify-center shrink-0">
              <div className="w-4 h-4 border-2 border-white rotate-45"></div>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-bold text-base tracking-tight text-slate-900">GASTRO-OS</h1>
                <span className="text-slate-400 font-mono text-[10px] bg-slate-100 px-1.5 py-0.5 rounded font-black">v1.0.0</span>
              </div>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-tight">Sistema de Gestión de Hostelería</p>
            </div>
          </div>

          {/* Selección de Terminal */}
          {(currentUser && currentUser.role === "admin") && (
            <div className="flex flex-wrap justify-center gap-1.5 bg-slate-100 p-1 rounded-xl border border-slate-200/80 text-xs" id="role_navigator_capsules">
              {appType !== "internal" && (
                <button
                  onClick={() => setSelectedRole("cliente")}
                  className={`px-3 py-1.5 rounded-lg font-bold transition-all duration-150 cursor-pointer snap-start whitespace-nowrap ${
                    selectedRole === "cliente" ? "bg-slate-900 text-white" : "text-slate-655 hover:text-slate-900 hover:bg-slate-205/50"
                  }`}
                >
                  📱 Cliente
                </button>
              )}

              <button
                onClick={() => setSelectedRole("camarero")}
                className={`px-3 py-1.5 rounded-lg font-bold transition-all duration-150 cursor-pointer snap-start whitespace-nowrap ${
                  selectedRole === "camarero" ? "bg-amber-150 text-amber-805 border border-amber-200" : "text-slate-655 hover:text-slate-900 hover:bg-slate-205/50"
                }`}
              >
                🤵 Camarero
              </button>

              <button
                onClick={() => setSelectedRole("cocina")}
                className={`px-3 py-1.5 rounded-lg font-bold transition-all duration-150 cursor-pointer snap-start whitespace-nowrap ${
                  selectedRole === "cocina" ? "bg-red-100 text-red-700 border border-red-200" : "text-slate-655 hover:text-slate-900 hover:bg-slate-205/50"
                }`}
              >
                🍳 Cocina
              </button>

              <button
                onClick={() => setSelectedRole("bar")}
                className={`px-3 py-1.5 rounded-lg font-bold transition-all duration-150 cursor-pointer snap-start whitespace-nowrap ${
                  selectedRole === "bar" ? "bg-sky-100 text-sky-850 border border-sky-200" : "text-slate-655 hover:text-slate-900 hover:bg-slate-205/50"
                }`}
              >
                🍹 Barra
              </button>

              <button
                onClick={() => setSelectedRole("admin")}
                className={`px-3 py-1.5 rounded-lg font-bold transition-all duration-150 cursor-pointer snap-start whitespace-nowrap ${
                  selectedRole === "admin" ? "bg-indigo-100 text-indigo-700 border border-indigo-200" : "text-slate-655 hover:text-slate-900 hover:bg-slate-205/50"
                }`}
              >
                ⚙️ Admin
              </button>
            </div>
          )}

          <div className="flex items-center gap-4 text-[11px] font-semibold text-slate-650 shrink-0">
            <div className="hidden lg:flex items-center gap-2 font-mono">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              IMPRESORA: ONLINE (ZPL)
            </div>
            
            {/* Estado de login activo */}
            {currentUser ? (
              <div className="flex items-center space-x-2 bg-slate-900 text-white px-3 py-1.5 rounded-lg border border-slate-800 text-xs shadow-xs font-mono font-bold">
                <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full" />
                <span className="truncate max-w-[100px]">{currentUser.role.toUpperCase()}: {currentUser.name.toUpperCase()}</span>
                <button 
                  onClick={handleLogout}
                  className="text-slate-400 hover:text-red-400 cursor-pointer shrink-0 transition"
                  title="Cerrar sesión"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div className="bg-slate-100 px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-500 font-mono text-[10px] hidden sm:block">
                  API: CONECTADA
                </div>
                {appType !== "client" && (
                  <button
                    onClick={() => setSelectedRole("admin")}
                    className="bg-indigo-600 hover:bg-indigo-750 text-white font-extrabold text-xs px-3.5 py-1.5 rounded-lg shadow-xs flex items-center gap-1 cursor-pointer"
                  >
                    🔑 Acceso Personal
                  </button>
                )}
              </div>
            )}
          </div>
        </header>
      )}

      {/* SUB-HEADER ACCESOS RAPIDOS MESA CLIENTE (Oculto en Kiosk QR real o en producción) */}
      {!isKioskMode && selectedRole === "cliente" && appType === "both" && (
        <section className="bg-slate-900 text-slate-400 px-4 py-2.5 text-xs flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-800 tracking-tight shrink-0 gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-amber-400 font-bold shrink-0">⚡ Simulador QR:</span>
            <span className="text-slate-300">Mesa virtual activa:</span>
            
            <select
              value={selectedSimTable || 1}
              onChange={(e) => {
                const num = parseInt(e.target.value);
                setSelectedSimTable(num);
                // Si cambiamos, forzamos redirección simulada borrando/actualizando query para que rutee limpio
                const url = new URL(window.location.href);
                url.searchParams.set("mesa", String(num));
                window.history.pushState({}, "", url.toString());
              }}
              className="bg-slate-850 text-white font-black border border-slate-700 rounded px-2.5 py-0.5 cursor-pointer focus:outline-none"
              id="simulated_table_picker"
            >
              {Array.from({ length: 8 }, (_, i) => (
                <option key={i+1} value={i+1}>Mesa {i+1}</option>
              ))}
            </select>
          </div>
          <span className="hidden sm:inline-flex items-center text-[10px] text-slate-500 uppercase font-bold tracking-wider">
            ● Emulación de dispositivo móvil comensal
          </span>
        </section>
      )}

      {/* CONTENEDOR CENTRAL DE PANTALLAS */}
      <div className="flex-1 flex flex-col justify-stretch">
        <AnimatePresence mode="wait">
          {selectedRole === "cliente" && (
            <motion.div
              key={`client-${selectedSimTable}`}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.2, ease: "easeInOut" }}
              className="flex-1 flex flex-col"
            >
              <ClientView 
                tableNumber={selectedSimTable} 
                onUnlockRoles={handleUnlockKiosk}
                isKioskMode={isKioskMode}
              />
            </motion.div>
          )}

          {selectedRole === "camarero" && (
            <motion.div
              key="camarero"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.2, ease: "easeInOut" }}
              className="flex-1 flex flex-col"
            >
              {isAuthorizedForRole("camarero") ? (
                <CamareroView />
              ) : (
                <AuthView onLoginSuccess={handleLoginSuccess} />
              )}
            </motion.div>
          )}

          {selectedRole === "cocina" && (
            <motion.div
              key="cocina"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.2, ease: "easeInOut" }}
              className="flex-1 flex flex-col"
            >
              {isAuthorizedForRole("cocina") ? (
                <ChefView />
              ) : (
                <AuthView onLoginSuccess={handleLoginSuccess} />
              )}
            </motion.div>
          )}

          {selectedRole === "bar" && (
            <motion.div
              key="bar"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.2, ease: "easeInOut" }}
              className="flex-1 flex flex-col"
            >
              {isAuthorizedForRole("bar") ? (
                <BarView />
              ) : (
                <AuthView onLoginSuccess={handleLoginSuccess} />
              )}
            </motion.div>
          )}

          {selectedRole === "admin" && (
            <motion.div
              key="admin"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.2, ease: "easeInOut" }}
              className="flex-1 flex flex-col"
            >
              {isAuthorizedForRole("admin") ? (
                <AdminView />
              ) : (
                <AuthView onLoginSuccess={handleLoginSuccess} />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <PrintSection data={activeTicketToPrint} />
    </div>
    </ToastProvider>
  );
}

function PrintSection({ data }: { data: any }) {
  if (!data) return null;

  const formatDate = (isoString: string) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleString("es-ES", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return isoString;
    }
  };

  const facturaNum = `F-${String(data.ticketNumber ? parseInt(data.ticketNumber.replace(/\D/g, "").slice(0, 5), 10) || 1000 : 1000).padStart(5, "0")}`;

  return (
    <div id="print-section" className="print-ticket" style={{ width: "280px", margin: "0 auto", padding: "10px", fontSize: "11px" }}>
      <div style={{ textAlign: "center", marginBottom: "8px" }}>
        <div style={{ fontSize: "20px", fontWeight: "900", letterSpacing: "2px" }}>GASTRO-OS</div>
        <div style={{ fontSize: "11px", fontWeight: "bold", textTransform: "uppercase", marginTop: "4px" }}>{data.title}</div>
      </div>

      <div style={{ fontSize: "10px", display: "flex", flexDirection: "column", gap: "2px", marginBottom: "6px" }}>
        <div>Factura: {facturaNum}</div>
        <div>Mesa: {data.tableName}</div>
        <div>{formatDate(data.timestamp)}</div>
        {data.ticketNumber && <div>Ticket #: {data.ticketNumber}</div>}
        {data.splitMethod && data.splitMethod !== "completa" && (
          <div>Metodo Pago: Fraccionado ({data.splitMethod.replace("_", " ")})</div>
        )}
      </div>

      <div style={{ borderTop: "2px solid black", margin: "4px 0" }}></div>

      <div style={{ display: "flex", fontWeight: "bold", fontSize: "10px", padding: "2px 0" }}>
        <span style={{ width: "35px" }}>CANT</span>
        <span style={{ flex: 1 }}>DESCRIPCION</span>
        {data.type === "bill" && <span style={{ width: "70px", textAlign: "right" }}>TOTAL</span>}
      </div>
      <div style={{ borderTop: "1px solid black", margin: "2px 0" }}></div>

      <div style={{ fontSize: "10px", display: "flex", flexDirection: "column", gap: "3px" }}>
        {data.items.map((item: any, idx: number) => (
          <div key={idx}>
            <div style={{ display: "flex" }}>
              <span style={{ width: "35px" }}>{item.quantity}x</span>
              <span style={{ flex: 1, wordBreak: "break-all" }}>{item.name.slice(0, 22)}</span>
              {data.type === "bill" && (
                <span style={{ width: "70px", textAlign: "right" }}>
                  {((item.priceTotal != null ? item.priceTotal : (item.priceUnit || 0) * item.quantity)).toFixed(2)} EUR
                </span>
              )}
            </div>
            {item.selectedExtras && item.selectedExtras.length > 0 && (
              <div style={{ paddingLeft: "35px", fontSize: "9px", fontStyle: "italic" }}>
                {item.selectedExtras.map((e: any, iIndex: number) => (
                  <div key={iIndex}>+ {e.optionName || e}</div>
                ))}
              </div>
            )}
            {item.notes && (
              <div style={{ paddingLeft: "35px", fontSize: "9px", fontStyle: "italic" }}>"{item.notes}"</div>
            )}
          </div>
        ))}
      </div>

      <div style={{ borderTop: "1px solid black", margin: "6px 0" }}></div>

      {data.type === "bill" && (
        <div style={{ fontSize: "10px", display: "flex", flexDirection: "column", gap: "2px" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Subtotal:</span>
            <span>{data.subtotal.toFixed(2)} EUR</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>IVA Incluido:</span>
            <span>{data.taxAmount.toFixed(2)} EUR</span>
          </div>
          <div style={{ borderTop: "2px solid black", margin: "2px 0" }}></div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "14px", fontWeight: "900" }}>
            <span>TOTAL:</span>
            <span>{data.total.toFixed(2)} EUR</span>
          </div>
        </div>
      )}

      {data.type !== "bill" && data.ticketNumber && (
        <div style={{ textAlign: "center", fontSize: "9px", marginTop: "6px" }}>
          ID Pedido: #{data.ticketNumber.toUpperCase()}
        </div>
      )}

      <div style={{ textAlign: "center", fontSize: "9px", marginTop: "10px", display: "flex", flexDirection: "column", gap: "1px" }}>
        {data.type === "bill" ? (
          <>
            <div>!Muchas gracias por su visita!</div>
            <div>GastroOS - GastroOS.com</div>
          </>
        ) : (
          <div style={{ fontWeight: "bold" }}>*** COMANDA DE {data.type === "kitchen" ? "COCINA" : "BARRA"} ***</div>
        )}
      </div>
    </div>
  );
}
