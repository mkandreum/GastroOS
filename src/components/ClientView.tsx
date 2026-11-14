/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from "react";
import { LiquidChip, LiquidBadge } from "./LiquidUI";
import { 
  motion, AnimatePresence 
} from "motion/react";
import {
  Utensils, Beef, GlassWater, IceCream, ShoppingBag, Info,
  Check, X, ListTodo, AlertTriangle, QrCode, Soup, Salad, Wheat, Trash2, Loader2, Search, Plus, BellRing, ReceiptText
} from "lucide-react";
import LiquidBar from "./LiquidBar";
import { useToast } from "./ToastProvider";
import { useFocusTrap } from "./useFocusTrap";
import { Category, Product, ModifierGroup, ModifierOption, SelectedModifier, Table } from "../types";


const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.04
    }
  }
};

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  show: { 
    opacity: 1, 
    y: 0,
    transition: {
      type: "spring",
      stiffness: 260,
      damping: 22
    }
  }
};

const fuzzyMatch = (text: string, query: string): boolean => {
  if (!query) return true;
  const cleanText = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const cleanQuery = query.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  
  if (cleanText.includes(cleanQuery)) return true;
  
  const queryWords = cleanQuery.split(/\s+/).filter(Boolean);
  const textWords = cleanText.split(/\s+/).filter(Boolean);
  
  return queryWords.every(qWord => {
    return textWords.some(tWord => {
      if (tWord.includes(qWord)) return true;
      if (tWord.length >= 4 && qWord.includes(tWord)) return true;
      if (Math.abs(tWord.length - qWord.length) <= 1) {
        let diffs = 0;
        let i = 0, j = 0;
        while (i < tWord.length && j < qWord.length) {
          if (tWord[i] !== qWord[j]) {
            diffs++;
            if (tWord.length > qWord.length) i++;
            else if (qWord.length > tWord.length) j++;
            else { i++; j++; }
          } else {
            i++; j++;
          }
        }
        diffs += (tWord.length - i) + (qWord.length - j);
        if (diffs <= 1) return true;
      }
      return false;
    });
  });
};

interface ClientViewProps {
  tableNumber: number | null;
  tableToken?: string | null;
  onUnlockRoles?: () => void;
  isKioskMode?: boolean;
  /** Hay una barra de navegación global debajo (vista previa del personal). */
  hasGlobalNav?: boolean;
}

interface CartItem {
  product: Product;
  quantity: number;
  notes: string;
  selectedExtras: SelectedModifier[];
  uniqueId: string;
}

function readCart(key: string): CartItem[] {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) || "[]");
    return Array.isArray(saved) ? saved.filter((item) => item?.product?.id && item.quantity > 0 && item.uniqueId) : [];
  } catch {
    return [];
  }
}

const STATUS_COPY: Record<string, { label: string; tone: string; progress: string }> = {
  pendiente: { label: "Recibido", tone: "bg-amber-100 text-amber-700", progress: "w-[25%] bg-amber-500" },
  en_preparacion: { label: "En preparación", tone: "bg-indigo-100 text-indigo-700", progress: "w-[60%] bg-indigo-500" },
  listo: { label: "Listo, va para tu mesa", tone: "bg-emerald-100 text-emerald-800", progress: "w-[90%] bg-emerald-500" },
  servido: { label: "Servido", tone: "bg-slate-100 text-slate-500", progress: "w-full bg-slate-400" },
  cancelado: { label: "Anulado", tone: "bg-red-100 text-red-600", progress: "w-0" }
};

const formatPrice = (n: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);

export default function ClientView({ tableNumber, tableToken = null, onUnlockRoles, isKioskMode = false, hasGlobalNav = false }: ClientViewProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [tableInfo, setTableInfo] = useState<Table | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>("cat-1");
  // La cesta se guarda por mesa en la sesión del navegador: sobrevive a una recarga accidental.
  const cartKey = `gastro_cart_${tableNumber ?? "sin-mesa"}`;
  const [cart, setCart] = useState<CartItem[]>(() => readCart(cartKey));
  const cartKeyRef = React.useRef(cartKey);
  useEffect(() => {
    if (cartKeyRef.current !== cartKey) {
      cartKeyRef.current = cartKey;
      setCart(readCart(cartKey));
      return;
    }
    try { sessionStorage.setItem(cartKey, JSON.stringify(cart)); } catch { /* almacenamiento no disponible */ }
  }, [cart, cartKey]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"menu" | "orders">("menu");
  const [myOrders, setMyOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const { toast } = useToast();
  const [cartTrigger, setCartTrigger] = useState(0);
  const [flyingParticles, setFlyingParticles] = useState<Array<{ id: number; x: number; y: number }>>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [menuLoading, setMenuLoading] = useState(true);
  const cartTrapRef = useFocusTrap(isCartOpen);

  const triggerFlyParticle = (e: React.MouseEvent) => {
    const id = Date.now() + Math.random();
    setFlyingParticles(prev => [...prev, { id, x: e.clientX, y: e.clientY }]);
    setTimeout(() => {
      setFlyingParticles(prev => prev.filter(p => p.id !== id));
    }, 850);
  };

  // Controladores de modificadores / Extras modal
  const [selectedProductForExtras, setSelectedProductForExtras] = useState<Product | null>(null);
  const [tempExtras, setTempExtras] = useState<SelectedModifier[]>([]);
  const [tempNotes, setTempNotes] = useState("");
  const [isMobile, setIsMobile] = useState(false);

  // Estados para gestión del escáner QR de mesa
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState("");
  const [isCallWaiterModalOpen, setIsCallWaiterModalOpen] = useState(false);
  const [callingWaiter, setCallingWaiter] = useState(false);
  const modifierTrapRef = useFocusTrap(selectedProductForExtras !== null);
  const waiterCallTrapRef = useFocusTrap(isCallWaiterModalOpen);
  const scannerTrapRef = useFocusTrap(isScannerOpen);

  const handleCallWaiter = async (reason: "cuenta" | "ayuda" | "cubiertos" | "limpieza" | "duda") => {
    if (!tableNumber) return;
    setCallingWaiter(true);
    try {
      const res = await fetch("/api/waiter-calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableId: `table-${tableNumber}`, reason })
      });
      if (res.ok) {
        toast("Camarero avisado. Enseguida va a tu mesa.", "success");
        setIsCallWaiterModalOpen(false);
      } else {
        toast("No se pudo avisar al camarero. Inténtalo de nuevo.", "error");
      }
    } catch (err) {
      console.error(err);
      toast("Error de conexión al llamar al camarero.", "error");
    } finally {
      setCallingWaiter(false);
    }
  };

  const handleDecodedQR = (decodedText: string) => {
    try {
      const url = new URL(decodedText);
      const params = new URLSearchParams(url.search);
      const mesaParam = params.get("mesa") || params.get("table");
      const scannedToken = params.get("t");
      
      let mesaNum: number | null = null;
      if (mesaParam) {
        mesaNum = parseInt(mesaParam);
      } else {
        const parts = url.pathname.split("/");
        const idx = parts.indexOf("mesa");
        if (idx !== -1 && parts[idx + 1]) {
          mesaNum = parseInt(parts[idx + 1]);
        }
      }

      if (mesaNum && !isNaN(mesaNum)) {
        toast(`Mesa ${mesaNum} escaneada con éxito!`, "success");
        setIsScannerOpen(false);
        const currentUrl = new URL(window.location.href);
        currentUrl.searchParams.set("mesa", String(mesaNum));
        if (scannedToken) currentUrl.searchParams.set("t", scannedToken);
        window.location.href = currentUrl.toString();
      } else {
        toast("Código QR no válido. Asegúrate de escanear un código de mesa de GastroOS.", "error");
      }
    } catch (e) {
      // Intentar parsear como texto plano (ej: solo número "3")
      const num = parseInt(decodedText.trim());
      if (!isNaN(num)) {
        toast(`Mesa ${num} asignada con éxito!`, "success");
        setIsScannerOpen(false);
        const currentUrl = new URL(window.location.href);
        currentUrl.searchParams.set("mesa", String(num));
        window.location.href = currentUrl.toString();
      } else {
        toast("QR escaneado no reconocido.", "error");
      }
    }
  };

  useEffect(() => {
    let qrScanner: any = null;
    if (isScannerOpen) {
      setScannerError("");
      const timer = setTimeout(async () => {
        const scannerElement = document.getElementById("qr-reader");
        if (!scannerElement) return;
        try {
          const { Html5Qrcode } = await import("html5-qrcode");
          qrScanner = new Html5Qrcode("qr-reader");
          await qrScanner.start(
            { facingMode: "environment" },
            {
              fps: 10,
              qrbox: (width: number, height: number) => {
                const size = Math.min(width, height) * 0.7;
                return { width: size, height: size };
              }
            },
            (decodedText: string) => handleDecodedQR(decodedText),
            () => {}
          );
        } catch (err) {
          console.error("Fallo al iniciar cámara:", err);
          setScannerError("No se pudo acceder a la cámara. Concede permisos o introduce la mesa manualmente.");
        }
      }, 300);

      return () => {
        clearTimeout(timer);
        if (qrScanner?.isScanning) {
          qrScanner.stop().catch(() => {});
        }
      };
    }
  }, [isScannerOpen]);

  const closeScanner = () => {
    setIsScannerOpen(false);
    setScannerError("");
  };

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 640);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const tableId = tableNumber ? `table-${tableNumber}` : null;
  const canOrder = Boolean(tableNumber && tableToken);

  useEffect(() => {
    fetchMenu();
    if (tableNumber && tableToken) {
      fetchTableInfo();
      const interval = setInterval(async () => {
        await fetchTableInfo();
        fetchMyOrders();
      }, 8000);
      return () => clearInterval(interval);
    }
  }, [tableNumber, tableToken]);

  useEffect(() => {
    if (activeTab === "orders") {
      fetchMyOrders();
    }
  }, [activeTab]);

  const fetchMenu = async () => {
    setMenuLoading(true);
    try {
      const [resCat, resProd] = await Promise.all([
        fetch("/api/categories"),
        fetch("/api/products")
      ]);
      if (resCat.ok && resProd.ok) {
        const catData: Category[] = await resCat.json();
        const prodData: Product[] = await resProd.json();
        setCategories(catData);
        setProducts(prodData);
        setCart((prev) => prev
          .map((item) => {
            const fresh = prodData.find((product) => product.id === item.product.id && product.available);
            return fresh ? { ...item, product: fresh } : null;
          })
          .filter(Boolean) as typeof prev);
        const hasProducts = (category: Category) => prodData.some((product) => product.categoryId === category.id && product.available);
        const preferred = catData.find((category) => /entrante/i.test(category.name) && hasProducts(category)) || catData.find(hasProducts);
        if (preferred) setSelectedCategory(preferred.id);
      }
    } catch (err) {
      console.error(err); toast("Error al cargar el menú. Verifica tu conexión.", "error");
    } finally {
      setMenuLoading(false);
    }
  };

  const fetchTableInfo = async () => {
    if (!tableId || !tableToken) return;
    try {
      const res = await fetch(`/api/tables/${tableId}`);
      if (res.ok) {
        const current: Table = await res.json();
        setTableInfo(current);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchMyOrders = async () => {
    if (!tableId || !tableToken) return;
    try {
      const res = await fetch(`/api/orders?tableId=${tableId}`);
      if (res.ok) {
        const orders = await res.json();
        setMyOrders(orders);
      }
    } catch (err) {
      console.error(err); toast("Error al consultar tus pedidos.", "error");
    }
  };

  const activeOrdersCount = myOrders.filter((order) => order.status !== "servido" && order.status !== "cancelado").length;
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  const getCategoryIcon = (iconName?: string, name?: string) => {
    switch (iconName) {
      case "Soup": return <Soup className="w-5 h-5" />;
      case "Salad": return <Salad className="w-5 h-5" />;
      case "Wheat": return <Wheat className="w-5 h-5" />;
      case "Beef": return <Beef className="w-5 h-5" />;
      case "GlassWater": return <GlassWater className="w-5 h-5" />;
      case "IceCream": return <IceCream className="w-5 h-5" />;
      default: {
        const lower = (name || "").toLowerCase();
        if (lower.includes("ensalada")) return <Salad className="w-5 h-5" />;
        if (lower.includes("arroz")) return <Wheat className="w-5 h-5" />;
        if (lower.includes("bebida") || lower.includes("vino")) return <GlassWater className="w-5 h-5" />;
        if (lower.includes("postre")) return <IceCream className="w-5 h-5" />;
        if (lower.includes("entrante")) return <Soup className="w-5 h-5" />;
        return <Utensils className="w-5 h-5" />;
      }
    }
  };

  // Añadir producto al carrito, manejando modificadores
  const handleAddToCart = (product: Product) => {
    if (product.modifierGroups && product.modifierGroups.length > 0) {
      setSelectedProductForExtras(product);
      setTempExtras(
        // Pre-seleccionar opciones predeterminadas (requeridas) si existen
        product.modifierGroups
          .filter(g => g.required && g.options.length > 0)
          .map(g => ({
            groupName: g.name,
            optionName: g.options[0].name,
            price: g.options[0].price
          }))
      );
      setTempNotes("");
    } else {
      addToCartDirect(product, [], "");
    }
  };

  const addToCartDirect = (product: Product, extras: SelectedModifier[], notes: string) => {
    const uniqueId = `${product.id}-${notes}-${JSON.stringify(extras)}`;
    setCart(prev => {
      const existing = prev.find(item => item.uniqueId === uniqueId);
      if (existing) {
        return prev.map(item => 
          item.uniqueId === uniqueId 
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }
      return [...prev, { product, quantity: 1, notes, selectedExtras: extras, uniqueId }];
    });
    // Sin aviso emergente: la cesta flotante ya rebota y actualiza el total.
    setCartTrigger(prev => prev + 1);
  };

  const confirmExtrasAndAdd = () => {
    if (selectedProductForExtras) {
      addToCartDirect(selectedProductForExtras, tempExtras, tempNotes);
      setSelectedProductForExtras(null);
      setTempExtras([]);
      setTempNotes("");
    }
  };

  const handleModifierToggle = (group: ModifierGroup, option: ModifierOption) => {
    setTempExtras(prev => {
      const filtered = prev.filter(e => e.groupName !== group.name);
      
      const isSelected = prev.some(e => e.groupName === group.name && e.optionName === option.name);
      
      if (group.maxSelections === 1) {
        // Excluyente
        return [...filtered, { groupName: group.name, optionName: option.name, price: option.price }];
      } else {
        // Múltiple
        const siblings = prev.filter(e => e.groupName === group.name);
        const alreadySelected = siblings.some(e => e.optionName === option.name);
        
        if (alreadySelected) {
          return prev.filter(e => !(e.groupName === group.name && e.optionName === option.name));
        } else {
          if (siblings.length >= group.maxSelections) {
            // Remueve la primera seleccionada de ese grupo
            const firstOfGroup = siblings[0];
            const clean = prev.filter(e => !(e.groupName === group.name && e.optionName === firstOfGroup.optionName));
            return [...clean, { groupName: group.name, optionName: option.name, price: option.price }];
          }
          return [...prev, { groupName: group.name, optionName: option.name, price: option.price }];
        }
      }
    });
  };

  const removeFromCart = (uniqueId: string) => {
    setCart(prev => prev.filter(item => item.uniqueId !== uniqueId));
  };

  const updateCartQty = (uniqueId: string, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.uniqueId === uniqueId) {
        const newQty = item.quantity + delta;
        return newQty > 0 ? { ...item, quantity: newQty } : null;
      }
      return item;
    }).filter(Boolean) as any);
  };

  const cartTotal = useMemo(() =>
    cart.reduce((sum, item) => {
      const extrasCost = item.selectedExtras.reduce((s, e) => s + e.price, 0);
      return sum + (item.product.price + extrasCost) * item.quantity;
    }, 0),
    [cart]
  );

  const submitOrder = async () => {
    if (cart.length === 0) return;
    setLoading(true);
    setErrorMsg("");
    try {
      const payload = {
        tableId,
        items: cart.map(item => ({
          productId: item.product.id,
          quantity: item.quantity,
          notes: item.notes,
          selectedExtras: item.selectedExtras
        }))
      };

      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        setCart([]);
        toast("Pedido enviado. Ya lo están preparando.", "success");
        setIsCartOpen(false);
        setActiveTab("orders");
        fetchMyOrders();
        fetchTableInfo();
      } else {
        const error = await res.json().catch(() => ({ error: "No se pudo enviar el pedido." }));
        setErrorMsg(error.error || "Fallo al procesar el pedido con el servidor.");
      }
    } catch (err) {
      setErrorMsg("Error de red o conexión al servidor.");
      toast("Error de red o conexión al servidor.", "error");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Clases CSS de ayuda para alérgenos
  const getAllergenEmoji = (allergen: string) => {
    switch (allergen) {
      case "gluten": return "🌾";
      case "lacteos": return "🥛";
      case "frutos_secos": return "🥜";
      case "huevo": return "🥚";
      case "pescado": return "🐟";
      case "soja": return "🫘";
      case "crustaceos": return "🦐";
      case "moluscos": return "🐚";
      case "sulfitos": return "🍷";
      default: return "⚠️";
    }
  };

  const filteredProducts = useMemo(() => {
    if (searchQuery.trim()) {
      return products.filter(p => p.available && fuzzyMatch(p.name + " " + (p.description || ""), searchQuery));
    }
    return products.filter(p => p.categoryId === selectedCategory && p.available);
  }, [products, selectedCategory, searchQuery]);

  const cartQtyMap = useMemo(() => {
    const map: { [key: string]: number } = {};
    cart.forEach(item => {
      map[item.product.id] = (map[item.product.id] || 0) + item.quantity;
    });
    return map;
  }, [cart]);

  return (
    <div className={`flex flex-col min-h-screen font-sans ${cart.length > 0 && activeTab === "menu" ? "pb-48" : "pb-28"}`} id="client_root">

      {/* CABECERA */}
      <header className="cv-header sticky top-0 z-30 px-4 py-3 flex justify-between items-center gap-3">
        <div className="min-w-0 flex-1">
          <span className="cv-eyebrow block">{tableNumber ? "Tu mesa" : "Solo consulta"}</span>
          <h1 className="text-2xl sm:text-3xl truncate">
            {tableInfo ? tableInfo.name : tableNumber ? `Mesa ${tableNumber}` : "Carta digital"}
          </h1>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {hasGlobalNav && (
            <div className="flex items-center gap-1 p-1 rounded-full border-2 border-slate-900" role="tablist" aria-label="Secciones">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "menu"}
                onClick={() => setActiveTab("menu")}
                className={`px-3.5 h-9 rounded-full text-xs font-bold cursor-pointer ${activeTab === "menu" ? "bg-slate-900 text-white" : "text-white"}`}
                id="tab_client_menu"
              >
                Carta
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "orders"}
                onClick={() => { setActiveTab("orders"); fetchMyOrders(); }}
                className={`px-3.5 h-9 rounded-full text-xs font-bold cursor-pointer ${activeTab === "orders" ? "bg-slate-900 text-white" : "text-white"}`}
                id="tab_client_orders"
              >
                Pedidos{activeOrdersCount > 0 ? ` · ${activeOrdersCount}` : ""}
              </button>
            </div>
          )}
          {tableNumber && hasGlobalNav && (
            <button
              type="button"
              onClick={() => setIsCallWaiterModalOpen(true)}
              className="h-11 px-4 rounded-full bg-accent text-black text-xs font-extrabold flex items-center gap-2 cursor-pointer border-2 border-slate-900"
            >
              <BellRing className="w-4 h-4" />
              <span className="hidden sm:inline">Llamar</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsScannerOpen(true)}
            className="w-11 h-11 grid place-items-center rounded-full bg-slate-900 text-white cursor-pointer hover:bg-black"
            aria-label="Escanear el QR de la mesa"
            title="Escanear el QR de la mesa"
          >
            <QrCode className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* CARTA */}
      {activeTab === "menu" && (
        <div className="flex-1 flex flex-col">
          <section className="px-4 sm:px-8 pt-8 pb-7 max-w-6xl mx-auto w-full" aria-hidden="true">
            <p className="cv-eyebrow mb-3">Hoy se come</p>
            <h2 className="cv-hero-title">La <em>carta</em></h2>
          </section>
          <div className="cv-ticker" aria-hidden="true">
            <div className="cv-ticker-track">
              {Array.from({ length: 8 }).map((_, i) => (
                <React.Fragment key={i}>
                  <span>Pide desde tu mesa</span><b>sin esperas</b><span>Directo a cocina</span><b>paga al final</b>
                </React.Fragment>
              ))}
            </div>
          </div>

          {/* BUSCADOR + CATEGORÍAS */}
          <div className="cv-header sticky top-[68px] z-20 border-t-0">
            <div className="max-w-6xl mx-auto w-full px-4 sm:px-8 pt-3">
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                <input
                  type="search"
                  placeholder="Busca un plato o una bebida"
                  aria-label="Buscar en la carta"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="cv-field w-full h-12 !rounded-full pl-11 pr-11 text-sm"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 grid place-items-center rounded-full text-slate-600 hover:text-slate-900 cursor-pointer"
                    aria-label="Borrar búsqueda"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
            <div className="max-w-6xl mx-auto w-full flex gap-2 overflow-x-auto px-4 sm:px-8 py-3 scrollbar-none">
              {categories.map(cat => {
                const isActive = selectedCategory === cat.id && !searchQuery;
                return (
                  <button
                    type="button"
                    key={cat.id}
                    onClick={() => {
                      setSelectedCategory(cat.id);
                      setSearchQuery("");
                    }}
                    className="cv-chip"
                    aria-pressed={isActive}
                    id={`btn_cat_${cat.id}`}
                  >
                    {getCategoryIcon(cat.icon, cat.name)}
                    {cat.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="max-w-6xl mx-auto w-full px-4 sm:px-8">
            {!tableNumber && (
              <div className="cv-note mt-4 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex items-start gap-3 flex-1">
                  <Info className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-bold">Estás viendo la carta sin mesa</p>
                    <p className="text-xs text-slate-700 mt-1 leading-relaxed">
                      Para pedir o llamar al camarero, escanea el QR que hay en tu mesa.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsScannerOpen(true)}
                  className="h-11 px-5 rounded-full bg-slate-900 text-white font-extrabold text-xs flex items-center justify-center gap-2 cursor-pointer"
                >
                  <QrCode className="w-4 h-4" />
                  <span>Escanear QR</span>
                </button>
              </div>
            )}

            {tableNumber && !tableToken && (
              <div className="cv-note mt-4 p-4 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-bold">Falta validar la mesa</p>
                  <p className="text-xs text-slate-700 mt-1 leading-relaxed">Puedes ver la carta, pero para pedir tienes que escanear el QR físico de la mesa.</p>
                </div>
              </div>
            )}

            {tableInfo && tableInfo.status === "pendiente_pago" && (
              <div className="cv-note mt-4 p-4 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-bold">La cuenta ya está pedida</p>
                  <p className="text-xs text-slate-700 mt-1">Si quieres algo más, puedes seguir pidiendo: se añade a la misma cuenta.</p>
                </div>
              </div>
            )}
          </div>

          {/* PRODUCTOS */}
          <motion.main
            key={searchQuery ? "search" : selectedCategory}
            variants={containerVariants}
            initial="hidden"
            animate="show"
            className="px-4 sm:px-8 py-5 max-w-6xl mx-auto w-full flex-1 grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-5 content-start"
          >
            {menuLoading ? (
              <div className="col-span-full flex items-center justify-center gap-2 py-16 text-sm font-semibold" role="status">
                <Loader2 className="w-5 h-5 animate-spin" />
                Cargando la carta
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="col-span-full text-center py-16">
                <p className="text-sm">
                  {searchQuery ? `No hay nada en la carta que coincida con «${searchQuery}».` : "Ahora mismo no hay nada disponible en esta categoría."}
                </p>
              </div>
            ) : (
              filteredProducts.map(p => {
                const inCartQty = cartQtyMap[p.id] || 0;
                const hasOptions = Boolean(p.modifierGroups && p.modifierGroups.length > 0);
                const soldOut = p.stock !== null && p.stock <= 0;
                return (
                <motion.article
                  variants={itemVariants}
                  key={p.id}
                  className="cv-card"
                  data-in-cart={inCartQty > 0 || undefined}
                  id={`product_card_${p.id}`}
                >
                  <div className="cv-card-media">
                    {p.image && p.image !== "default.jpg" ? (
                      <img src={p.image} alt="" loading="lazy" />
                    ) : (
                      getCategoryIcon(categories.find((category) => category.id === p.categoryId)?.icon, p.name)
                    )}
                    {/* Chips de cristal sobre la foto: precio y, si queda poco, cuántas quedan. */}
                    {p.image && p.image !== "default.jpg" && (
                      <div className="cv-chips">
                        <LiquidChip delay={120}>{formatPrice(p.price)}</LiquidChip>
                        {soldOut ? <LiquidChip delay={200} tint="rgba(255,69,58,.45)">Agotado</LiquidChip>
                          : p.stock !== null && p.stock <= 5 ? <LiquidChip delay={200} tint="rgba(255,159,10,.4)">Quedan {p.stock}</LiquidChip> : null}
                      </div>
                    )}
                    {inCartQty > 0 && <LiquidBadge value={inCartQty} className="cv-qty-badge" color="var(--cv-accent, #1f7a4d)" />}
                  </div>

                  <div className="flex-1 min-w-0 flex flex-col justify-between p-3.5 sm:p-4 gap-3">
                    <div>
                      <h3 className="text-xl sm:text-2xl leading-[1]">{p.name}</h3>
                      {p.description && (
                        <p className="text-xs line-clamp-2 mt-1.5 leading-relaxed">{p.description}</p>
                      )}
                      {p.allergens && p.allergens.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2.5" aria-label="Alérgenos">
                          {p.allergens.map(al => (
                            <span key={al} className="cv-allergen">
                              <span aria-hidden="true">{getAllergenEmoji(al)}</span> {al.replace(/_/g, " ")}
                            </span>
                          ))}
                        </div>
                      )}
                      {p.stock !== null && p.stock > 0 && p.stock <= 5 && (
                        <p className="font-mono text-[11px] font-bold !text-indigo-700 mt-2 uppercase">Solo quedan {p.stock}</p>
                      )}
                    </div>

                    <div className="flex justify-between items-center gap-2">
                      <span className="cv-price">{p.price.toFixed(2).replace(".", ",")}<small>€</small></span>
                      <button
                        type="button"
                        disabled={soldOut}
                        onClick={(e) => {
                          triggerFlyParticle(e);
                          handleAddToCart(p);
                        }}
                        className="cv-add disabled:opacity-40 disabled:cursor-not-allowed"
                        id={`btn_add_${p.id}`}
                        aria-label={`${hasOptions ? "Elegir opciones de" : "Añadir"} ${p.name}`}
                      >
                        {soldOut ? "Agotado" : <><Plus />{hasOptions ? "Elegir" : "Añadir"}</>}
                      </button>
                    </div>
                  </div>
                </motion.article>
              );})
            )}
          </motion.main>
        </div>
      )}

      {/* MIS PEDIDOS */}
      {activeTab === "orders" && (
        <main className="px-4 sm:px-8 pt-8 max-w-3xl mx-auto w-full flex-1">
          <p className="cv-eyebrow mb-2">En esta mesa</p>
          <h2 className="text-5xl sm:text-7xl mb-6">Tus pedidos</h2>

          {tableNumber && tableInfo && tableInfo.currentBillTotal > 0 && (
            <div className="glass-panel rounded-2xl p-5 mb-5 flex items-center justify-between gap-4">
              <div>
                <p className="cv-eyebrow">Llevas en la cuenta</p>
                <p className="cv-price !text-4xl mt-1">{tableInfo.currentBillTotal.toFixed(2).replace(".", ",")}<small>€</small></p>
              </div>
              <button
                type="button"
                disabled={callingWaiter}
                onClick={() => handleCallWaiter("cuenta")}
                className="h-12 px-5 rounded-full bg-slate-900 text-white font-extrabold text-sm flex items-center gap-2 cursor-pointer hover:bg-indigo-600 disabled:opacity-60"
              >
                <ReceiptText className="w-4 h-4" />
                Pedir la cuenta
              </button>
            </div>
          )}

          {!tableNumber || myOrders.length === 0 ? (
            <div className="cv-note p-8 text-center" id="empty_orders_state">
              <ShoppingBag className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <p className="text-sm font-semibold text-slate-600">
                {!tableNumber ? "Escanea el QR de tu mesa para pedir y seguir tus pedidos." : "Todavía no has pedido nada."}
              </p>
              <button
                type="button"
                onClick={() => setActiveTab("menu")}
                className="mt-5 h-11 px-5 rounded-full bg-slate-900 text-white text-sm font-extrabold cursor-pointer"
              >
                Ver la carta
              </button>
            </div>
          ) : (
            <motion.div variants={containerVariants} initial="hidden" animate="show" className="space-y-3">
              {myOrders.map((order) => {
                const status = STATUS_COPY[order.status] || STATUS_COPY.pendiente;
                return (
                  <motion.div
                    layout
                    variants={itemVariants}
                    key={order.id}
                    className="cv-note p-4"
                    id={`order_history_card_${order.id}`}
                  >
                    <div className="flex justify-between items-center gap-3 mb-3">
                      <span className="font-mono text-[11px] text-slate-500">
                        {new Date(order.timestamp).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })} · #{order.id.slice(-4).toUpperCase()}
                      </span>
                      <span className={`px-3 py-1 rounded-full text-[11px] font-bold ${status.tone}`}>{status.label}</span>
                    </div>

                    <div className="space-y-1.5">
                      {order.items.map((line: any) => (
                        <div key={line.id} className="flex justify-between items-baseline gap-3 text-sm text-slate-700">
                          <span className="font-medium min-w-0">
                            {line.quantity} × {line.name}
                            {line.selectedExtras && line.selectedExtras.length > 0 && (
                              <span className="block text-xs text-slate-500">
                                {line.selectedExtras.map((e: any) => e.optionName).join(", ")}
                              </span>
                            )}
                          </span>
                          <span className="font-bold text-slate-900 shrink-0 tabular-nums">{line.priceTotal.toFixed(2)} €</span>
                        </div>
                      ))}
                    </div>

                    {order.status !== "cancelado" && (
                      <div className="mt-4 bg-slate-100 h-1.5 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all duration-500 ${status.progress}`} />
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </motion.div>
          )}
        </main>
      )}

      {/* CESTA FLOTANTE */}
      {cart.length > 0 && activeTab === "menu" && (
        <div className="fixed left-4 right-4 z-40 flex justify-center pointer-events-none" style={{ bottom: "calc(96px + env(safe-area-inset-bottom))" }}>
          <motion.button
            key={cartTrigger}
            initial={{ scale: 0.94, y: 6 }}
            animate={{ scale: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 520, damping: 16 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => setIsCartOpen(true)}
            className="cv-basket"
            id="btn_bottom_basket"
          >
            <span className="flex flex-col items-start leading-tight">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-widest opacity-70">Tu cesta</span>
              <span className="text-lg tabular-nums">{cartTotal.toFixed(2).replace(".", ",")} €</span>
            </span>
            <span className="flex items-center gap-3 text-sm">
              Ver y pedir
              <span className="cv-basket-count">{cartCount}</span>
            </span>
          </motion.button>
        </div>
      )}

      {/* MODAL / DRAWER DE CARRITO EN MESA */}
      <AnimatePresence>
        {isCartOpen && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-end justify-center" role="dialog" aria-modal="true" aria-labelledby="cart-modal-title">
            {/* Backdrop click close */}
            <div className="absolute inset-0" onClick={() => setIsCartOpen(false)} />
            
            <motion.div 
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 220 }}
              ref={cartTrapRef}
              className="bg-white rounded-t-2xl w-full max-w-md p-5 pb-6 shadow-2xl relative z-10 flex flex-col max-h-[85vh]"
              id="basket_drawer_modal"
            >
              {/* Header Drawer */}
              <div className="flex justify-between items-center border-b border-slate-100 pb-3 mb-4">
                <div>
                    <h2 className="text-base font-extrabold text-slate-900 flex items-center space-x-2" id="cart-modal-title">
                      <ShoppingBag className="w-5 h-5 text-indigo-600" />
                      <span>Tu cesta</span>
                  </h2>
                  <p className="text-[10px] text-slate-500">Repásala antes de pedir</p>
                </div>
                <button 
                  onClick={() => setIsCartOpen(false)}
                  className="p-1 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 cursor-pointer" aria-label="Cerrar carrito" data-close-modal
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Error block */}
              {errorMsg && (
                <div className="p-2.5 bg-red-50 border border-red-100 rounded-lg mb-3 flex items-start space-x-1.5 text-xs text-red-600">
                  <span className="font-bold">Error:</span>
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* Items List inside Drawer */}
              <div className="flex-1 overflow-y-auto space-y-3.5 pr-1 max-h-[40vh] my-2">
                {cart.map((item) => {
                  const extrasCost = item.selectedExtras.reduce((s, e) => s + e.price, 0);
                  const basePlusExtras = item.product.price + extrasCost;

                  return (
                    <div 
                      key={item.uniqueId} 
                      className="flex justify-between items-start pb-3 border-b border-slate-50 text-xs"
                      id={`cart_item_row_${item.product.id}`}
                    >
                      <div className="flex-1 min-w-0 pr-2">
                        <p className="font-bold text-slate-900">{item.product.name}</p>
                        
                        {item.selectedExtras.length > 0 && (
                          <div className="text-[10px] text-indigo-500 mt-0.5 space-y-0.5">
                            {item.selectedExtras.map((e, index) => (
                              <span key={index} className="block">• {e.groupName}: {e.optionName} {e.price > 0 && `(+${e.price.toFixed(2)}€)`}</span>
                            ))}
                          </div>
                        )}
                        
                        {item.notes && (
                          <p className="text-[10px] font-mono bg-amber-50 text-amber-700 px-2 py-0.5 rounded mt-1.5 inline-block">
                            📝 {item.notes}
                          </p>
                        )}
                      </div>

                      {/* Controladores +/- y Precio */}
                      <div className="flex flex-col items-end shrink-0 space-y-2">
                        <span className="font-extrabold text-slate-900">{(basePlusExtras * item.quantity).toFixed(2)}€</span>
                        
                        <div className="flex items-center space-x-1.5 border border-slate-200 rounded-lg p-1 bg-slate-50">
                          <button
                            type="button"
                            onClick={() => updateCartQty(item.uniqueId, -1)}
                            className="w-8 h-8 sm:w-9 sm:h-9 bg-white rounded flex items-center justify-center font-bold hover:bg-slate-200 text-slate-600 active:scale-95 transition"
                            aria-label="Reducir cantidad"
                          >
                            -
                          </button>
                          <span className="font-black text-xs px-1 select-none">{item.quantity}</span>
                          <button
                            type="button"
                            onClick={() => updateCartQty(item.uniqueId, 1)}
                            className="w-8 h-8 sm:w-9 sm:h-9 bg-white rounded flex items-center justify-center font-bold hover:bg-slate-200 text-slate-600 active:scale-95 transition"
                            aria-label="Aumentar cantidad"
                          >
                            +
                          </button>
                          <button
                            type="button"
                            onClick={() => removeFromCart(item.uniqueId)}
                            className="w-8 h-8 sm:w-9 sm:h-9 bg-white rounded flex items-center justify-center text-rose-600 hover:bg-rose-50 active:scale-95 transition"
                            aria-label="Eliminar producto"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Botón de notas rápidas */}
              <div className="border-t border-slate-100 pt-3 mt-4">
                <div className="bg-slate-50 p-3 rounded-xl flex items-center space-x-2 justify-between">
                  <div>
                    <span className="text-[10px] font-bold text-slate-500 block">Pago</span>
                    <span className="text-xs font-semibold text-slate-700">Pagas al final, al camarero</span>
                  </div>
                  <span className="text-xs bg-olive/10 text-olive font-bold px-2 py-1 rounded inline-flex items-center">
                    Una cuenta por mesa
                  </span>
                </div>
              </div>

              {/* Enviar pedido */}
              <div className="mt-5 pt-3 border-t border-slate-100 space-y-4">
                <div className="flex justify-between items-baseline">
                  <span className="text-xs font-bold text-slate-500">Total de este pedido</span>
                  <span className="text-lg font-black text-slate-900">{cartTotal.toFixed(2)}€</span>
                </div>

                <motion.button
                  whileTap={{ scale: 0.96 }}
                  type="button"
                  disabled={loading || !canOrder}
                  onClick={submitOrder}
                  className="w-full h-14 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-extrabold text-base rounded-full flex justify-center items-center gap-2 cursor-pointer"
                  id="btn_send_kitchen"
                >
                  {loading ? (
                    <span>Enviando…</span>
                  ) : !canOrder ? (
                    <span>Escanea el QR físico de tu mesa para pedir</span>
                  ) : (
                    <>
                      <span>Pedir ahora</span>
                    </>
                  )}
                </motion.button>
              </div>

            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selectedProductForExtras && (
          <div 
            className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in" 
            role="dialog" 
            aria-modal="true" 
            aria-labelledby="modifier-modal-title"
          >
            {/* Backdrop click close */}
            <div className="absolute inset-0" onClick={() => setSelectedProductForExtras(null)} />

            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 220 }}
              ref={modifierTrapRef}
              className="bg-white rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md shadow-2xl relative max-h-[85vh] flex flex-col z-10 overflow-hidden"
              id="modifier_modal"
            >
              <div className="cv-card-media !aspect-auto h-32 shrink-0">
                {getCategoryIcon(categories.find((category) => category.id === selectedProductForExtras.categoryId)?.icon, selectedProductForExtras.name)}
                <button
                  type="button"
                  onClick={() => setSelectedProductForExtras(null)}
                  data-close-modal
                  aria-label="Cerrar"
                  className="absolute top-3 right-3 w-10 h-10 grid place-items-center bg-slate-900 text-white rounded-full cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-5 flex-1 overflow-y-auto pr-3">
                <h3 className="font-black text-slate-800 text-base mb-1" id="modifier-modal-title">
                  {selectedProductForExtras.name}
                </h3>
                <p className="text-[11px] text-slate-400 mb-5 leading-normal">{selectedProductForExtras.description || "Personaliza los ingredientes adicionales o el punto de cocción de tu plato a continuación."}</p>

                <div className="space-y-5">
                  {selectedProductForExtras.modifierGroups?.map((group) => (
                    <div key={group.id} className="border-b border-slate-100 pb-4" id={`modifier_group_${group.id}`}>
                      <div className="flex justify-between items-baseline mb-2.5">
                        <span className="text-[11px] font-black text-slate-800 uppercase tracking-wider flex items-center gap-1">
                          {group.name} {group.required && <span className="text-red-500 font-bold">*</span>}
                        </span>
                        <span className="text-[9px] bg-slate-100 text-slate-500 font-black uppercase px-2 py-0.5 rounded-full">
                          {group.maxSelections === 1 ? "Única opción" : `Hasta ${group.maxSelections}`}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        {group.options.map((opt) => {
                          const isSelected = tempExtras.some(
                            e => e.groupName === group.name && e.optionName === opt.name
                          );
                          return (
                            <motion.button
                              whileTap={{ scale: 0.97 }}
                              type="button"
                              key={opt.id}
                              onClick={() => handleModifierToggle(group, opt)}
                              className={`flex flex-col justify-between p-2.5 rounded-xl border-2 text-left transition cursor-pointer min-h-[60px] ${
                                isSelected 
                                  ? "bg-indigo-50/50 border-indigo-600 text-indigo-950 font-bold shadow-xxs" 
                                  : "bg-white border-slate-100 text-slate-650 hover:bg-slate-50 hover:border-slate-200"
                              }`}
                              id={`option_modifier_${opt.id}`}
                            >
                              <div className="flex items-center justify-between w-full">
                                <span className={`text-[11px] ${isSelected ? 'font-extrabold text-indigo-950' : 'font-medium'}`}>{opt.name}</span>
                                {isSelected && (
                                  <Check className="w-3.5 h-3.5 text-indigo-600 shrink-0 animate-bounce" />
                                )}
                              </div>
                              <span className={`text-[9px] mt-1 ${isSelected ? 'text-indigo-600 font-bold' : 'text-slate-400'}`}>
                                {opt.price > 0 ? `+${opt.price.toFixed(2)}€` : "Gratis"}
                              </span>
                            </motion.button>
                          );
                        })}
                      </div>
                    </div>
                  ))}

                  {/* Campo de notas especiales */}
                  <div className="pb-4">
                    <span className="text-[11px] font-black text-slate-800 uppercase tracking-wider block mb-2">
                      Notas especiales / Alergias
                    </span>
                    <textarea
                      rows={2}
                      value={tempNotes}
                      onChange={(e) => setTempNotes(e.target.value)}
                      placeholder="Ej. Sin sal, salsa aparte, bien hecho..."
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-700 outline-none focus:border-indigo-400 focus:bg-white resize-none transition"
                      id="input_modifier_notes"
                    />
                  </div>
                </div>
              </div>

              {/* Sticky footer actions */}
              <div className="p-4 bg-slate-50 border-t border-slate-100 flex space-x-3 shrink-0">
                <motion.button
                  whileTap={{ scale: 0.96 }}
                  type="button"
                  onClick={() => setSelectedProductForExtras(null)}
                  className="flex-1 bg-white hover:bg-slate-100 text-slate-600 font-bold text-xs py-3 rounded-xl border border-slate-200 text-center cursor-pointer transition"
                >
                  Cancelar
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.96 }}
                  type="button"
                  onClick={confirmExtrasAndAdd}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs py-3 rounded-xl text-center cursor-pointer transition shadow-md"
                  id="btn_confirm_modifiers"
                >
                  Añadir plato
                </motion.button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* NAVEGACIÓN DEL CLIENTE: LiquidBar con la campana como acción separada */}
      {!hasGlobalNav && (
        <LiquidBar
          id="client_nav"
          ariaLabel="Carta y pedidos"
          items={[
            { key: "menu", label: "Carta", icon: Utensils },
            { key: "orders", label: "Pedidos", icon: ListTodo, badge: activeOrdersCount || undefined }
          ]}
          selectedKey={activeTab}
          onSelect={(key) => {
            setActiveTab(key as "menu" | "orders");
            if (key === "orders") fetchMyOrders();
            window.scrollTo({ top: 0 });
          }}
          action={tableNumber ? { label: "Llamar al camarero", icon: BellRing, onClick: () => setIsCallWaiterModalOpen(true), tinted: true } : undefined}
        />
      )}

      {/* MODAL SCANNER QR */}
      <AnimatePresence>
        {isScannerOpen && (
          <div className="fixed inset-0 bg-black/80 z-50 flex flex-col items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              ref={scannerTrapRef}
              className="bg-white rounded-2xl w-full max-w-md p-5 shadow-2xl flex flex-col relative"
            >
              <button
                onClick={closeScanner}
                data-close-modal
                className="absolute top-3 right-3 text-slate-400 hover:text-slate-655 font-extrabold text-lg p-1 cursor-pointer"
                aria-label="Cerrar Escáner"
              >
                ✕
              </button>
              
              <h3 className="font-extrabold text-slate-900 text-sm mb-2 text-center">
                Escanea el QR de tu mesa
              </h3>
              <p className="text-[11px] text-slate-500 mb-4 text-center">
                Apunta con la cámara al código de la mesa.
              </p>
              
              {/* Contenedor del escáner */}
              <div 
                id="qr-reader" 
                className="w-full overflow-hidden rounded-xl bg-slate-50 border border-slate-200"
                style={{ minHeight: "250px" }}
              />
              
              {scannerError && (
                <p className="text-[10px] text-red-500 font-semibold mt-2 text-center">
                  ⚠️ {scannerError}
                </p>
              )}

              <button
                onClick={closeScanner}
                className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2.5 rounded-lg text-center cursor-pointer mt-4 text-xs"
              >
                Cancelar
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL LLAMAR AL CAMARERO */}
      <AnimatePresence>
        {isCallWaiterModalOpen && (
          <div 
            className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" 
            role="dialog" 
            aria-modal="true" 
          >
            <div className="absolute inset-0" onClick={() => setIsCallWaiterModalOpen(false)} />
            <motion.div
              initial={isMobile ? { y: "100%" } : { scale: 0.95, opacity: 0 }}
              animate={isMobile ? { y: 0 } : { scale: 1, opacity: 1 }}
              exit={isMobile ? { y: "100%" } : { scale: 0.95, opacity: 0 }}
              transition={isMobile ? { type: "spring", damping: 25, stiffness: 220 } : { duration: 0.15 }}
              ref={waiterCallTrapRef}
              className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-6 shadow-2xl relative max-h-[90vh] flex flex-col z-10"
            >
              <h3 className="text-xl text-slate-900 mb-2">¿Qué necesitas?</h3>
              <p className="text-xs text-slate-500 mb-4">Así el camarero ya sabe a qué va.</p>
              
              <div className="grid grid-cols-2 gap-3 mb-6">
                <button
                  type="button"
                  disabled={callingWaiter}
                  onClick={() => handleCallWaiter("cuenta")}
                  className="p-4 bg-slate-50 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-300 rounded-xl flex flex-col items-center justify-center gap-1.5 transition cursor-pointer text-center"
                >
                  <span className="text-2xl">🧾</span>
                  <span className="text-xs font-bold text-slate-800">Pedir la Cuenta</span>
                </button>
                <button
                  type="button"
                  disabled={callingWaiter}
                  onClick={() => handleCallWaiter("ayuda")}
                  className="p-4 bg-slate-50 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-300 rounded-xl flex flex-col items-center justify-center gap-1.5 transition cursor-pointer text-center"
                >
                  <span className="text-2xl">🙋‍♂️</span>
                  <span className="text-xs font-bold text-slate-800">Necesito Ayuda</span>
                </button>
                <button
                  type="button"
                  disabled={callingWaiter}
                  onClick={() => handleCallWaiter("cubiertos")}
                  className="p-4 bg-slate-50 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-300 rounded-xl flex flex-col items-center justify-center gap-1.5 transition cursor-pointer text-center"
                >
                  <span className="text-2xl">🍴</span>
                  <span className="text-xs font-bold text-slate-800">Traer Cubiertos</span>
                </button>
                <button
                  type="button"
                  disabled={callingWaiter}
                  onClick={() => handleCallWaiter("limpieza")}
                  className="p-4 bg-slate-50 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-300 rounded-xl flex flex-col items-center justify-center gap-1.5 transition cursor-pointer text-center"
                >
                  <span className="text-2xl">🧼</span>
                  <span className="text-xs font-bold text-slate-800">Limpieza / Retirar</span>
                </button>
                <button
                  type="button"
                  disabled={callingWaiter}
                  onClick={() => handleCallWaiter("duda")}
                  className="p-4 bg-slate-50 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-300 rounded-xl flex flex-col items-center justify-center col-span-2 gap-1.5 transition cursor-pointer text-center"
                >
                  <span className="text-2xl">📖</span>
                  <span className="text-xs font-bold text-slate-800">Duda sobre la Carta</span>
                </button>
              </div>
              
              <button
                type="button"
                onClick={() => setIsCallWaiterModalOpen(false)}
                data-close-modal
                className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3 rounded-xl text-xs transition cursor-pointer"
              >
                Cancelar
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* PARTÍCULAS VOLADORAS DEL CARRITO */}
      {flyingParticles.map(p => (
        <motion.div
          key={p.id}
          initial={{ x: 0, y: 0, opacity: 1, scale: 1.4 }}
          animate={{
            x: [0, -50, window.innerWidth / 2 - p.x],
            y: [0, -150, window.innerHeight - 80 - p.y],
            opacity: [1, 0.9, 0],
            scale: [1.4, 1.1, 0.4]
          }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          style={{ left: p.x, top: p.y }}
          className="fixed pointer-events-none z-50 rounded-full w-4 h-4 bg-slate-900"
          aria-hidden="true"
        />
      ))}
    </div>
  );
}
