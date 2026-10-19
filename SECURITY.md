# Seguridad de GastroOS

## Modelo de seguridad

- Las sesiones de personal usan JWT HS256 con expiración, `jti` revocable y `tokenVersion` por usuario.
- Las contraseñas se almacenan con scrypt y sal. Los hashes SHA-256 antiguos se migran al iniciar sesión.
- Los QR de mesa usan un HMAC independiente (`TABLE_TOKEN_SECRET`). Sin el token de la mesa no se puede pedir, consultar la cuenta ni llamar al camarero.
- La autorización se aplica en el servidor por rol. La UI no es un control de seguridad.
- Las escrituras validan campos y usan listas blancas; no se construyen consultas con claves del cliente.
- Las impresoras solo pueden apuntar a direcciones privadas o loopback.
- Las operaciones sensibles quedan en `audit_log`.

## Checklist antes de producción

1. Genera secretos fuertes:
   ```bash
   openssl rand -base64 48   # JWT_SECRET
   openssl rand -base64 48   # TABLE_TOKEN_SECRET
   ```
2. Define `ADMIN_PASSWORD` y cámbiala tras el primer acceso.
3. Pon `SEED_DEMO=false` y elimina las cuentas de demostración.
4. Usa HTTPS en el proxy inverso. Helmet ya envía HSTS en producción.
5. No publiques el volumen `data/` ni lo incluyas en backups sin cifrar.
6. Configura backups periódicos de SQLite (copia con la app parada o usando la API de backup).
7. Revisa que las impresoras estén en la red local y no expuestas a Internet.
8. Configura claves VAPID si usas Web Push.
9. Limita el acceso a los paneles de personal por VPN o red interna.
10. Ejecuta `npm audit --omit=dev` y revisa las dependencias antes de cada despliegue.

## Rotación de secretos

- **JWT_SECRET**: invalida todas las sesiones activas. Los usuarios deben volver a iniciar sesión.
- **TABLE_TOKEN_SECRET**: invalida todos los QR impresos. Hay que regenerar y reimprimir los QR.
- **Contraseña de usuario**: incrementa `tokenVersion` y revoca sus sesiones.
- **Impresora**: cambia la IP/puerto desde el panel; solo se aceptan direcciones privadas.

## Respuesta ante incidentes

1. Rota `JWT_SECRET` y `TABLE_TOKEN_SECRET`.
2. Cambia la contraseña de todos los administradores.
3. Revisa `audit_log` y los tickets cerrados.
4. Restaura una copia de la base anterior si hay manipulación de datos.
5. Revisa accesos al proxy y logs del contenedor.
6. Si se ha expuesto la base, considera los datos de pedidos y clientes como comprometidos.

## Limitaciones conocidas

- No hay firma electrónica ni facturación legál completa (NIF, dirección, serie y rectificativas).
- Las fuentes se cargan desde Google Fonts; para máxima privacidad, auto-hospédalas.
- El modo de impresión directa desde navegador no puede confirmar la entrega física por las restricciones de `no-cors`.
- SQLite es adecuado para un restaurante; para múltiples sedes o alta concurrencia se recomienda PostgreSQL.
- Los tests actuales cubren seguridad, validación e impuestos; los flujos E2E deben ampliarse en CI.
