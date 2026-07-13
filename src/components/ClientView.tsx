/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from "react";
import { 
  motion, AnimatePresence 
} from "motion/react";
import { 
  Utensils, Beef, GlassWater, IceCream, ShoppingBag, Info, 
  ChevronDown, MessageSquare, Check, X, Bell, ListTodo, AlertTriangle, RefreshCw, QrCode
} from "lucide-react";
import { useToast } from "./ToastProvider";
import { Category, Product, ModifierGroup, ModifierOption, SelectedModifier, Table } from "../types";
import { Html5Qrcode } from "html5-qrcode";

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
      if (tWord.includes(qWord) || qWord.includes(tWord)) return true;
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
  onUnlockRoles?: () => void;
  isKioskMode?: boolean;
}

export default function ClientView({ tableNumber, onUnlockRoles, isKioskMode = false }: ClientViewProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [tableInfo, setTableInfo] = useState<Table | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>("cat-1");
  const [cart, setCart] = useState<Array<{
    product: Product;
    quantity: number;
    notes: string;
    selectedExtras: SelectedModifier[];
    uniqueId: string;
  }>>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"menu" | "orders">("menu");
  const [myOrders, setMyOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const { toast } = useToast();
  const [cartTrigger, setCartTrigger] = useState(0);
  const [flyingParticles, setFlyingParticles] = useState<Array<{ id: number; x: number; y: number }>>([]);
  const [searchQuery, setSearchQuery] = useState("");

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

  const handleCallWaiter = async (reason: "cuenta" | "ayuda" | "cubiertos" | "limpieza" | "duda") => {
    if (!tableNumber) return;
    setCallingWaiter(true);
    try {
      const res = await fetch("/api/waiter-calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableId: tableNumber, reason })
      });
      if (res.ok) {
        toast("🛎️ Camarero avisado. ¡Enseguida irá a tu mesa!", "success");
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
        window.location.href = currentUrl.toString(); // Forzar recarga con redirección limpia
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
    let qrScanner: Html5Qrcode | null = null;
    if (isScannerOpen) {
      setScannerError("");
      const timer = setTimeout(() => {
        const scannerElement = document.getElementById("qr-reader");
        if (scannerElement) {
          qrScanner = new Html5Qrcode("qr-reader");
          qrScanner.start(
            { facingMode: "environment" },
            {
              fps: 10,
              qrbox: (width, height) => {
                const size = Math.min(width, height) * 0.7;
                return { width: size, height: size };
              }
            },
            (decodedText) => {
              handleDecodedQR(decodedText);
            },
            (errorMessage) => {
              console.log("Scanner loop:", errorMessage);
            }
          ).catch(err => {
            console.error("Fallo al iniciar cámara:", err);
            setScannerError("No se pudo acceder a la cámara. Por favor, concede permisos.");
          });
        }
      }, 300);

      return () => {
        clearTimeout(timer);
        if (qrScanner && qrScanner.isScanning) {
          qrScanner.stop().catch(err => console.error("Error deteniendo escáner:", err));
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

  useEffect(() => {
    fetchMenu();
    if (tableNumber) {
      fetchTableInfo();
      const interval = setInterval(async () => {
        await fetchTableInfo();
        fetchMyOrders();
      }, 4000); // Polling rápido para estado del pedido en tiempo real
      return () => clearInterval(interval);
    }
  }, [tableNumber]);

  useEffect(() => {
    if (activeTab === "orders") {
      fetchMyOrders();
    }
  }, [activeTab]);

  const fetchMenu = async () => {
    try {
      const [resCat, resProd] = await Promise.all([
        fetch("/api/categories"),
        fetch("/api/products")
      ]);
      if (resCat.ok && resProd.ok) {
        setCategories(await resCat.json());
        const prodData: Product[] = await resProd.json();
        setProducts(prodData);
        // Autoseleccionar la primera disponible
        if (prodData.length > 0) {
          const firstAvailableCat = prodData.find(p => p.available)?.categoryId;
          if (firstAvailableCat) setSelectedCategory(firstAvailableCat);
        }
      }
    } catch (err) {
      console.error(err); toast("Error al cargar el menú. Verifica tu conexión.", "error");
    }
  };

  const fetchTableInfo = async () => {
    if (!tableId) return;
    try {
      const res = await fetch("/api/tables");
      if (res.ok) {
        const tables: Table[] = await res.json();
        const current = tables.find(t => t.id === tableId);
        if (current) {
          setTableInfo(current);
        }
      }
    } catch (err) {
      console.error(err); toast("Error al obtener información de la mesa.", "error");
    }
  };

  const fetchMyOrders = async () => {
    if (!tableId) return;
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

  const getCategoryIcon = (iconName?: string) => {
    switch (iconName) {
      case "Utensils": return <Utensils className="w-5 h-5" />;
      case "Beef": return <Beef className="w-5 h-5" />;
      case "GlassWater": return <GlassWater className="w-5 h-5" />;
      case "IceCream": return <IceCream className="w-5 h-5" />;
      default: return <Utensils className="w-5 h-5" />;
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
    setCartTrigger(prev => prev + 1);
    toast(`"${product.name}" añadido`, "success");
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
        toast("✅ Pedido enviado a cocina/barra correctamente.", "success");
        setIsCartOpen(false);
        setActiveTab("orders");
        fetchMyOrders();
        fetchTableInfo();
      } else {
        const error = await res.json();
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
    <div className={`flex flex-col min-h-screen bg-slate-50 text-slate-900 font-sans pb-24 sm:pb-4 ${cart.length > 0 ? 'pb-36 sm:pb-20' : ''}`} id="client_root">
      


      {/* HEADER CLIENTE */}
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-slate-200 px-4 py-2.5 flex justify-between items-center shadow-xs">
        <div className="min-w-0 flex-1 pr-2">
          <span className="text-[10px] font-mono text-indigo-600 font-bold tracking-wider block uppercase">
            {tableNumber ? "Pedidos Mesa QR" : "Carta Online"}
          </span>
          <h1 className="text-base sm:text-lg font-extrabold text-slate-800 tracking-tight flex items-center truncate">
            📍 {tableInfo ? tableInfo.name : tableNumber ? `Mesa ${tableNumber}` : "Carta Digital (Consulta)"}
          </h1>
        </div>
        <div className="flex items-center space-x-1.5 shrink-0">
          {tableNumber && (
            <button 
              type="button"
              onClick={() => setIsCallWaiterModalOpen(true)}
              className="px-3.5 py-2 bg-amber-500 hover:bg-amber-600 border border-amber-500 hover:border-amber-650 text-slate-950 font-bold rounded-xl transition cursor-pointer flex items-center justify-center shrink-0 min-h-[38px] space-x-1 shadow-sm"
              title="Llamar al Camarero"
            >
              <span>🛎️</span>
              <span className="hidden xs:inline text-xs font-black">Llamar</span>
            </button>
          )}

          <button 
            type="button"
            onClick={() => setIsScannerOpen(true)}
            className="p-2 bg-slate-100 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-200 text-slate-700 hover:text-indigo-600 rounded-xl transition cursor-pointer flex items-center justify-center shrink-0 min-h-[38px] min-w-[38px]"
            title="Escanear QR de Mesa"
          >
            <QrCode className="w-5 h-5" />
          </button>

          <div className="hidden sm:flex items-center space-x-1.5 shrink-0">
          <button 
            type="button"
            onClick={() => setActiveTab("menu")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition min-h-[38px] ${
              activeTab === "menu" ? "bg-slate-950 text-white" : "bg-slate-100 hover:bg-slate-200 text-slate-650"
            }`}
            id="tab_client_menu"
          >
            Carta
          </button>
          
          <button 
            type="button"
            onClick={() => {
              setActiveTab("orders");
              fetchMyOrders();
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold relative transition min-h-[38px] ${
              activeTab === "orders" ? "bg-indigo-600 text-white" : "bg-indigo-50 text-indigo-600 hover:bg-indigo-100"
            }`}
            id="tab_client_orders"
          >
            Pedidos
            {myOrders.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center font-bold shadow-xs">
                {myOrders.length}
              </span>
            )}
          </button>
        </div>
        </div>
      </header>

      {/* VISTA PRINCIPAL: CARTA */}
      {activeTab === "menu" && (
        <div className="flex-1 flex flex-col">
          {/* BUSCADOR FUZZY */}
          <div className="bg-white px-4 pt-3 pb-1.5 border-b border-slate-100 sticky top-[61px] z-20">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs">🔍</span>
              <input
                type="text"
                placeholder="Busca platos... (ej. hamburguesa, tarta, patatas)"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-8 pr-8 py-2 text-xs text-slate-800 outline-none focus:border-indigo-400 focus:bg-white transition"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-650 text-xs font-bold"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* CATEGORÍAS CIRCULARES */}
          <section className="bg-white py-3 border-b border-slate-200 sticky top-[110px] z-20 relative">
            <div className="absolute left-0 top-0 bottom-0 w-6 bg-gradient-to-r from-white to-transparent pointer-events-none z-10" />
            <div className="absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-white to-transparent pointer-events-none z-10" />

            <div className="flex space-x-4 overflow-x-auto px-6 py-1.5 scrollbar-none snap-x">
              {categories.map(cat => {
                const isActive = selectedCategory === cat.id && !searchQuery;
                return (
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    key={cat.id}
                    onClick={() => {
                      setSelectedCategory(cat.id);
                      setSearchQuery(""); // Reset search when clicking category
                    }}
                    className="flex flex-col items-center space-y-1.5 snap-start focus:outline-none min-w-[72px] cursor-pointer"
                    id={`btn_cat_${cat.id}`}
                    aria-label={`Categoría ${cat.name}`}
                  >
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200 ${
                      isActive 
                        ? "bg-indigo-600 text-white shadow-md ring-4 ring-indigo-100 scale-105" 
                        : "bg-slate-50 border border-slate-200 text-slate-500 hover:border-slate-350"
                    }`}>
                      {getCategoryIcon(cat.icon)}
                    </div>
                    <span className={`text-[10px] font-black uppercase tracking-wider text-center ${
                      isActive ? "text-indigo-600 font-extrabold" : "text-slate-500 font-bold"
                    }`}>
                      {cat.name}
                    </span>
                  </motion.button>
                );
              })}
            </div>
          </section>

          {/* MODO CONSULTA / SIN MESA */}
          {!tableNumber && (
            <div className="mx-4 mt-3 p-4 bg-indigo-50 border border-indigo-200 rounded-2xl flex flex-col gap-3 shadow-xs">
              <div className="flex items-start space-x-2.5">
                <Info className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-extrabold text-indigo-900 uppercase tracking-wider">Modo Solo Consulta</p>
                  <p className="text-[11px] text-indigo-750 mt-1 leading-relaxed">
                    Estás viendo la carta digital. Para poder realizar pedidos, llamar al camarero o pagar tu cuenta, escanea el código QR físico de tu mesa.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsScannerOpen(true)}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 cursor-pointer shadow-md active:scale-98 transition"
              >
                <QrCode className="w-4 h-4" />
                <span>Escanear QR de Mesa</span>
              </button>
            </div>
          )}

          {/* MENSAJE DE MESA OCUPADA */}
          {tableInfo && tableInfo.status === "pendiente_pago" && (
            <div className="mx-4 mt-3 p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start space-x-2">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-amber-800">Mesa pendiente de cobro</p>
                <p className="text-[11px] text-amber-600 mt-0.5">La cuenta está lista para abonar. Todavía puedes añadir platos adicionales si lo deseas.</p>
              </div>
            </div>
          )}

          {/* PRODUCTOS LIST */}
          <motion.main 
            key={selectedCategory}
            variants={containerVariants}
            initial="hidden"
            animate="show"
            className="p-3.5 sm:p-4 space-y-4 max-w-lg mx-auto w-full flex-1"
          >
            {filteredProducts.length === 0 ? (
              <div className="text-center py-12 text-slate-500">
                <p className="text-sm">No hay productos disponibles en esta categoría.</p>
              </div>
            ) : (
              filteredProducts.map(p => {
                const inCartQty = cartQtyMap[p.id] || 0;
                return (
                <motion.div
                  variants={itemVariants}
                  key={p.id}
                  className={`rounded-xl border-2 p-3 flex gap-3 shadow-xs transition-all duration-300 ${
                    inCartQty > 0 
                      ? "bg-indigo-50/50 border-indigo-400 shadow-indigo-100" 
                      : "bg-white border-slate-100 hover:border-slate-200"
                  }`}
                  id={`product_card_${p.id}`}
                >
                  <div className="w-16 h-16 sm:w-20 sm:h-20 bg-indigo-50 border border-indigo-100 text-indigo-500 rounded-lg shrink-0 flex items-center justify-center font-bold text-base sm:text-lg pointer-events-none relative">
                    🍽️
                    {inCartQty > 0 && (
                      <span className="absolute -top-2 -right-2 w-5 h-5 bg-indigo-600 text-white text-[10px] font-black rounded-full flex items-center justify-center shadow-md">{inCartQty}</span>
                    )}
                  </div>

                  <div className="flex-1 min-w-0 flex flex-col justify-between">
                    <div>
                      <div className="flex justify-between items-start">
                        <h3 className="font-bold text-sm text-slate-900 truncate">{p.name}</h3>
                        <span className="font-extrabold text-sm text-slate-900 shrink-0 ml-1">
                          {p.price.toFixed(2)}€
                        </span>
                      </div>
                      
                      <p className="text-slate-500 text-xs line-clamp-2 mt-1 leading-relaxed">
                        {p.description}
                      </p>

                      {/* Alérgenos */}
                      {p.allergens && p.allergens.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {p.allergens.map(al => (
                            <span 
                              key={al} 
                              className="inline-flex items-center text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-600 font-medium"
                              title={al}
                            >
                              {getAllergenEmoji(al)} {al}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex justify-between items-center mt-3 pt-2 border-t border-slate-50 gap-2">
                      <span className="text-[10px] truncate min-w-0">
                        {p.stock !== null ? (
                          p.stock <= 5 ? (
                            <span className="text-red-500 font-bold">¡Sólo {p.stock}!</span>
                          ) : (
                            <span className="text-slate-500">Quedan {p.stock}</span>
                          )
                        ) : (
                          <span className="text-emerald-500 font-medium">● En cocina</span>
                        )}
                      </span>

                      <motion.button
                        whileTap={{ scale: 0.96 }}
                        onClick={(e) => {
                          triggerFlyParticle(e);
                          handleAddToCart(p);
                        }}
                        className={`font-bold text-[11px] sm:text-xs px-2.5 sm:px-3 py-2 sm:py-2.5 rounded-lg transition flex items-center space-x-1 cursor-pointer shrink-0 ${
                          inCartQty > 0 
                            ? "bg-indigo-600 text-white hover:bg-indigo-700" 
                            : "bg-slate-950 text-white hover:bg-indigo-600"
                        }`}
                        id={`btn_add_${p.id}`}
                      >
                        <span>{inCartQty > 0 ? `Añadir (+${inCartQty})` : "Añadir"}</span>
                        {p.modifierGroups && p.modifierGroups.length > 0 && (
                          <span className="text-[9px] text-indigo-300 font-medium">+</span>
                        )}
                      </motion.button>
                    </div>

                  </div>
                </motion.div>
              );})
            )}
          </motion.main>
        </div>
      )}

      {/* VISTA PRINCIPAL: MIS PEDIDOS (LOGS) */}
      {activeTab === "orders" && (
        <main className="p-4 max-w-lg mx-auto w-full flex-1">
          <h2 className="text-base font-extrabold tracking-tight text-slate-800 mb-3 flex items-center space-x-1.5">
            <ListTodo className="w-5 h-5 text-indigo-600" />
            <span>Seguimiento de Comandas</span>
          </h2>
          
          <p className="text-xs text-slate-500 mb-6 leading-relaxed">
            Aquí puedes ver las comandas solicitadas en tu sesión actual. El chef las recibe en cocina de manera inmediata.
          </p>

          {!tableNumber ? (
            <div className="bg-white rounded-xl border border-slate-100 p-8 text-center" id="empty_orders_state">
              <ShoppingBag className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <p className="text-xs font-semibold text-slate-500">Debes escanear el código QR de tu mesa para realizar y ver tus pedidos.</p>
              <button 
                type="button"
                onClick={() => setActiveTab("menu")}
                className="mt-4 bg-slate-900 text-white text-xs px-4 py-2 rounded-lg font-bold hover:bg-indigo-600 transition"
              >
                Volver a la carta
              </button>
            </div>
          ) : myOrders.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-100 p-8 text-center" id="empty_orders_state">
              <ShoppingBag className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <p className="text-xs font-semibold text-slate-500">Aún no has hecho ningún pedido</p>
              <button 
                type="button"
                onClick={() => setActiveTab("menu")}
                className="mt-4 bg-slate-900 text-white text-xs px-4 py-2 rounded-lg font-bold hover:bg-indigo-600 transition"
              >
                Ver carta para pedir
              </button>
            </div>
          ) : (
            <motion.div 
              variants={containerVariants}
              initial="hidden"
              animate="show"
              className="space-y-4"
            >
              {myOrders.map((order) => {
                const isCompleted = order.status === "servido";
                const isCancelled = order.status === "cancelado";
                const isCooking = order.status === "en_preparacion";
                const isReady = order.status === "listo";
                const isPending = order.status === "pendiente";

                return (
                  <motion.div 
                    layout
                    variants={itemVariants}
                    key={order.id} 
                    className="bg-white p-4 rounded-xl border border-slate-100 shadow-xs"
                    id={`order_history_card_${order.id}`}
                  >
                    <div className="flex justify-between items-start border-b border-slate-50 pb-2 mb-2">
                      <div>
                        <span className="text-[10px] font-mono text-slate-500">ID: #{order.id.slice(-6).toUpperCase()}</span>
                        <p className="text-xs text-slate-500">{new Date(order.timestamp).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</p>
                      </div>

                      {/* Estado visual Badge */}
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wider ${
                        isPending ? "bg-amber-100 text-amber-700" :
                        isCooking ? "bg-indigo-100 text-indigo-700 animate-pulse" :
                        isReady ? "bg-emerald-100 text-emerald-800 animate-bounce" :
                        isCompleted ? "bg-slate-100 text-slate-500" : "bg-red-100 text-red-600"
                      }`}>
                        {isPending && "⚙️ Pendiente"}
                        {isCooking && "🔥 En preparación"}
                        {isReady && "🔔 Listo para servir"}
                        {isCompleted && "✓ Servido"}
                        {isCancelled && "✗ Cancelado"}
                      </span>
                    </div>

                    {/* Platos */}
                    <div className="space-y-1.5 py-1">
                      {order.items.map((line: any) => (
                        <div key={line.id} className="flex justify-between items-baseline text-xs text-slate-700">
                          <span className="font-medium">
                            {line.quantity}x {line.name}
                            {line.selectedExtras && line.selectedExtras.length > 0 && (
                              <span className="block text-[10px] text-slate-500 italic">
                                (+ {line.selectedExtras.map((e: any) => e.optionName).join(", ")})
                              </span>
                            )}
                          </span>
                          <span className="font-extrabold text-slate-900 shrink-0">{line.priceTotal.toFixed(2)}€</span>
                        </div>
                      ))}
                    </div>

                    {/* Total y barra de progreso */}
                    <div className="mt-3 pt-3 border-t border-slate-50 flex justify-between items-center">
                      <span className="text-xs font-semibold text-slate-500">Monto total pedido</span>
                      <span className="text-sm font-black text-indigo-600">{order.totalAmount.toFixed(2)}€</span>
                    </div>

                    {/* Barra de progreso visual */}
                    {!isCancelled && (
                      <div className="mt-3.5 bg-slate-100 h-1.5 rounded-full overflow-hidden flex">
                        <div className={`h-full transition-all duration-500 ${
                          isPending ? "w-[25%] bg-amber-400" :
                          isCooking ? "w-[60%] bg-indigo-500" :
                          isReady ? "w-[90%] bg-emerald-500" : "w-full bg-slate-400"
                        }`} />
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </motion.div>
          )}
        </main>
      )}

      {/* FLOAT BAR DE BOTÓN DE COMPRA (CARRITO) */}
      {cart.length > 0 && activeTab === "menu" && (
        <div className="fixed bottom-20 left-4 right-4 sm:bottom-0 sm:left-0 sm:right-0 sm:p-4 sm:bg-gradient-to-t sm:from-white sm:via-white/95 sm:to-transparent z-30 flex justify-center pointer-events-none">
          <motion.button
            key={cartTrigger}
            initial={{ scale: 0.9, y: 5 }}
            animate={{ scale: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 500, damping: 10 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => setIsCartOpen(true)}
            className="w-full max-w-sm bg-indigo-600 hover:bg-slate-900 text-white font-bold py-3.5 px-5 rounded-full sm:rounded-xl shadow-xl flex justify-between items-center transition cursor-pointer pointer-events-auto"
            id="btn_bottom_basket"
          >
            <div className="flex items-center space-x-2">
              <span className="bg-white/20 text-white text-xs w-6 h-6 rounded-full flex items-center justify-center font-black">
                {cart.reduce((s, c) => s + c.quantity, 0)}
              </span>
              <span className="text-sm">Ver mi cesta</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <span className="text-xs text-indigo-200">Total:</span>
              <span className="text-sm font-extrabold">{cartTotal.toFixed(2)}€</span>
            </div>
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
              className="bg-white rounded-t-2xl w-full max-w-md p-5 pb-6 shadow-2xl relative z-10 flex flex-col max-h-[85vh]"
              id="basket_drawer_modal"
            >
              {/* Header Drawer */}
              <div className="flex justify-between items-center border-b border-slate-100 pb-3 mb-4">
                <div>
                    <h2 className="text-base font-extrabold text-slate-900 flex items-center space-x-2" id="cart-modal-title">
                      <ShoppingBag className="w-5 h-5 text-indigo-600" />
                      <span>Tu Cesta {tableNumber ? `(Mesa ${tableNumber})` : ""}</span>
                  </h2>
                  <p className="text-[10px] text-slate-500">Revisa tus consumiciones antes de enviar a cocina</p>
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
                    <span className="text-[10px] font-bold text-slate-500 block">FORMA DE PAGO</span>
                    <span className="text-xs font-semibold text-slate-700">Se abona al marchar con el camarero</span>
                  </div>
                  <span className="text-xs bg-indigo-50 text-indigo-700 font-bold px-2 py-1 rounded inline-flex items-center">
                    Pago seguro M-Mesa
                  </span>
                </div>
              </div>

              {/* Enviar pedido */}
              <div className="mt-5 pt-3 border-t border-slate-100 space-y-4">
                <div className="flex justify-between items-baseline">
                  <span className="text-xs font-bold text-slate-500">CONSUMO FINAL CESTA:</span>
                  <span className="text-lg font-black text-slate-900">{cartTotal.toFixed(2)}€</span>
                </div>

                <motion.button
                  whileTap={{ scale: 0.96 }}
                  type="button"
                  disabled={loading || !tableNumber}
                  onClick={submitOrder}
                  className="w-full bg-slate-950 hover:bg-indigo-600 disabled:bg-slate-300 text-white font-extrabold text-sm py-4 rounded-xl flex justify-center items-center space-x-2 shadow-md cursor-pointer transition"
                  id="btn_send_kitchen"
                >
                  {loading ? (
                    <span>Procesando comanda...</span>
                  ) : !tableNumber ? (
                    <span>⚠️ Escanea QR de Mesa para Pedir</span>
                  ) : (
                    <>
                      <span>🔥 Enviar Pedido a Cocina / Barra</span>
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
              className="bg-white rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md shadow-2xl relative max-h-[85vh] flex flex-col z-10 overflow-hidden"
              id="modifier_modal"
            >
              {/* Product Header Graphic with Gradient & Emoji */}
              <div className="h-40 bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 relative flex items-center justify-center shrink-0">
                {/* Drag handle for mobile */}
                <div className="absolute top-3 left-1/2 -translate-x-1/2 w-12 h-1 bg-white/40 rounded-full" />
                <span className="text-6xl drop-shadow-lg select-none">
                  {selectedProductForExtras.name.toLowerCase().includes("hamburguesa") || selectedProductForExtras.name.toLowerCase().includes("burger") ? "🍔" :
                   selectedProductForExtras.name.toLowerCase().includes("pizza") ? "🍕" :
                   selectedProductForExtras.name.toLowerCase().includes("pasta") || selectedProductForExtras.name.toLowerCase().includes("tallarines") ? "🍝" :
                   selectedProductForExtras.name.toLowerCase().includes("ensalada") ? "🥗" :
                   selectedProductForExtras.name.toLowerCase().includes("refresco") || selectedProductForExtras.name.toLowerCase().includes("coca") || selectedProductForExtras.name.toLowerCase().includes("cerveza") || selectedProductForExtras.name.toLowerCase().includes("agua") ? "🥤" :
                   selectedProductForExtras.name.toLowerCase().includes("tarta") || selectedProductForExtras.name.toLowerCase().includes("postre") || selectedProductForExtras.name.toLowerCase().includes("helado") ? "🍰" :
                   "🍽️"}
                </span>
                {/* Close Button overlay */}
                <button
                  type="button"
                  onClick={() => setSelectedProductForExtras(null)}
                  className="absolute top-4 right-4 bg-white/20 hover:bg-white/30 text-white rounded-full p-1.5 transition cursor-pointer"
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

      {/* BOTTOM NAVIGATION PILL FOR MOBILE */}
      <div className="sm:hidden fixed bottom-4 left-1/2 -translate-x-1/2 w-[85%] max-w-[280px] bg-slate-950/90 backdrop-blur-md rounded-full shadow-2xl z-40 flex justify-around items-center py-2.5 px-4 border border-white/10">
        <motion.button
          whileTap={{ scale: 0.95 }}
          type="button"
          onClick={() => setActiveTab("menu")}
          className={`flex flex-col items-center justify-center space-y-0.5 text-xs font-bold transition-all relative ${
            activeTab === "menu" ? "text-indigo-400 scale-105" : "text-slate-400 hover:text-slate-200"
          }`}
          id="mobile_tab_client_menu"
        >
          <Utensils className="w-5 h-5" />
          <span>Carta</span>
        </motion.button>
        
        <motion.button
          whileTap={{ scale: 0.95 }}
          type="button"
          onClick={() => {
            setActiveTab("orders");
            fetchMyOrders();
          }}
          className={`flex flex-col items-center justify-center space-y-0.5 text-xs font-bold transition-all relative ${
            activeTab === "orders" ? "text-indigo-400 scale-105" : "text-slate-400 hover:text-slate-200"
          }`}
          id="mobile_tab_client_orders"
        >
          <div className="relative">
            <ListTodo className="w-5 h-5" />
            {myOrders.length > 0 && (
              <span className="absolute -top-1.5 -right-2.5 bg-red-500 text-white text-[9px] w-4.5 h-4.5 rounded-full flex items-center justify-center font-black shadow-xs">
                {myOrders.length}
              </span>
            )}
          </div>
          <span>Pedidos</span>
        </motion.button>
      </div>

      {/* MODAL SCANNER QR */}
      <AnimatePresence>
        {isScannerOpen && (
          <div className="fixed inset-0 bg-black/80 z-50 flex flex-col items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl w-full max-w-md p-5 shadow-2xl flex flex-col relative"
            >
              <button
                onClick={closeScanner}
                className="absolute top-3 right-3 text-slate-400 hover:text-slate-655 font-extrabold text-lg p-1 cursor-pointer"
                aria-label="Cerrar Escáner"
              >
                ✕
              </button>
              
              <h3 className="font-extrabold text-slate-900 text-sm mb-2 text-center">
                📷 Escanear QR de Mesa
              </h3>
              <p className="text-[11px] text-slate-500 mb-4 text-center">
                Enfoca el código QR de la mesa con tu cámara para asignarla automáticamente.
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
              className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-6 shadow-2xl relative max-h-[90vh] flex flex-col z-10"
            >
              <h3 className="text-base font-extrabold text-slate-900 mb-2">🛎️ ¿En qué podemos ayudarte?</h3>
              <p className="text-xs text-slate-500 mb-4">Elige el motivo para que el camarero sepa qué traer de antemano.</p>
              
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
          initial={{ left: p.x, top: p.y, opacity: 1, scale: 1.5 }}
          animate={{
            left: [p.x, p.x - 50, window.innerWidth / 2],
            top: [p.y, p.y - 150, window.innerHeight - 80],
            opacity: [1, 0.9, 0],
            scale: [1.5, 1.2, 0.4]
          }}
          transition={{ duration: 0.8, ease: "easeInOut" }}
          className="fixed pointer-events-none z-50 text-base flex items-center justify-center bg-indigo-600 text-white rounded-full w-5 h-5 font-black shadow-lg"
        >
          🍔
        </motion.div>
      ))}
    </div>
  );
}
