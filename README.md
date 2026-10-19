<div align="center">

# GastroOS

**Sistema de gestión de pedidos para hostelería**

Carta QR, sala, cocina, barra, cobro, impresión térmica y administración en una sola aplicación.

*Un producto de [Xyon Platforms](https://github.com/mkandreum)*

</div>

---

## Qué incluye

- Carta digital con búsqueda, categorías, alérgenos, modificadores y carrito.
- Pedidos por mesa con QR firmado por mesa.
- Seguimiento de comandas en tiempo real.
- Panel de sala con plano del salón, asignación de mesas, cuenta, división y cobro.
- KDS de cocina y barra con estados por estación, cronómetros y alto contraste.
- Administración de carta, mesas, QR locales, impresoras, tickets y personal.
- Impresión ZPL por TCP o desde navegador en red local.
- Web Push y SSE con bus de eventos persistente para despliegues multi-contenedor.
- Auditoría de cobros, cambios de ticket, usuarios y configuración sensible.
- SQLite embebido, Docker y despliegue compatible con Coolify.

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS 4, Motion, Lucide |
| Backend | Node.js, Express, TypeScript |
| Datos | SQLite con WAL y migraciones incrementales |
| Tiempo real | SSE con event log en SQLite + Web Push |
| Impresión | ZPL sobre TCP raw / modo navegador |
| Seguridad | JWT con revocación, scrypt, RBAC, rate limit, Helmet/CSP |
| Despliegue | Docker multi-stage + docker-compose |

## Inicio rápido

### Requisitos

- Node.js 20 o superior.
- npm 10 o superior.
- Opcional: Docker y Docker Compose.

### Desarrollo local

```bash
npm ci
cp .env.example .env
# Edita .env y define JWT_SECRET y ADMIN_PASSWORD
npm run dev
```

La app queda en `http://localhost:3000`.

Con `SEED_DEMO=true` se crean 8 mesas, la carta de ejemplo y estos accesos:

| Rol | Usuario | Contraseña |
|---|---|---|
| Administración | `admin` | la definida en `ADMIN_PASSWORD` |
| Camarero | `camarero1` | `camarero123` |
| Cocina | `cocina1` | `cocina123` |
| Barra | `bar1` | `bar123` |

> Cambia o elimina las cuentas de demostración antes de usar datos reales.

### Producción con Docker

```bash
cp .env.example .env
# Define como mínimo:
# JWT_SECRET, ADMIN_PASSWORD y SEED_DEMO=false
docker compose up -d --build
```

`JWT_SECRET` y `ADMIN_PASSWORD` son obligatorios. El arranque falla de forma intencionada si faltan. Los dos servicios comparten el volumen `db-data` y el bus de eventos persistente.

## Variables de entorno

| Variable | Obligatoria | Descripción |
|---|---|---|
| `APP_URL` | Sí en producción | URL pública usada para generar los QR de mesa |
| `APP_TYPE` | No | `client`, `internal` o `both` |
| `PORT` | No | Puerto HTTP, por defecto `3000` |
| `JWT_SECRET` | Sí en producción | Secreto de sesiones, 32+ caracteres |
| `TABLE_TOKEN_SECRET` | Recomendada | Secreto de los QR; si falta se deriva de `JWT_SECRET` |
| `TOKEN_TTL_SECONDS` | No | Duración de sesión, por defecto 8 h |
| `ADMIN_USERNAME` | No | Usuario administrador inicial |
| `ADMIN_PASSWORD` | Sí en producción con base vacía | Contraseña inicial del administrador |
| `SEED_DEMO` | No | `true` siembra carta, mesas y usuarios demo |
| `VAPID_PUBLIC_KEY` | No | Web Push |
| `VAPID_PRIVATE_KEY` | No | Web Push |
| `VAPID_EMAIL` | No | Contacto VAPID |

## QR de mesa

Cada mesa tiene un token HMAC propio. El QR incluye `?mesa=N&t=TOKEN`. Sin ese token:

- No se puede pedir a esa mesa.
- No se puede consultar su cuenta.
- No se puede llamar al camarero en su nombre.

El administrador puede descargar el QR desde **Mesas y QR**; se genera localmente, sin servicios externos. Si cambias `TABLE_TOKEN_SECRET`, todos los QR impresos dejan de ser válidos.

## Roles

| Rol | Acceso |
|---|---|
| `admin` | Todo: carta, mesas, usuarios, impresoras, estadísticas, auditoría |
| `camarero` | Sala, cuenta, cobro, división, incidencias, tickets |
| `cocina` | KDS de cocina y estados de sus líneas |
| `bar` | KDS de barra y estados de sus líneas |

## Scripts

```bash
npm run dev          # servidor de desarrollo con Vite
npm run lint         # TypeScript sin emitir
npm test             # tests de seguridad, validación e impuestos
npm run test:smoke   # prueba de integración sobre el build
npm run build        # build de cliente y servidor
npm start            # servidor compilado
npm run clean        # limpia dist
```

## Seguridad

- JWT firmado con HMAC-SHA256, `jti` revocable y `tokenVersion` por usuario.
- Contraseñas con scrypt y sal; migración automática de hashes legacy al iniciar sesión.
- Autorización por rol y, en la instancia de cliente, lista blanca de endpoints.
- Rate limiting en login, pedidos y llamadas al camarero.
- Validación y listas blancas de campos en todas las escrituras.
- Helmet, CSP, HSTS en producción, `nosniff` y política de referencia.
- Impresoras restringidas a direcciones privadas o loopback.
- ZPL saneado para evitar inyección de comandos.
- Auditoría de operaciones sensibles.

No subas `data/` al repositorio. Las credenciales de demostración y `SEED_DEMO=true` no deben usarse con datos reales.

Consulta [SECURITY.md](SECURITY.md) para el checklist de despliegue.

## Documentación

- [Remediación de la auditoría](docs/REMEDIACION_AUDITORIA.md)
- [Seguridad y despliegue](SECURITY.md)

## Licencia

El repositorio mantiene la titularidad de Xyon Platforms. Revisa el archivo de licencia y los encabezados del proyecto antes de redistribuirlo.
