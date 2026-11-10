# Auditoría y rediseño · noviembre de 2026

Base auditada: `43395b1` (`main`). Se revisó todo el servidor (`server.ts`, `server/db.ts`, `server/security.ts`), la vista de cliente completa y los flujos de cobro de sala; el resto de vistas se revisaron en ejecución con un recorrido real en navegador (pedir con QR → cocina/barra → sala → administración).

## Corregido

### Cobros (dinero real)

| Fallo | Antes | Ahora |
|---|---|---|
| Partes iguales nunca cerraba la cuenta | Cada pago cobraba `pendiente / comensales`, así que 100 € entre 3 daba 33,33 → 22,22 → 14,82… | Se reparte el total de la sesión; el último pago absorbe los céntimos y libera la mesa |
| Ingresos duplicados | «Completa» tras un pago a cuenta emitía un ticket por el total entero (100 € + lo ya cobrado) | El ticket final cobra solo el resto y muestra la línea «Pagos a cuenta anteriores» |
| Precios dictados por el navegador | En «por líneas» el servidor guardaba el `priceTotal` que enviaba el cliente; una cantidad negativa además sumaba unidades a la cuenta | Del cliente solo se acepta qué líneas y cuántas; precio, IVA y cantidad máxima salen de la base |
| IVA de pagos a cuenta | Siempre 10 % | Proporcional a los tipos reales de la mesa |
| Cobro no atómico | Factura, líneas y mesa se escribían por separado | Una sola transacción |
| Mesa liberada con pedidos a 0 € | Un pedido de importe 0 dejaba la mesa «libre» con comanda viva | Solo se libera sola cuando no queda ningún pedido |
| Modificar ticket | Aceptaba totales sueltos, perdía `productId`/IVA de cada línea y devolvía la fila sin parsear | Totales e IVA se recalculan en servidor y se conservan los datos de línea |
| Estadísticas truncadas | «Todo» sumaba como mucho 500 tickets; los pagos a cuenta salían como «plato más vendido» | Sin tope práctico; el ranking solo cuenta productos |

### Permisos y validación

- Cocina y barra ya no pueden cambiar el estado de las líneas de la otra estación.
- No se puede anular un pedido de una cuenta ya cerrada (reponía stock de algo cobrado). Las anulaciones quedan en auditoría.
- Editar un producto o categoría con el nombre vacío guardaba `NULL` y rompía la carta; ahora devuelve 400. Se valida que la categoría exista.
- `modifierGroups` se guardaba tal cual llegaba; ahora se normaliza (un grupo mal formado tiraba el alta de pedidos).
- Importación CSV: filas normalizadas, tope de 2000, y un IVA del 0 % ya no se convierte en 10 %.
- `/api/print-receipt` validaba poco y podía dar 500 con un cuerpo mal formado.
- Login: mismo coste para usuarios inexistentes (no se pueden enumerar por tiempo de respuesta).
- Al borrar un usuario se borran sus suscripciones push.
- Cada pedido generaba el ZPL dos veces y gastaba dos números de secuencia.
- `TZ` configurable (por defecto `Europe/Madrid` en Docker): las ventas por hora salían en UTC.

### Cliente

- La pestaña «Pedidos» tenía texto oscuro sobre fondo negro: ilegible.
- La barra inferior quedaba por encima de los modales y tapaba el botón de enviar el pedido.
- La cesta se perdía al recargar; ahora se guarda por mesa en la sesión y se depura contra la carta.
- El buscador devolvía casi todo: cualquier palabra corta del plato («de», «la») contenida en la consulta contaba como acierto.
- El cliente ve lo que lleva en la cuenta y puede pedirla desde «Pedidos».
- Botón «Agotado» cuando el stock es 0 (antes dejaba pedir y fallaba el servidor).

Cubierto por `tests/billing.test.ts` (6 casos nuevos) además de los tests y el smoke test existentes.

## Diseño: «Papel y tinta»

Una primera versión oscura con luces difuminadas se descartó por genérica. La actual sale de lo que hay en un restaurante: carta impresa y comanda térmica.

- Colores planos a sangre, uno por puesto: tomate para el cliente, crema para sala y administración, negro para cocina, verde botella para barra. Sin degradados, brillos ni sombras difusas.
- Fraunces (serif de cartel) para titulares y precios; mono para todo lo que sale de un ticket.
- Las comandas de cocina y barra son tickets de papel con el borde cortado; el filo superior cambia de color con la espera (10 y 15 minutos).
- **LiquidBar**: `src/components/LiquidBar.tsx` es un port a web de `mkandreum/liquidbar` (estilo cápsula con plegado). Conserva sus valores: desenfoque 4 px, saturación ×1,5, canto de 24 px que refracta hacia dentro, lente con muelle (0.62, 420) que crece ×78/56 al pulsar y se arrastra entre pestañas, plegado al bajar 50 px / abrir al subir 8 px y acción separada en su propio círculo. Se usa como navegación principal del personal (acción: sesión) y como barra del cliente (Carta / Pedidos, acción: llamar al camarero). El tinte es más denso que el original (62 % en vez de 40 %) para que se lea sobre fondos claros.
- La refracción del canto usa `backdrop-filter: url()` con un mapa de desplazamiento SVG, que hoy solo pinta Chromium. En Safari y Firefox se ve el mismo cristal sin canto refractado.

## Temas

En **Administración → Apariencia** se elige el tema de toda la app (carta del cliente y paneles). Se guarda en el servidor (`settings.theme`), lo sirve `/api/app-config` y cada dispositivo lo aplica al abrir o recargar.

- **Papel y tinta** (por defecto): el descrito arriba.
- **Noche**: negro, rótulos condensados en mayúsculas (Bebas Neue) y acento ámbar, pensado para que mande la foto del plato.

Las comandas y la cuenta de sala son tickets de papel en los dos temas. Para añadir un tema basta con redefinir las variables de `:root` en `src/index.css` y registrarlo en `src/utils/theme.ts` y en `THEMES` de `server.ts`.

Cada producto admite ahora una foto por enlace `https` (formulario de producto). La CSP permite imágenes `https:`; sin foto se muestra un bloque de color con el icono de la categoría.

Sala y administración se repasaron a mano: mesas como bloques con número grande y color por estado, la cuenta como ticket (y ya no asoman los botones de deslizar bajo cada línea), y cifras de resumen en bloques grandes.

## Pendiente (no tocado)

1. El token del QR de mesa es fijo: quien lo fotografíe puede seguir pidiendo a esa mesa desde fuera. Haría falta rotarlo por sesión o exigir confirmación del camarero.
2. El token de sesión viaja en la URL de `/api/events` (limitación de `EventSource`) y puede acabar en logs del proxy.
3. `POST /api/push/unsubscribe` no pide autenticación.
4. Las fotos de producto son enlaces externos; falta subida de imágenes propia.
5. Hay clases de Tailwind inexistentes en las vistas internas (`text-slate-505`, `bg-amber-55`…) que no hacen nada.
6. `AdminView` (2700 líneas) y `CamareroView` (1600) piden dividirse en componentes y tener tests de interfaz.
7. Siguen abiertos los puntos de producto de `REMEDIACION_AUDITORIA.md` (facturación legal, pasarela de pago, reservas).
