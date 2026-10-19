import { Category, Product, Table } from "../src/types";

export const DEMO_CATEGORIES: Category[] = [
  { id: "cat-entrantes", name: "Entrantes", description: "Para empezar", icon: "Soup" },
  { id: "cat-ensaladas", name: "Ensaladas", description: "Frescas y de temporada", icon: "Salad" },
  { id: "cat-arroces", name: "Arroces", description: "Arroces y cazuelas", icon: "Wheat" },
  { id: "cat-principales", name: "Principales", description: "Carnes y pescados", icon: "Beef" },
  { id: "cat-bebidas", name: "Bebidas y Bodega", description: "Vinos, cervezas y refrescos", icon: "GlassWater" },
  { id: "cat-postres", name: "Postres", description: "Dulce final", icon: "IceCream" }
];

interface DemoProduct {
  id: string;
  categoryId: string;
  name: string;
  description: string;
  price: number;
  iva: number;
  allergens: string[];
}

const DEMO_PRODUCTS: DemoProduct[] = [
  { id: "prod-tosta-sardina", categoryId: "cat-entrantes", name: "Tosta de Sardina Ahumada", description: "Pan artesano, sardina ahumada, tomate cher y aliño cítrico", price: 7.5, iva: 10, allergens: ["pescado", "gluten"] },
  { id: "prod-carpaccio-gamba", categoryId: "cat-entrantes", name: "Carpaccio de Gamba Roja", description: "Gamba roja de Denia con vinagreta de mostaza antigua", price: 9, iva: 10, allergens: ["crustaceos", "mostaza"] },
  { id: "prod-croquetas-boletus", categoryId: "cat-entrantes", name: "Croquetas de Boletus", description: "Boletus edulis con parmesano (4 uds)", price: 6, iva: 10, allergens: ["gluten", "lacteos"] },
  { id: "prod-ensalada-arrcana", categoryId: "cat-ensaladas", name: "Ensalada Arrcana", description: "Hojas, queso de cabra, nueces, granada y vinagreta de miel", price: 8.5, iva: 10, allergens: ["lacteos", "frutos_secos"] },
  { id: "prod-ensalada-ventresca", categoryId: "cat-ensaladas", name: "Ensalada de Ventresca", description: "Ventresca de bonito, huevo, tomate, aceituna y cebolla roja", price: 7.5, iva: 10, allergens: ["huevo", "pescado"] },
  { id: "prod-arroz-verduras", categoryId: "cat-arroces", name: "Arroz de Verduras y Setas", description: "Arroz bomba con verduras de temporada y setas", price: 12, iva: 10, allergens: [] },
  { id: "prod-arroz-marisco", categoryId: "cat-arroces", name: "Arroz de Marisco", description: "Bomba con gambas, mejillones, calamares y alioli", price: 14.5, iva: 10, allergens: ["crustaceos", "moluscos"] },
  { id: "prod-arroz-negro", categoryId: "cat-arroces", name: "Arroz Negro", description: "Calamar, tinta, allioli y limón", price: 13.5, iva: 10, allergens: ["moluscos", "crustaceos"] },
  { id: "prod-rape-gallega", categoryId: "cat-principales", name: "Rape a la Gallega", description: "Rape confitado con cachelada, pimentón y aceite de oliva", price: 16.9, iva: 10, allergens: ["pescado"] },
  { id: "prod-secreto-iberico", categoryId: "cat-principales", name: "Secreto Ibérico", description: "A la brasa con pimientos de Padrón y patata panadera", price: 15.5, iva: 10, allergens: [] },
  { id: "prod-tataki-atun", categoryId: "cat-principales", name: "Tataki de Atún", description: "Atún rojo sellado con sésamo, wok de verduras y teriyaki", price: 18, iva: 10, allergens: ["pescado", "soja"] },
  { id: "prod-steak-tartar", categoryId: "cat-principales", name: "Steak Tartar de Ternera", description: "Ternera gallega picada a cuchillo con yema y tostas", price: 16, iva: 10, allergens: ["huevo", "gluten"] },
  { id: "prod-vino-albarino", categoryId: "cat-bebidas", name: "Vino Blanco Albariño", description: "Copa de Albariño DO Rías Baixas", price: 3.5, iva: 21, allergens: ["sulfitos"] },
  { id: "prod-vino-ribera", categoryId: "cat-bebidas", name: "Vino Tinto Ribera del Duero", description: "Copa de Ribera del Duero Crianza", price: 4, iva: 21, allergens: ["sulfitos"] },
  { id: "prod-gin-tonic", categoryId: "cat-bebidas", name: "Gin Tonic Premium", description: "Ginebra premium, tónica artesanal, bayas y enebro", price: 8, iva: 21, allergens: [] },
  { id: "prod-cerveza-ipa", categoryId: "cat-bebidas", name: "Cerveza Artesana IPA", description: "Botella 33cl IPA artesana", price: 3, iva: 21, allergens: ["gluten"] },
  { id: "prod-agua", categoryId: "cat-bebidas", name: "Agua Mineral", description: "Botella de agua mineral natural 50cl", price: 1.5, iva: 21, allergens: [] },
  { id: "prod-refresco-limon", categoryId: "cat-bebidas", name: "Refresco de Limón", description: "Refresco artesanal de limón 33cl", price: 2.5, iva: 21, allergens: [] },
  { id: "prod-torrija", categoryId: "cat-postres", name: "Torrija Caramelizada", description: "Brioche con helado de vainilla y caramelo salado", price: 6, iva: 10, allergens: ["gluten", "lacteos", "huevo"] },
  { id: "prod-crema-catalana", categoryId: "cat-postres", name: "Crema Catalana", description: "Crema artesana con azúcar quemado", price: 5, iva: 10, allergens: ["lacteos", "huevo"] },
  { id: "prod-coulant", categoryId: "cat-postres", name: "Coulant de Chocolate", description: "Chocolate negro con helado de menta", price: 6.5, iva: 10, allergens: ["lacteos", "huevo", "gluten"] }
];

export const DEMO_PRODUCTS_FULL: Product[] = DEMO_PRODUCTS.map((product) => ({
  ...product,
  image: "default.jpg",
  available: true,
  stock: null,
  allergens: product.allergens as Product["allergens"],
  station: product.categoryId === "cat-bebidas" ? "bar" : "cocina",
  modifierGroups: product.categoryId === "cat-principales" ? [
    {
      id: "mod-point",
      name: "Punto de la carne",
      required: true,
      maxSelections: 1,
      options: [
        { id: "point-1", name: "Poco hecho", price: 0 },
        { id: "point-2", name: "Al punto", price: 0 },
        { id: "point-3", name: "Muy hecho", price: 0 }
      ]
    }
  ] : []
}));

export const DEMO_TABLES: Table[] = Array.from({ length: 8 }, (_, index) => {
  const number = index + 1;
  const col = index % 4;
  const row = Math.floor(index / 4);
  return {
    id: `table-${number}`,
    number,
    name: number <= 4 ? `Mesa salón ${number}` : `Mesa terraza ${number}`,
    status: "libre",
    activeSessionId: null,
    qrCodeData: "",
    currentBillTotal: 0,
    posX: 80 + col * 205,
    posY: 70 + row * 190,
    width: 150,
    height: 110,
    assignedWaiterId: null,
    assignedWaiterName: null,
    sessionStartedAt: null
  };
});
