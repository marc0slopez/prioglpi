# Límites del núcleo PrioGLPI

## Pertenece al producto base

- Integración con GLPI.
- Caché operativa de tickets, grupos, usuarios, seguimientos y tareas.
- Priorización, coordinación, auditoría y métricas.
- Usuarios, roles y scopes administrados en el esquema SQL `prioglpi`.
- Autenticación local como modo predeterminado.
- Configuración SQL mediante variables `PRIOGLPI_SQL_*`.

## No pertenece al producto base

- KPI Sistemas.
- Identidades, marcas, hosts, dominios, cuentas o grupos de un cliente.
- Integraciones WebApps específicas de example.
- Datos de QA/piloto, snapshots de identidades y usuarios de prueba reales.
- Scripts de migración o diagnóstico destinados a una instalación particular.

## Regla de integraciones

Una integración externa puede autenticar una identidad, pero no debe ser la fuente
obligatoria de roles ni scopes de PrioGLPI. Esos permisos se administran en
`prioglpi.app_user` y `prioglpi.user_sector_scope`.
