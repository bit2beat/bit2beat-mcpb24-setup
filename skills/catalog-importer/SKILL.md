---
name: catalog-importer
description: >
  Use this skill when the user wants to "importar productos", "cargar el
  catálogo", "importar precios", "actualizar stock", "cargar inventario",
  "importar lista de precios", "cargar descuentos por volumen", "actualizar
  precios masivamente", "importar Excel de productos", or any task involving
  loading product data, prices, stock levels, or volume discounts into a
  Bitrix24 portal catalog. Always use this skill when the user mentions
  Excel, CSV, or any file with products, SKUs, prices, or inventory.
version: 0.1.0
---

# Skill: Catalog Importer — Importación de catálogo Bitrix24

## Propósito
Importar de forma segura listas de productos, precios, stock e inventario
en el catálogo de Bitrix24 desde archivos Excel o CSV.
El flujo siempre incluye un paso de previsualización y confirmación antes de
ejecutar cualquier escritura en el portal.

---

## Archivos de este skill

| Archivo | Cuándo usarlo |
|---|---|
| `scripts/parse_input.py` | Siempre — normaliza el archivo de entrada |
| `scripts/validate.py` | Siempre — valida datos antes del preview |

---

## Dependencias de entorno

- **MCP de bit2beat conectado** (hosteado; la auth la resuelve el token, sin
  webhook ni servidor local)
- **Python** con `openpyxl` y `pandas` instalados
- El archivo de entrada (Excel `.xlsx`/`.xls` o CSV `.csv`) accesible en disco

### Tools del MCP que usa este skill

| Operación | Tool | Notas |
|---|---|---|
| Leer catálogos/precios/depósitos/secciones | `b24_read_call` | pasar `method` (`catalog.*.list`) + `params` |
| Crear sección | `b24_catalog_section_add` | `{fields:{...}}` |
| Crear producto | `b24_products_create` | `{fields:{...}}` |
| Actualizar producto | `b24_products_update` | `{id, fields:{...}}` |
| Crear SKU (variante) | `b24_catalog_sku_add` | `{fields:{... PARENT_ID}}` |
| Crear precio | `b24_catalog_price_set` | `{fields:{...}}` |
| Actualizar precio | `b24_catalog_price_update` | `{id, fields:{...}}` — requiere el id del precio existente |
| Cargar stock | `b24_catalog_store_product_set` | `{fields:{...}}` |
| Actualizar stock | `b24_catalog_store_product_update` | `{id, fields:{...}}` — requiere el id del registro |
| Descuento por volumen | `b24_catalog_rounding_rule_add` | `{fields:{...}}` |

> `b24_read_call` solo admite lecturas (`.list`/`.get`/`.fields`). No existe
> passthrough de escritura: cada escritura usa su tool nombrado de la tabla.

---

## Conceptos clave del catálogo Bitrix24

| Concepto | API | Descripción |
|---|---|---|
| **Sección** | `catalog.section.*` | Carpeta jerárquica que agrupa productos |
| **Producto** | `catalog.product.*` | Ítem del catálogo con nombre, SKU, descripción |
| **SKU** | `catalog.product.sku.*` | Variante de un producto (talle, color, etc.) |
| **Precio** | `catalog.price.*` | Precio por tipo (lista, minorista, mayorista) |
| **Tipo de precio** | `catalog.priceType.*` | Define los niveles de precio del portal |
| **Stock (store)** | `catalog.storeProduct.*` | Cantidad disponible por depósito |
| **Depósito** | `catalog.store.*` | Ubicación física del inventario |
| **Descuento por volumen** | `catalog.roundingRule.*` | Reglas de precio según cantidad comprada |

**Orden obligatorio de importación:** secciones → productos → precios → stock

---

## FASE 0 — Preparación

### 0.1 Leer configuración del catálogo del portal

```
Herramienta: b24_read_call (method: "catalog.catalog.list")
→ obtener catalogId del catálogo vinculado a la tienda (o catálogo simple)

Herramienta: b24_read_call (method: "catalog.priceType.list")
→ lista de {id, name, code} de tipos de precio disponibles

Herramienta: b24_read_call (method: "catalog.store.list")
→ lista de {id, title, code} de depósitos activos

Herramienta: b24_read_call (method: "catalog.section.list", params: {filter: {iblockId}})
→ árbol de secciones existentes (para no duplicar)
```

Los datos de catálogo del portal se leen desde:
`clientes/{nombre_cliente}/portal/scout_catalog.json`

Si el archivo no existe → ejecutar `/portal-scout completo` primero,
o pedir al usuario que confirme que el módulo de catálogo está activo.

Guardar en memoria de trabajo como `portal_catalog_context`.

### 0.2 Detectar tipo de contenido del archivo

Ejecutar `scripts/parse_input.py` pasando la ruta del archivo:

```bash
python scripts/parse_input.py --file "ruta/al/archivo.xlsx"
```

El script detecta automáticamente el tipo de contenido y devuelve un JSON:

```json
{
  "detected_sheets": [
    {"sheet": "Productos", "type": "products", "rows": 142, "columns": ["codigo","nombre","seccion","precio"]},
    {"sheet": "Stock",     "type": "stock",    "rows": 142, "columns": ["codigo","deposito","cantidad"]}
  ],
  "warnings": ["Columna 'costo' no reconocida en hoja Productos"]
}
```

Informar al usuario qué hojas/columnas se detectaron y pedir confirmación si hay warnings.

---

## FASE 1 — Normalización y validación

### 1.1 Normalizar datos

`parse_input.py` mapea nombres de columna heterogéneos a campos canónicos:

| Campo canónico | Aliases reconocidos |
|---|---|
| `sku` | codigo, code, sku, cod, ref, referencia, item_code |
| `name` | nombre, name, descripcion, producto, articulo, item |
| `section` | seccion, categoria, rubro, familia, category |
| `price` | precio, price, pvp, valor, importe |
| `price_type` | tipo_precio, lista, pricelist, price_type |
| `currency` | moneda, currency, divisa |
| `store` | deposito, almacen, stock, store, location |
| `quantity` | cantidad, qty, stock, existencia, unidades |
| `min_qty` | cant_minima, min_qty, minimo |
| `discount_pct` | descuento, discount, dto, bonif |

### 1.2 Validar datos

Ejecutar `scripts/validate.py`:

```bash
python scripts/validate.py --data normalized_data.json --context portal_catalog_context.json
```

El script genera un reporte:

```
ERRORES (bloquean la importación):
  - Fila 23: SKU vacío
  - Fila 47: Precio negativo (-15.00)
  - Fila 89: Tipo de precio "Especial" no existe en el portal

ADVERTENCIAS (importación continúa, revisar):
  - 12 productos sin sección asignada → se ubicarán en raíz del catálogo
  - 3 SKUs ya existen → se actualizarán (no se crearán nuevos)
  - Columna "costo" ignorada (no mapeada)

RESUMEN:
  Secciones nuevas a crear: 4
  Productos a crear: 138
  Productos a actualizar: 3
  Precios a cargar: 141 (tipo: Minorista)
  Líneas de stock: 142 (depósito: Local)
```

**Si hay ERRORES:** mostrar el reporte completo y detener. No continuar hasta que el usuario corrija el archivo o confirme ignorar esas filas.

**Si solo hay ADVERTENCIAS:** mostrar el reporte y pedir confirmación explícita del usuario antes de continuar.

---

## FASE 2 — Preview y confirmación

Antes de escribir nada en Bitrix, mostrar al usuario un resumen estructurado:

```
=== PREVIEW DE IMPORTACIÓN ===

Portal: {portal_name}
Archivo: {filename}
Fecha: {fecha}

SECCIONES (4 nuevas):
  Electrónica > Audio
  Electrónica > Video
  Ropa > Hombre
  Ropa > Mujer

PRODUCTOS (muestra — primeros 5):
  [NUEVO] SKU: ABC001 | Auriculares BT | Sección: Audio | $15.990
  [NUEVO] SKU: ABC002 | Parlante Portátil | Sección: Audio | $22.500
  [ACT]   SKU: ROP001 | Remera Básica | Sección: Hombre | $8.990
  ...

STOCK (muestra — primeros 5):
  SKU: ABC001 | Depósito: Local | 45 unidades
  SKU: ABC001 | Depósito: Depósito | 120 unidades
  ...

Total: 4 secciones | 141 productos | 141 precios | 142 líneas de stock

¿Confirmar importación? (sí/no)
```

**Esperar confirmación explícita del usuario antes de continuar.**

---

## FASE 3 — Ejecución de la importación

Ejecutar en orden estricto. Nunca saltar pasos ni reordenar.

### 3.1 Crear secciones faltantes

```
Por cada sección detectada que no existe en portal_catalog_context:
  Si tiene padre → crear o verificar el padre primero (recursivo)
  Herramienta: b24_catalog_section_add
  Parámetros: {fields: {iblockId, name, iblockSectionId (padre si existe)}}
  → guardar {nombre: id} en mapa de secciones
```

### 3.2 Crear / actualizar productos

```
Por cada producto en datos normalizados:
  Si SKU ya existe (detectado en validación):
    Herramienta: b24_products_update  → {id (productId existente), fields: {...}}
  Si es nuevo:
    Herramienta: b24_products_create  → {fields: {...}}
  Parámetros mínimos del fields: {iblockId, name, iblockSectionId, active: "Y"}
  → guardar {sku: productId} en mapa de productos
```

Si el archivo incluye variantes (mismo SKU base con talle/color):
- Crear producto padre con `b24_products_create`
- Crear SKUs hijos con `b24_catalog_sku_add` ({fields: {iblockId, name, PARENT_ID}}) vinculados al padre

### 3.3 Cargar precios

```
Por cada precio en datos normalizados:
  Resolver productId desde mapa de productos
  Resolver priceTypeId desde portal_catalog_context
  Si el precio ya existe para ese producto+tipo:
    Herramienta: b24_catalog_price_update  → {id (id del precio), fields: {price, currency}}
    (obtener el id con b24_read_call method "catalog.price.list" filtrando productId+catalogGroupId)
  Si es nuevo:
    Herramienta: b24_catalog_price_set     → {fields: {productId, catalogGroupId (=priceTypeId), price, currency}}
```

### 3.4 Cargar stock

```
Por cada línea de stock:
  Resolver productId desde mapa de productos
  Resolver storeId desde portal_catalog_context
  Si ya existe registro de stock para ese producto+depósito:
    Herramienta: b24_catalog_store_product_update  → {id (id del registro), fields: {amount}}
    (obtener el id con b24_read_call method "catalog.storeProduct.list" filtrando productId+storeId)
  Si es nuevo:
    Herramienta: b24_catalog_store_product_set     → {fields: {productId, storeId, amount}}
```

### 3.5 Cargar descuentos por volumen (si existen en el archivo)

```
Por cada regla de descuento:
  Herramienta: b24_catalog_rounding_rule_add
  Parámetros: {fields: {catalogGroupId, from (cantidad mínima), price (precio aplicable)}}
```

---

## FASE 4 — Reporte final

Al terminar, generar y mostrar:

```
=== RESULTADO DE IMPORTACIÓN ===

✓ Secciones creadas: 4
✓ Productos creados: 138
✓ Productos actualizados: 3
✓ Precios cargados: 141
✓ Líneas de stock cargadas: 142

Errores durante importación:
  - SKU: XYZ099 → catalog.product.add falló: NAME es requerido

Duración total: 47 segundos
```

Si hubo errores durante la importación (no de validación), listar los SKUs afectados
y ofrecer reintentar solo esos registros.

---

## Casos especiales

### Actualización parcial (solo precios)
Si el usuario solo quiere actualizar precios sin tocar productos o stock,
ejecutar solo las Fases 0.1, 1, 2 (preview con scope limitado) y 3.3.

### Múltiples tipos de precio
Si el archivo tiene columnas `precio_minorista`, `precio_mayorista`, etc.,
cargar cada columna al tipo de precio correspondiente en una sola pasada de Fase 3.3.

### Archivo con múltiples hojas
Si `parse_input.py` detecta hojas de distintos tipos (Productos + Stock en hojas
separadas), procesar cada hoja según su tipo y respetar el orden global:
secciones → productos → precios → stock.

### Importación incremental
Si el usuario pide "solo lo nuevo" o "solo los que cambiaron", el script de
validación marca con `[ACT]` solo los SKUs existentes con diferencias. En ese
caso, Fase 3.2 omite los `[SIN CAMBIO]`.

---

## Reglas generales

1. **Nunca importar sin preview aprobado** — el usuario siempre ve el resumen antes de la escritura
2. **Respetar el orden de importación** — productos antes de precios, precios antes de stock
3. **Nunca borrar productos existentes** — este skill solo crea y actualiza, nunca elimina
4. **Registrar el mapa sku→productId** — es necesario para vincular precios y stock
5. **Si falla una sección del catálogo** (ej: módulo de inventario no activo) — informar al usuario y ofrecer continuar con las secciones disponibles
