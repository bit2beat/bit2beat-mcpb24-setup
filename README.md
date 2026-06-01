# bit2beat-mcpb24-setup

CLI para conectar tu portal de Bitrix24 con Claude (Desktop, Code o Web) usando el MCP hosteado de **bit2beat**. No necesitás levantar ningún servidor.

## Uso rápido

```bash
npx bit2beat-mcpb24-setup
```

El asistente te pide tu token (lo obtenés en el dashboard de bit2beat), lo verifica y configura tu cliente automáticamente.

## Clientes soportados

| Cliente | Cómo conecta |
|---|---|
| Claude Desktop | puente `mcp-remote` (stdio↔HTTP) |
| Claude Code | HTTP nativo |
| Claude.ai web | instrucciones manuales |

## Requisitos

- **Node.js 18+** (recomendado 20 LTS). El asistente detecta tu versión y elige el puente compatible automáticamente.
- Tu token de b24-mcp (empieza con `b24lite_`).

## Automatizaciones (opcional, según tu plan)

Si tu plan lo incluye, podés instalar la skill de automatizaciones:

```bash
npx bit2beat-mcpb24-setup automations
```

Permite que Claude:
- **Detalle** en lenguaje natural qué hace cada automatización de tu portal.
- **Exporte** los templates `.bpt` para respaldarlos o importarlos en otro portal.

Requiere **Claude Code o Desktop** + **Python 3** (`pip install phpserialize`) + **Claude in Chrome**. El asistente verifica todos los requisitos antes de instalar.

## Cómo verificar la conexión

- **Claude Desktop:** reiniciá la app y preguntá *"¿qué herramientas de Bitrix24 tenés?"*.
- **Claude Code:** `claude mcp list` → debe aparecer tu conexión como **Connected**.

## Soporte

Documentación completa: https://github.com/bit2beat/b24-mcp-wiki
