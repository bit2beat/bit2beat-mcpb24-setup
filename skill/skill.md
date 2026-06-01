# Skill: Bitrix24 Automatizaciones (v1 — leer y exportar)

## Proposito
Detallar en lenguaje natural y exportar las automatizaciones (bizproc) de un portal Bitrix24.
v1 es solo lectura: NO modifica ni importa automaticamente.

## Dependencias
- MCP Bitrix24 del portal (webhook configurado)
- Claude in Chrome conectado con sesion Bitrix abierta
- Python 3 con `phpserialize` (`pip install phpserialize`)

## Archivos
| Archivo | Cuando |
|---|---|
| `url_patterns.json` | navegar el portal via Chrome |
| `activities_catalog.json` | describir un .bpt |
| `parser.py` | parsear un .bpt (`python parser.py archivo.bpt`) |

## Formato .bpt (referencia)
zlib + PHP serializado. Raiz: VERSION, TEMPLATE, PARAMETERS, VARIABLES, CONSTANTS, DOCUMENT_FIELDS.
Arbol de actividades en TEMPLATE[0].Children (recursivo). Cada nodo: Type, Name, Properties, Children.
- Built-in: codigos como CrmChangeStatusActivity (ver activities_catalog.json).
- Custom/Market: Type empieza con rest_ -> nombre legible en Properties.Title.

## Flujo A — Detallar automatizaciones
1. MCP: `b24_read_pipelines` -> lista {pipeline, categoryId}
2. Por pipeline, Chrome navega `automation_page`, espera 4s, extrae stage titles + template IDs
3. Por etapa con plantilla, Chrome navega `bizproc_editor` y exporta el .bpt a `export_path`
4. `parser.py` parsea cada .bpt -> arbol de actividades
5. Cruzar con `activities_catalog.json`; para rest_ usar Properties.Title; resolver IDs reales via MCP
   (usuario -> `b24_users_list`; campo UF_ -> `b24_read_custom_fields`; etapa -> `b24_crm_stages_list`)
6. Generar descripcion por etapa: "En {etapa}: 1) {accion}, 2) {accion}"

## Flujo B — Exportar automatizaciones
1. Igual que A pasos 1-3 -> los .bpt quedan en `export_path`
2. Informar la ruta y como importarlos manualmente (UI de Bitrix -> Importar plantilla)
3. AVISO: al importar en OTRO portal, las referencias (usuarios, etapas, campos UF_, GUIDs)
   quedan colgadas y deben reajustarse a mano en el destino.

## Reglas
1. Nunca asumir un valor — resolver via MCP o confirmar con el usuario.
2. v1 NO escribe ni importa .bpt. Solo lee y exporta.
3. Actividad no catalogada y no rest_ -> reportar como "{code} (no interpretada)".
