---
name: bizproc
description: >
  This skill should be used when the user wants to "leer automatizaciones",
  "exportar automatizaciones", "ver qué hace una automatización", "modificar
  una automatización", "agregar una acción a una automatización", "copiar
  automatizaciones entre portales", "importar una automatización", or work
  with Bitrix24 BizProc .bpt files. Use when reading, parsing, modifying,
  generating or importing Bitrix24 automation templates.
version: 0.1.0
---

# Skill: Bitrix24 BizProc Automation

## Propósito
Leer, interpretar, modificar y generar automatizaciones de Bitrix24 en formato BizProc (.bpt).
Funciona sobre cualquier portal Bitrix24. Requiere los archivos de portal-scout para resolver valores reales.

---

## Archivos de este skill

| Archivo | Cuándo leerlo |
|---|---|
| `activities_catalog.json` | Cuando se lee o genera un .bpt |
| `scripts/parser.py` | Cuando se descomprime y analiza un .bpt |
| `scripts/builder.py` | Cuando se modifica o crea un .bpt |
| `scripts/test_roundtrip.py` | **Gate obligatorio** antes de importar/escribir un .bpt (ver "Regla de seguridad") |

Las URLs del portal usadas con Chrome están inline en cada flujo (no hay
archivo `url_patterns.json`):

| Acción | URL |
|---|---|
| Página de automatización de un pipeline | `{portal_url}/crm/deal/automation/{categoryId}/` |
| Editor/exportación de un template | `{portal_url}/crm/configs/bp/CRM_DEAL/edit/{templateId}/` |
| Importar plantilla | `{portal_url}/crm/configs/bp/CRM_DEAL/` |

---

## Archivos del portal que se leen

Antes de cualquier flujo, leer desde `clientes/{nombre_cliente}/portal/`:

| Archivo | Qué aporta |
|---|---|
| `portal_config.json` | URL, nombre, configuración general |
| `scout_pipelines.json` | Lista de pipelines con su categoryId |
| `scout_stages.json` | Etapas por pipeline con sus códigos |
| `scout_users.json` | ID y nombre de usuarios (para resolver destinatarios) |
| `scout_custom_fields.json` | Campos UF_* y sus opciones (para resolver valores) |
| `scout_automations.json` | Templates BizProc existentes (IDs y nombres) |

Si alguno de estos archivos no existe → ejecutar `/portal-scout básico` primero.

---

## Dependencias de entorno

- **MCP de bit2beat conectado** (hosteado; la auth la resuelve el token, no hay
  webhook ni servidor local). Las lecturas vía API usan `b24_read_call`
  (p. ej. `bizproc.workflow.template.list` para listar templates).
- **Chrome con extensión Claude in Chrome** conectada y sesión de Bitrix24 abierta
  (necesaria para exportar/importar .bpt: no hay método REST para eso).
- **Python** con librería `phpserialize` instalada (`pip install phpserialize`)

> El MCP hosteado no expone passthrough de escritura: la importación de .bpt
> ocurre por Chrome, nunca por un tool de escritura del MCP.

---

## Flujo 1 — Leer automatizaciones de un portal

### Paso 1: Obtener pipelines
```
Leer clientes/{nombre_cliente}/portal/scout_pipelines.json
→ lista de {pipeline_name, categoryId}
```

### Paso 2: Por cada pipeline, navegar la página de automatización
```
[Chrome]
Navegar: {portal_url}/crm/deal/automation/{categoryId}/
Esperar 4 segundos (carga del iframe)
```

### Paso 3: Extraer robots y template IDs desde el iframe
```
[Chrome / javascript_tool]
```

```javascript
function extractAutomationData(iDoc) {
  const stageHeaders = Array.from(
    iDoc.querySelectorAll('.bizproc-automation-status-title')
  ).map(el => el.innerText.trim());

  const robotItems = Array.from(
    iDoc.querySelectorAll(
      '.bizproc-automation-status-list > .bizproc-automation-status-list-item'
    )
  );

  const scripts = Array.from(iDoc.querySelectorAll('script'));
  const dataScript = scripts.find(s =>
    s.textContent.includes('"DOCUMENT_STATUS"') &&
    s.textContent.includes('"IS_EXTERNAL_MODIFIED"')
  );
  const templateMap = {};
  if (dataScript) {
    const re = /\{"ID":(\d+),"DOCUMENT_TYPE":\["crm","CCrmDocumentDeal","DEAL"\],"DOCUMENT_STATUS":"([^"]+)","PARAMETERS":\[\],"CONSTANTS":\[\],"VARIABLES":\[\],"IS_EXTERNAL_MODIFIED":(true|false)/g;
    let m;
    while ((m = re.exec(dataScript.textContent)) !== null) {
      templateMap[m[2]] = { templateId: parseInt(m[1]), hasBizProc: m[3] === 'true' };
    }
  }

  return { stageHeaders, templateMap };
}

const iframe = document.querySelector('iframe');
const iDoc = iframe?.contentDocument;
window.__automationData = iDoc ? extractAutomationData(iDoc) : null;
```

Guardar el resultado en `clientes/{nombre_cliente}/automatizaciones/automations_index.json`.

### Paso 4: Para etapas con hasBizProc=true, exportar el template
```
[Chrome]
Navegar: {portal_url}/crm/configs/bp/CRM_DEAL/edit/{templateId}/
Esperar 3 segundos
Ejecutar BCPProcessExport()
Mover el .bpt descargado a:
  clientes/{nombre_cliente}/automatizaciones/{stageCode}_{templateId}.bpt
```

### Paso 5: Parsear cada .bpt
```
[scripts/parser.py]
Ejecutar parser.py con el archivo .bpt
→ árbol de actividades legible

Cruzar con scout_users.json, scout_stages.json, scout_custom_fields.json
→ generar descripción en lenguaje natural
```

---

## Flujo 2 — Modificar una automatización con lenguaje natural

### Paso 1: Entender la solicitud
Identificar en la solicitud del usuario:
- **Qué etapa** → buscar en `scout_stages.json`
- **Qué acción agregar/modificar/eliminar**
- **Con qué parámetros** (usuarios, campos, condiciones, tiempos)

### Paso 2: Resolver valores del portal
```
Leer desde clientes/{nombre_cliente}/portal/:
- Nombre de etapa → código (scout_stages.json)
- Nombre de usuario → ID (scout_users.json)
- Nombre de campo → código UF_ (scout_custom_fields.json)
- Valor de lista → GUID (scout_custom_fields.json → LIST)
```

### Paso 3: Leer automatización actual
```
Si ya existe un .bpt en clientes/{nombre_cliente}/automatizaciones/:
  → parsear con scripts/parser.py
Si no existe:
  → ejecutar Flujo 1 Pasos 2-5 primero
```

### Paso 4: Construir modificación
```
[activities_catalog.json]
Verificar que la actividad existe en el catálogo
Obtener parámetros requeridos

[scripts/builder.py]
Construir el dict de la nueva actividad
Insertar en la posición correcta del árbol existente
```

Presentar el mapa de valores al usuario y pedir confirmación antes de continuar.

### Paso 5: Generar nuevo .bpt
```
[scripts/builder.py]
Ejecutar builder.py → reserializar PHP + comprimir zlib → nuevo archivo
Guardar como: clientes/{nombre_cliente}/automatizaciones/{stageCode}_{templateId}_modified.bpt
```

### Paso 6: Importar via Chrome
```
[Chrome]
Navegar: {portal_url}/crm/configs/bp/CRM_DEAL/
Hacer clic en "Importar plantilla"
Subir: clientes/{nombre_cliente}/automatizaciones/{stageCode}_{templateId}_modified.bpt
Esperar confirmación de carga exitosa

Navegar: {portal_url}/crm/deal/automation/{categoryId}/
Esperar 4 segundos
Localizar la etapa por stageCode
Asignar la nueva plantilla importada a esa etapa
```

---

## Flujo 3 — Copiar automatización entre portales (con mapeo)

### Paso 1: Exportar del portal origen
Ejecutar Flujo 1 sobre el portal origen.

### Paso 2: Recolectar datos del portal destino
```
Leer archivos de portal-scout del portal destino:
  clientes/{nombre_cliente_destino}/portal/scout_pipelines.json
  clientes/{nombre_cliente_destino}/portal/scout_stages.json
  clientes/{nombre_cliente_destino}/portal/scout_users.json
  clientes/{nombre_cliente_destino}/portal/scout_custom_fields.json

Si no existen → ejecutar /portal-scout básico sobre el portal destino.
```

### Paso 3: Construir mapa de traducción
Para cada valor referenciado en el .bpt:
```
usuario origen  → proponer usuario destino (mismo nombre si existe)
etapa origen    → proponer etapa destino (mismo nombre si existe)
campo UF_ origen → proponer campo destino (mismo nombre si existe)
GUID de opción  → proponer GUID equivalente en destino
```
Presentar el mapa al usuario y pedir confirmación/corrección de ambigüedades.

### Paso 4: Aplicar mapa y generar .bpt adaptado
```
[scripts/builder.py]
Ejecutar con mapa de traducción
→ reemplazar todos los valores referenciados
→ guardar en: clientes/{nombre_cliente_destino}/automatizaciones/{stageCode}_{templateId}_from_{origen}.bpt
```

### Paso 5: Importar en portal destino
```
[Chrome — sesión del portal destino]
Navegar: {portal_url_destino}/crm/configs/bp/CRM_DEAL/
Hacer clic en "Importar plantilla"
Subir el .bpt adaptado
Esperar confirmación

Navegar: {portal_url_destino}/crm/deal/automation/{categoryId_destino}/
Esperar 4 segundos
Localizar la etapa equivalente por nombre mapeado
Asignar la plantilla importada
```

---

## Regla de seguridad — Gate de round-trip (OBLIGATORIO antes de escribir)

Antes de **importar o escribir** cualquier .bpt (Flujos 2 y 3), validar que el
`builder.py` reconstruye la estructura de forma fiel. La importación de un .bpt
corrupto puede romper una automatización en producción.

```
[scripts/test_roundtrip.py]
# Validación base (siempre):
python scripts/test_roundtrip.py

# Validación completa contra el .bpt real que se va a modificar:
python scripts/test_roundtrip.py --bpt clientes/{cliente}/automatizaciones/{archivo}.bpt
```

- **GATE: PASS** → el builder es confiable; se puede generar e importar el .bpt.
- **GATE: FAIL** → **no importar**. La skill queda limitada a leer/exportar y se
  avisa al usuario que la modificación no es segura para ese template.

El test verifica: `estructura → save() → .bpt → load() → estructura` es
estructuralmente equivalente (equivalencia de arrays PHP), y que el parser puede
releer lo que el builder escribió.

---

## Reglas generales

1. **Correr el gate de round-trip antes de importar** — ver la regla de seguridad de arriba; si falla, solo leer/exportar
2. **Nunca asumir un valor** — siempre resolver desde los archivos de scout o confirmar con el usuario
3. **Mostrar el mapa antes de modificar** — el usuario debe aprobar los valores traducidos
4. **Guardar el .bpt original antes de modificar** — nunca sobrescribir sin backup
5. **Si una actividad no está en el catálogo** — informar que es custom/Market y no modificarla
6. **Las actividades `rest_*`** son portal-específicas — no transferibles entre portales sin que la app esté instalada en destino
