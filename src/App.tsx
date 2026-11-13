/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { lazy, Suspense, useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence, MotionConfig } from "motion/react";
import { Settings, LogOut, LogIn, Utensils, ClipboardList, ChefHat, GlassWater } from "lucide-react";

import { UserRole, User } from "./types";
import { ToastProvider } from "./components/ToastProvider";
import { tryDirectPrint } from "./utils/directPrint";
import ErrorBoundary from "./components/ErrorBoundary";
import LiquidBar from "./components/LiquidBar";
import { applyTheme, isTheme } from "./utils/theme";

const ClientView = lazy(() => import("./components/ClientView"));
const CamareroView = lazy(() => import("./components/CamareroView"));
const ChefView = lazy(() => import("./components/ChefView"));
const BarView = lazy(() => import("./components/BarView"));
const AdminView = lazy(() => import("./components/AdminView"));
const AuthView = lazy(() => import("./components/AuthView"));

function RoleFallback() {
  return (
    <div className="flex flex-1 items-center justify-center p-10">
      <div className="flex items-center gap-3 text-sm font-semibold text-ink-muted" role="status">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900" />
        Cargando
      </div>
    </div>
  );
}

export default function App() {
  const [appType, setAppType] = useState<string>("both"); // "client", "internal", "both"
  const [configLoaded, setConfigLoaded] = useState(false);
  // Roles de usuario y sesión
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<UserRole>("cliente");
  
  // Mesa seleccionada para simulaciones de Cliente
  const [selectedSimTable, setSelectedSimTable] = useState<number | null>(null);
  const [tableToken, setTableToken] = useState<string | null>(null);
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

  // El tema lo decide administración: cada dispositivo lo vuelve a consultar cada 30 s y al volver a la pestaña.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      fetch("/api/app-config")
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => { if (data && isTheme(data.theme) && data.theme !== document.documentElement.dataset.theme) applyTheme(data.theme); })
        .catch(() => {});
    };
    const timer = setInterval(refresh, 30000);
    document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
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
        setConfigLoaded(true);
        if (isTheme(data.theme)) applyTheme(data.theme);
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
        setConfigLoaded(true);
        setSelectedSimTable(prev => prev === null ? 1 : prev);
      });

    // 1. Detectar si el usuario está accediendo escaneando un QR real
    // Ejemplo: URL/?mesa=4 o URL/?table=4
    const params = new URLSearchParams(window.location.search);
    const mesaParam = params.get("mesa") || params.get("table");
    const qrToken = params.get("t");
    
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
        if (qrToken) {
          setTableToken(qrToken);
          sessionStorage.setItem(`table_token_${num}`, qrToken);
        }
      }
    } else if (urlMesaNum && !isNaN(urlMesaNum)) {
      setSelectedSimTable(urlMesaNum);
      setSelectedRole("cliente");
      setIsKioskMode(true);
      const saved = sessionStorage.getItem(`table_token_${urlMesaNum}`);
      if (saved) setTableToken(saved);
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

  useEffect(() => {
    if (selectedRole !== "cliente" || !selectedSimTable || currentUser?.role !== "admin" || tableToken) return;
    fetch("/api/tables")
      .then((response) => response.ok ? response.json() : [])
      .then((tables: any[]) => {
        const table = tables.find((entry) => entry.number === selectedSimTable);
        if (table?.qrCodeData) {
          setTableToken(table.qrToken || null);
          sessionStorage.setItem(`table_token_${selectedSimTable}`, table.qrToken || "");
        }
      })
      .catch(() => {});
  }, [selectedRole, selectedSimTable, currentUser, tableToken]);

  const handleLoginSuccess = useCallback((user: User, token: string) => {
    setCurrentUser(user);
    setSessionToken(token);
    setSelectedRole(user.role);
    localStorage.setItem("auth_user", JSON.stringify(user));
    localStorage.setItem("auth_token", token);
  }, []);

  const handleLogout = useCallback(() => {
    const token = localStorage.getItem("auth_token");
    if (token) {
      fetch("/api/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    }
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

      let sentAuth = false;
      if (isLocal) {
        const headers = new Headers(updatedInit.headers);
        if (token && !headers.has("Authorization")) {
          headers.set("Authorization", `Bearer ${token}`);
          sentAuth = true;
        }
        if (tableToken && !headers.has("X-Table-Token")) {
          headers.set("X-Table-Token", tableToken);
        }
        updatedInit.headers = headers;
      }

      const response = await originalFetch(input, updatedInit);
      if (response.status === 401 && sentAuth && !urlString.includes("/api/auth/login")) {
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
  }, [handleLogout, tableToken]);

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

  const showNav = configLoaded && !isKioskMode && appType !== "client";
  const isAdmin = currentUser?.role === "admin";
  const navItems: { role: UserRole; label: string; Icon: React.ComponentType<{ className?: string }> }[] = (
    [
      ...(isAdmin && appType !== "internal" ? [{ role: "cliente" as UserRole, label: "Cliente", Icon: Utensils }] : []),
      ...(isAdmin || currentUser?.role === "camarero" ? [{ role: "camarero" as UserRole, label: "Sala", Icon: ClipboardList }] : []),
      ...(isAdmin || currentUser?.role === "cocina" ? [{ role: "cocina" as UserRole, label: "Cocina", Icon: ChefHat }] : []),
      ...(isAdmin || currentUser?.role === "bar" ? [{ role: "bar" as UserRole, label: "Barra", Icon: GlassWater }] : []),
      ...(isAdmin ? [{ role: "admin" as UserRole, label: "Admin", Icon: Settings }] : []),
    ]
  );

  return (
    <MotionConfig reducedMotion="user">
    <ToastProvider>
    <ErrorBoundary>
    <div className={`app-root flex flex-col text-ink ${showNav ? "app-shell" : ""}`} data-role={selectedRole} id="unified_master_app">
      {/* NAVEGACIÓN: LiquidBar (cápsula de cristal con lente; la sesión vive en su propio círculo) */}
      {showNav && (
        <LiquidBar
          id="floating_nav"
          ariaLabel="Navegación principal"
          items={navItems.map(({ role, label, Icon }) => ({ key: role, label, icon: Icon }))}
          selectedKey={navItems.some((item) => item.role === selectedRole) ? selectedRole : null}
          onSelect={(key) => setSelectedRole(key as UserRole)}
          action={currentUser
            ? { label: `Cerrar sesión (${currentUser.name})`, icon: LogOut, onClick: handleLogout, badge: true }
            : selectedRole === "cliente"
              ? { label: "Acceso del personal", icon: LogIn, onClick: () => setSelectedRole("admin") }
              : undefined /* ya está en la pantalla de acceso: el botón sobraría */}
        />
      )}

      {/* Selector de mesa para previsualizar la carta (oculto con QR real o en la instancia de cliente) */}
      {!isKioskMode && selectedRole === "cliente" && appType === "both" && (
        <section className="glass-panel mx-3 mt-3 rounded-full pl-4 pr-2 py-1.5 text-xs flex items-center justify-between gap-3 shrink-0 relative z-40">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] shrink-0">Vista previa</span>
          <label className="flex items-center gap-2 min-w-0">
            <span className="text-slate-600 hidden sm:inline">Mesa que simulas</span>
            <select
              value={selectedSimTable || 1}
              onChange={(e) => {
                const num = parseInt(e.target.value);
                setSelectedSimTable(num);
                const url = new URL(window.location.href);
                url.searchParams.set("mesa", String(num));
                url.searchParams.delete("t");
                window.history.pushState({}, "", url.toString());
                setTableToken(null);
              }}
              className="bg-slate-100 text-slate-900 font-bold border border-slate-900 px-3 py-1.5 cursor-pointer"
              id="simulated_table_picker"
              aria-label="Mesa simulada"
            >
              {Array.from({ length: 8 }, (_, i) => (
                <option key={i+1} value={i+1}>Mesa {i+1}</option>
              ))}
            </select>
          </label>
        </section>
      )}

      {/* CONTENEDOR CENTRAL DE PANTALLAS */}
      <div className="flex-1 flex flex-col justify-stretch">
        <Suspense fallback={<RoleFallback />}>
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
                tableToken={tableToken}
                onUnlockRoles={handleUnlockKiosk}
                isKioskMode={isKioskMode}
                hasGlobalNav={showNav}
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
        </Suspense>
      </div>

      <PrintSection data={activeTicketToPrint} />
    </div>
    </ErrorBoundary>
    </ToastProvider>
    </MotionConfig>
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

  const facturaNum = data.invoiceNumber
    ? `F-${String(data.invoiceNumber).padStart(5, "0")}`
    : `F-${String(data.ticketNumber ? parseInt(data.ticketNumber.replace(/\D/g, "").slice(0, 5), 10) || 1000 : 1000).padStart(5, "0")}`;

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
        {data.paymentMethod && <div>Pago: {data.paymentMethod}</div>}
        {data.splitMethod && data.splitMethod !== "completa" && (
          <div>Fraccionado ({data.splitMethod.replace("_", " ")})</div>
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
            <div>¡Muchas gracias por su visita!</div>
            <div>GastroOS</div>
          </>
        ) : (
          <div style={{ fontWeight: "bold" }}>*** COMANDA DE {data.type === "kitchen" ? "COCINA" : "BARRA"} ***</div>
        )}
      </div>
    </div>
  );
}
