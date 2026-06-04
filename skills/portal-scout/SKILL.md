---
name: portal-scout
description: >
  This skill should be used when the user wants to "relevar un portal",
  "mapear un portal Bitrix24", "conectar un portal nuevo", "obtener los datos
  del portal", "actualizar la información del portal", "explorar pipelines y
  etapas", or set up a new Bitrix24 portal before working with automations or
  catalog imports. Always use this skill before running bizproc or
  catalog-importer on a portal that has not been scouted yet. Supports two
  modes: "básico" (CRM + automatizaciones vía API) and "completo" (todos los
  módulos disponibles). Neither mode uses Chrome — Chrome is used only by
  bizproc when working on specific automations.
version: 0.2.0
---

# Skill: Portal Scout — Relevamiento de portal Bitrix24

## Propósito
Recabar la información estructural de un portal Bitrix24 vía API/MCP
y guardarla como archivos permanentes de referencia en la carpeta del cliente.

Esos archivos son la base que usan `bizproc` y `catalog-importer` para
resolver valores reales del portal sin consultar la API en cada operación.

**Este skill nunca usa Chrome.** Las tareas que requieren Chrome
(exportar .bpt, leer el editor de automatizaciones) son responsabilidad
del skill `bizproc` cuando el partner lo solicita explícitamente.

---

## Cómo se llaman las lecturas

Este skill usa el MCP hosteado de bit2beat. Todas las lecturas pasan por el
tool **`b24_read_call`**, que acepta `method` (el método REST de Bitrix) y
`params` (filtros/select opcionales). Solo admite métodos de lectura
(`.list` / `.get` / `.fields` / `.getfields` / `.getlist`); las escrituras no
están permitidas por este tool.

La notación `b24_read_call → crm.category.list` de abajo equivale a llamar:

```
b24_read_call(method: "crm.category.list", params: { ... })
```

Para listados largos, pasar `fetchAll: true` para traer todas las páginas.

No hay que configurar webhook ni servidor local: la conexión y la auth las
resuelve el MCP de bit2beat ya conectado (por token).

---

## Dos modos

| Modo | Qué incluye | Scopes necesarios |
|---|---|---|
| **básico** | CRM (pipelines, etapas, campos, usuarios) + automatizaciones BizProc disponibles | `crm`, `bizproc`, `humanresources` |
| **completo** | Todo lo anterior + catálogo, tareas, disco, telefonía, imopenlines y resto de módulos | todos los scopes de la tabla de abajo |

Si el usuario no especifica, preguntar. Si dice "todo", "el portal entero" o "desde cero" → completo.

**Scopes para scout completo:**
`crm`, `bizproc`, `humanresources`, `catalog`, `tasks`, `tasks_extended`,
`disk`, `telephony`, `imopenlines`, `documentgenerator`, `landing`,
`rpa`, `biconnector`, `sign.b2e`

---

## Requisitos previos

- **MCP de bit2beat conectado** (la auth la resuelve el token; no se configura webhook ni servidor local)
- `nombre_cliente` — nombre corto de la carpeta del cliente (ej: `acme`)
- `portal_url` — URL base del portal (ej: `https://acme.bitrix24.com`)

---

## Carpeta de salida

```
clientes/{nombre_cliente}/portal/
```

Esta estructura debe existir antes de guardar los archivos.
Si no existe, crearla. Todos los archivos del relevamiento se guardan aquí.

---

## MÓDULO A — CRM core (ambos modos)

### A.1 Pipelines

```
b24_read_call → crm.category.list
→ lista de {ID, NAME} de todos los pipelines del portal
```

Guardar en `scout_pipelines.json`.

### A.2 Etapas por pipeline

```
Por cada pipeline:
  b24_read_call → crm.status.list
  filter: {ENTITY_ID: "DEAL_STAGE", CATEGORY_ID: pipeline.ID}
  → {STATUS_ID, NAME, SORT, COLOR}
```

Guardar en `scout_stages.json`
(estructura: `{pipeline_id: {pipeline_name: "...", stages: [...]}}`).

### A.3 Campos custom del deal (UF_*)

```
b24_read_custom_fields  o  crm.userfield.list
filter: {ENTITY_ID: "CRM_DEAL"}
→ {ID, FIELD_NAME, USER_TYPE_ID, LIST (opciones de lista si aplica)}
```

Guardar en `scout_custom_fields.json`.

### A.4 Usuarios activos

```
b24_users_list
→ {ID, nombre, email, cargo} de todos los usuarios activos
```

Guardar en `scout_users.json`.

### A.5 Smart Processes (SPA)

```
b24_read_entity_types  o  crm.type.list
→ {entityTypeId, name} de cada SPA definido en el portal
```

Si no hay SPAs, omitir el archivo. Si hay, guardar en `scout_spa_types.json`.

---

## MÓDULO B — Automatizaciones BizProc (ambos modos)

Los templates y procesos accesibles vía API. El diseño interno de cada
automatización (qué hace cada robot, en qué etapa) lo lee `bizproc` con
Chrome cuando se trabaja sobre una automatización específica.

```
b24_read_call → bizproc.workflow.template.list
→ {ID, NAME, DOCUMENT_TYPE, ACTIVE} de todos los templates definidos
  (incluye templates de deals y de procesos de negocio)
```

Si el portal tiene procesos de negocio (tipo `bitrix_processes`):

```
b24_read_call → lists.field.get
  IBLOCK_TYPE_ID: "bitrix_processes"
  IBLOCK_ID: {id de cada proceso}
→ campos del proceso (qué datos almacena)
```

Guardar todo en `scout_automations.json`
(estructura: `{templates: [...], bizproc_processes: [...]}`).

---

## MÓDULO C — Catálogo de productos (solo modo completo)

```
b24_read_call → catalog.catalog.list
→ {id, name, iblockId} de catálogos disponibles

b24_read_call → catalog.priceType.list
→ tipos de precio {id, name, code}

b24_read_call → catalog.store.list
→ depósitos {id, title, code, active}
```

Si el módulo no está activo (error de permisos o módulo no instalado),
registrar `"disponible": false` y omitir el archivo.
Si está activo, guardar en `scout_catalog.json`.

---

## MÓDULO D — Tareas (solo modo completo)

```
b24_read_call → tasks.task.getFields
→ campos disponibles y configurables de tareas
```

Guardar en `scout_tasks_config.json`.

---

## MÓDULO E — Disco (solo modo completo)

```
b24_disk_storages
→ almacenamientos configurados (personal, compartido, grupos)
```

Guardar en `scout_disk.json`.

---

## MÓDULO F — Telefonía (solo modo completo)

```
b24_read_call → telephony.externalLine.get
→ líneas externas configuradas

b24_read_call → voximplant.line.get  (si disponible)
→ líneas VoxImplant activas
```

Si el módulo no está activo, omitir. Si está activo, guardar en `scout_telephony.json`.

---

## MÓDULO G — Comunicaciones / Open Lines (solo modo completo)

```
b24_read_call → imopenlines.config.list
→ líneas abiertas configuradas (chat en vivo, WhatsApp, etc.)
```

Si el módulo no está activo, omitir. Si está activo, guardar en `scout_imopenlines.json`.

---

## MÓDULO H — Resto de módulos (solo modo completo)

Relevar los módulos disponibles. Si un método devuelve error por módulo
no instalado, registrar `{modulo: "no disponible"}` y continuar.

```
b24_groups_list               → grupos y proyectos activos
b24_read_call → rpa.type.list      → procesos RPA configurados
b24_read_call → lists.get (IBLOCK_TYPE_ID: "lists") → listas personalizadas
```

Consolidar en `scout_modules.json`.

---

## FASE FINAL — Archivos de cierre (ambos modos)

### portal_config.json

```json
{
  "nombre_cliente": "{nombre_cliente}",
  "portal_url": "{portal_url}",
  "portal_name": "{nombre visible del portal}",
  "language": "es",
  "timezone": "America/Buenos_Aires",
  "scout_mode": "básico | completo",
  "scouted_at": "{fecha ISO}",
  "carpeta": "clientes/{nombre_cliente}/portal/",
  "mcp": "bit2beat hosted (auth por token)",
  "has_spa": true | false,
  "has_catalog": true | false,
  "has_telephony": true | false,
  "has_imopenlines": true | false,
  "deal_entity": "CRM_DEAL",
  "bizproc_document_type": ["crm", "CCrmDocumentDeal", "DEAL"],
  "modules_scouted": ["crm", "bizproc", "catalog", ...]
}
```

Guardar en `clientes/{nombre_cliente}/portal/portal_config.json`.

### portal_skill.md

Crear `clientes/{nombre_cliente}/portal/portal_skill.md`:

```markdown
# Portal: {portal_name}

Scout: {scout_mode} — {fecha}

## Leer siempre antes de cualquier tarea
- clientes/{nombre_cliente}/portal/portal_config.json
- clientes/{nombre_cliente}/portal/scout_pipelines.json
- clientes/{nombre_cliente}/portal/scout_stages.json

## Leer según la tarea
- Automatizaciones → skills/bizproc/SKILL.md + scout_automations.json
- Usuarios → scout_users.json
- Campos custom → scout_custom_fields.json
- Catálogo / importar productos → skills/catalog-importer/SKILL.md + scout_catalog.json
- SPAs → scout_spa_types.json
- Telefonía → scout_telephony.json
- Comunicaciones → scout_imopenlines.json

## Módulos no relevados en este scout
{lista de módulos no incluidos — ejecutar /portal-scout completo para obtenerlos}

Portal URL: {portal_url}
```

---

## Archivos resultantes

### Modo básico
```
clientes/{nombre_cliente}/portal/
  portal_config.json
  portal_skill.md
  scout_pipelines.json
  scout_stages.json
  scout_custom_fields.json
  scout_users.json
  scout_automations.json
  scout_spa_types.json       (si hay SPAs)
```

### Modo completo (agrega)
```
clientes/{nombre_cliente}/portal/
  scout_catalog.json         (si módulo activo)
  scout_tasks_config.json
  scout_disk.json
  scout_telephony.json       (si módulo activo)
  scout_imopenlines.json     (si módulo activo)
  scout_modules.json
```

---

## Notas

- El modo básico cubre la mayoría de los trabajos sobre CRM y automatizaciones.
- Si se hizo básico y se necesita un módulo adicional, pedir "relevar catálogo
  del portal de {nombre_cliente}" para ejecutar solo ese módulo.
- `automations_index.json` y los archivos `.bpt` los genera `bizproc` cuando
  se trabaja sobre automatizaciones específicas — no el scout.
- Los archivos del scout reflejan el estado del portal al momento de generarlos.
  Volver a correr el scout si hubo cambios estructurales en el portal.
