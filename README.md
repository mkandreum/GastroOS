<div align="center">

# 🍽️ GastroOS

**Sistema de gestión de pedidos para hostelería**

*Un producto de [Xyon Platforms](https://github.com/mkandreum)*

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=flat&logo=vite&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat&logo=docker&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?style=flat&logo=sqlite&logoColor=white)

</div>

---

## ¿Qué es GastroOS?

GastroOS es una aplicación web para la gestión de pedidos en bares y restaurantes. Permite gestionar mesas, pedidos y la impresión automática de tickets en impresoras de red local mediante protocolo TCP/ZPL, con despliegue listo para producción vía Docker y Coolify.

## ✨ Funcionalidades

- **Gestión de mesas y pedidos** en tiempo real
- **Impresión de tickets** en impresoras de red local (ZPL/TCP)
- **Modo dual de impresión**: navegador directo o proxy servidor
- **Panel de administración** para configurar impresoras y modos de impresión
- **Despliegue Docker** compatible con Coolify
- **Base de datos SQLite** embebida, sin dependencias externas

## 🛠️ Stack técnico

| Capa | Tecnología |
|------|----------|
| Frontend | React + TypeScript + Vite |
| Backend | Node.js + TypeScript (server.ts) |
| Base de datos | SQLite |
| Impresión | ZPL sobre TCP socket / Browser Direct |
| Despliegue | Docker + docker-compose + Coolify |

## 🚀 Instalación

### Con Docker (recomendado)

```bash
git clone https://github.com/mkandreum/GastroOS.git
cd GastroOS
cp .env.example .env
# Edita .env con tu configuración
docker-compose up -d
```

### Desarrollo local

```bash
npm install
npm run dev
```

## ⚙️ Configuración

Copia `.env.example` a `.env` y configura las variables necesarias. En el panel de administración puedes configurar la IP de la impresora y el modo de impresión (Navegador Directo / Servidor TCP).

## 🏢 Xyon Platforms

GastroOS es un producto desarrollado y mantenido por **Xyon Platforms**, empresa especializada en soluciones digitales para negocios locales y pymes.

> © Xyon Platforms — Todos los derechos reservados
