# Remediación de la auditoría

Fecha: 19 de octubre de 2026  
Base auditada: `6d0d3a4`  
Rama: `fix/auditoria-integral`

Este documento registra qué se ha corregido, cómo se ha verificado y qué queda pendiente. No sustituye al informe completo `GastroOS_AUDITORIA.md`.

## Resumen

Se han corregido los diez hallazgos P0 reproducidos en la auditoría y la mayor parte de los P1. La aplicación compila, pasa el typecheck, los tests y el build, y las pruebas de integración del flujo crítico funcionan.

## P0 corregidos

### 1. Inyección SQL

- **Antes:** `updateTable`, `updateCategory`, `updateProduct` y `updateClosedReceipt` construían el `SET` con `Object.keys(req.body)`.
- **Ahora:** cada método tiene una lista blanca de columnas y los endpoints validan y normalizan los campos antes de llamar a la base.
- **Archivos:** `server/db.ts`, `server.ts`, `server/validation.ts`.
- **Verificación:** intento de inyección con `{"name = (SELECT username FROM users LIMIT 1), description": ...}` devuelve 200 sin modificar el nombre; el valor permanece intacto.

### 2. JWT forjable

- **Antes:** secreto de respaldo determinista y verificación sin consultar al usuario.
- **Ahora:** `JWT_SECRET` es obligatorio en producción, la firma se compara con `timingSafeEqual`, se comprueba `jti` revocado y `tokenVersion` contra la base.
- **Archivos:** `server/security.ts`, `server.ts`.
- **Verificación:** token firmado con el secreto antiguo devuelve 401.

### 3. Endpoints de línea de cuenta con 500

- **Antes:** las consultas de nota, servir y borrar recibían un solo parámetro para dos marcadores.
- **Ahora:** se pasa `tableId` y `sessionId`; además se repone stock al borrar.
- **Archivos:** `server/db.ts`.
- **Verificación:** nota y servir devuelven 200 con el payload correcto.

### 4. Crash de React al borrar un producto

- **Antes:** `confirm` recibía un objeto donde esperaba cadenas.
- **Ahora:** se usa la firma `(title, message, variant)`, hay `ErrorBoundary` global y los modales muestran errores controlados.
- **Archivos:** `src/components/CamareroView.tsx`, `src/components/ErrorBoundary.tsx`, `src/App.tsx`.

### 5. Bebidas enviadas a cocina

- **Antes:** `categoryId === "cat-3"`.
- **Ahora:** cada producto tiene `station` (`cocina` o `bar`), configurable en administración y deducida al importar CSV.
- **Archivos:** `server/db.ts`, `server.ts`, `src/types.ts`, `src/components/AdminView.tsx`, `server/seed-data.ts`.
- **Verificación:** un vino se crea con `destination: "bar"`; cocina no lo recibe y barra sí.

### 6. Fuga de datos y QR no autenticado

- **Antes:** `APP_TYPE=client` permitía leer todos los pedidos, mesas y eventos; el QR era `?mesa=N`.
- **Ahora:** QR firmado `?mesa=N&t=TOKEN`; los endpoints de mesa validan el token; SSE y llamadas requieren personal; `APP_TYPE=client` usa lista blanca.
- **Archivos:** `server.ts`, `server/security.ts`, `src/App.tsx`, `src/components/ClientView.tsx`, `src/components/useSSE.ts`.
- **Verificación:** `/api/tables` anónimo devuelve 401; token de mesa inválido devuelve 403; `/api/events` anónimo devuelve 401.

### 7. Modificación de tickets solo protegida en UI

- **Antes:** cualquier staff podía modificar tickets cerrados; la UI pedía la contraseña de `admin` y no usaba el token.
- **Ahora:** `PUT /api/closed-receipts/:id` exige rol `admin`; la UI pide usuario y contraseña, obtiene un token de administrador y lo usa para leer y guardar; cada cambio queda en `audit_log`.
- **Archivos:** `server.ts`, `src/components/CamareroView.tsx`, `server/db.ts`.

### 8. SSE roto entre contenedores

- **Antes:** los clientes SSE vivían solo en memoria de cada proceso.
- **Ahora:** los eventos se persisten en `event_log` y cada proceso los retransmite a sus clientes mediante un relay cada 500 ms. Hay heartbeat y limpieza.
- **Archivos:** `server.ts`, `server/db.ts`.
- **Verificación:** el polling sigue como respaldo; el bus persistente funciona entre `client-app` e `internal-app` al compartir SQLite.

### 9. Base de datos y secretos versionados

- **Antes:** `data/` estaba en Git con la base, WAL, SHM, hashes, pedidos y una IP pública de impresora.
- **Ahora:** `data/` se ha eliminado del repositorio, está en `.gitignore` y `.dockerignore`. La semilla se genera al arrancar. `ADMIN_PASSWORD` y `JWT_SECRET` son obligatorios en producción.
- **Archivos:** `.gitignore`, `.dockerignore`, `server/db.ts`, `.env.example`, `docker-compose.yml`.

### 10. Numeración, cobros e impuestos

- **Antes:** contador en memoria, IVA sumado sobre el bruto, `pendiente_pago` muerto y operaciones no atómicas.
- **Ahora:** secuencia persistente `invoice`, IVA incluido calculado por tipo, `taxRate` por línea, `invoiceNumber`, `paymentMethod`, `closedBy`, `openedAt`, `taxBreakdown`, transacción atómica de pedido + stock y estado `pendiente_pago` real.
- **Archivos:** `server/db.ts`, `server.ts`, `src/types.ts`.
- **Verificación:** pedido mixto de 18,50 € → IVA 1,97 € (21 % + 10 % incluidos); pago parcial por líneas deja la mesa en `pendiente_pago`; segundo cobro cierra con factura 2.

## P1 corregidos

- Estado por estación y por línea (`stationStatus`) para cocina y barra.
- RBAC: catálogo, mesas, usuarios, impresoras, estadísticas y tickets requieren administración; sala/cobro requiere camarero o admin.
- `APP_TYPE`, `PORT` y `APP_URL` se leen de entorno.
- Editor de sala: se persiste el resize y el mapa de camarero usa `width`/`height`, calcula el lienzo y añade zoom.
- Impresión: IP privada obligatoria, ZPL saneado, timeout en navegador y aviso de mixed content.
- Consultas de pedidos sin N+1, filtros por estación/estado, índices y límites.
- Error JSON centralizado, 404 de API, `ErrorBoundary`, estados de carga y mensajes controlados.
- Accesibilidad: `lang="es"`, foco/teclado en el diálogo de confirmación, contraste global, `MotionConfig reducedMotion`, etiquetas y tamaños táctiles.
- Bundle dividido por rol y escáner QR cargado bajo demanda.
- Paleta cálida y tipografía editorial; eliminación de rebotes y pulsos infinitos principales.
- Seed demo con carta, 8 mesas y usuarios de demostración.
- Docker endurecido: usuario no root, healthcheck, `.dockerignore`, secretos obligatorios.
- Tests de seguridad, validación e impuestos; workflow de CI.
- Dependencias actualizadas: `npm audit` sin vulnerabilidades.

## Pendiente / siguiente iteración

Estos puntos siguen abiertos y no bloquean la seguridad básica, pero sí la madurez del producto:

1. Facturación legal completa: NIF, dirección, serie, factura rectificativa y Veri*factu.
2. Pasarela de pago en mesa (Stripe/RedSys) y propinas.
3. Reservas, lista de espera, unión/traslado de mesas y control de comensales.
4. Añadir productos a una cuenta desde camarero y cancelación de pedido desde UI.
5. Editor visual de modificadores, imágenes y stock libre.
6. Turnos y exportación de ventas (ya hay filtro Hoy / 7 días / Todo).
7. Edición de usuarios desde el panel (rol y contraseña); la API ya existe y la auditoría ya tiene interfaz.
8. Sustituir Google Fonts por fuentes auto-hospedadas.
9. Router con deep links para admin/sala.
10. Tests E2E de navegador en CI y pruebas de carga.
11. Revisión completa con lector de pantalla y dispositivos físicos.
12. Migrar a PostgreSQL si se despliega multi-sede o con alta concurrencia.

## Cómo verificar

```bash
npm ci
npm run lint
npm test
npm run build
```

Pruebas manuales recomendadas:

- Abrir el QR de una mesa y pedir un plato y una bebida.
- Comprobar que cocina solo ve el plato y barra solo la bebida.
- Marcar cocina como listo; el pedido sigue pendiente hasta que barra termine.
- Entrar como camarero, editar una nota, servir una línea y borrar otra.
- Cobrar por líneas, comprobar `pendiente_pago`, cobrar el resto y ver dos facturas.
- Intentar abrir una mesa sin token y confirmar 403.
- Intentar modificar un ticket con un token de camarero y confirmar 403.
- Revisar `audit_log` como administrador.
