# APPGLPI v3 â€” PriorizaciÃ³n de Tickets

Sistema interno de priorizaciÃ³n y coordinaciÃ³n de tickets GLPI para el Ã¡rea de Sistemas.

## Stack

- **Framework**: Next.js 16 (App Router)
- **Base de datos**: SQLite (via Prisma + better-sqlite3)
- **AutenticaciÃ³n**: JWT en cookie httpOnly
- **Puerto**: 8787

## Requisitos

- Node.js >= 20
- Acceso a la API REST de GLPI (solo lectura)

## InstalaciÃ³n

### 1. Configurar `.env`

Copiar `.env.example` o crear `.env` con las variables necesarias:

```env
DATABASE_URL=file:./data/appglpi.sqlite
JWT_SECRET=cambiar-por-un-secreto-seguro
GLPI_BASE_URL=https://tu-glpi/apirest.php
GLPI_APP_TOKEN=tu-app-token
GLPI_USER_TOKEN=tu-user-token
GLPI_WEB_URL=https://tu-glpi
GLPI_ALLOW_SELF_SIGNED=true
GLPI_TIMEOUT_MS=15000
GLPI_PAGE_SIZE=500
GLPI_MAX_TICKET_PAGES=100
SYNC_INTERVAL_MINUTES=3
```

### 2. Instalar dependencias

```bash
npm install
```

### 3. Crear/actualizar la base de datos

```bash
npm run db:push
```

### 4. Poblar usuarios iniciales

```bash
npm run db:seed
```

Esto crea los siguientes usuarios:

| Usuario     | ContraseÃ±a     | Rol                    | Sectores                                   |
|-------------|----------------|------------------------|--------------------------------------------|
| `admin`     | `admin123`     | Administrador          | Todos                                      |
| `coordinator_demo`    | `coordinator_demo123`    | Coordinador Sistemas   | Todos (alcance Sistemas)                   |
| `julianc`   | `julianc123`   | Referente              | Impuestos, TesorerÃ­a, Cuentas a Pagar, RRHH |
| `carolinar` | `carolinar123` | Supervisor             | Impuestos                                  |

### 5. Validar conexiÃ³n GLPI (opcional)

```bash
npm run glpi:discover
```

### 6. Iniciar el servidor de desarrollo

```bash
npm run dev
```

Abrir [http://localhost:8787](http://localhost:8787) en el navegador.

### 7. SincronizaciÃ³n automÃ¡tica (opcional)

En una terminal separada:

```bash
npm run sync:worker
```

Ejecuta sincronizaciÃ³n cada `SYNC_INTERVAL_MINUTES` minutos.

## Scripts disponibles

| Script              | DescripciÃ³n                                    |
|---------------------|------------------------------------------------|
| `npm run dev`       | Servidor de desarrollo en puerto 8787          |
| `npm run build`     | Build de producciÃ³n                            |
| `npm run start`     | Servidor de producciÃ³n en puerto 8787          |
| `npm run lint`      | Ejecutar ESLint                                |
| `npm run db:push`   | Crear/actualizar esquema SQLite                |
| `npm run db:seed`   | Poblar base con usuarios iniciales             |
| `npm run db:reset`  | Resetear base y re-poblar                      |
| `npm run db:count`  | Cuenta los registros actuales en SQLite        |
| `npm run glpi:discover` | Validar conexiÃ³n y grupos GLPI             |
| `npm run sync:worker`   | Worker de sincronizaciÃ³n automÃ¡tica        |

## Perfiles y permisos

- **Administrador**: acceso total, sync manual, gestiÃ³n de usuarios, auditorÃ­a.
- **Coordinador Sistemas**: bandeja priorizada, coordinaciÃ³n de tickets (avance, ETA, comentarios).
- **Referente**: ranking de tickets por sector, drag & drop, mÃ©tricas por sector.
- **Supervisor**: vista de solo lectura de tickets de su sector con ranking y coordinaciÃ³n.

## Notas

- La API GLPI se usa **solo en modo lectura** (GET). No se escriben datos en GLPI.
- Los certificados self-signed se manejan de forma acotada por dispatcher, sin deshabilitar TLS global.
- La base SQLite se almacena en `data/appglpi.sqlite`.
