"""
parser.py — Bitrix24 BizProc Template Parser
Convierte un archivo .bpt (zlib + PHP serialized) en un dict Python legible.
Puede cruzar los valores con datos reales del portal (usuarios, etapas, campos).

Uso:
    python parser.py archivo.bpt [--portal portal_skill_dir] [--output salida.json]
"""

import zlib
import json
import sys
import argparse
from pathlib import Path

try:
    import phpserialize
except ImportError:
    print("ERROR: Instalar phpserialize con: pip install phpserialize")
    sys.exit(1)


# ---------------------------------------------------------------------------
# Mapeo de tipos de actividad → etiqueta legible
# ---------------------------------------------------------------------------

ACTIVITY_LABELS = {
    'SequentialWorkflowActivity':          'FLUJO SECUENCIAL',
    'CrmChangeResponsibleActivity':        'CAMBIAR RESPONSABLE',
    'GetUserActivity':                     'OBTENER USUARIO',
    'CrmSetObserverField':                 'AGREGAR OBSERVADOR',
    'IfElseActivity':                      'CONDICION IF/ELSE',
    'IfElseBranchActivity':                'RAMA',
    'SetFieldActivity':                    'MODIFICAR ELEMENTO',
    'CrmSetCompanyField':                  'MODIFICAR COMPANIA',
    'CrmSetContactField':                  'MODIFICAR CONTACTO',
    'CrmSendEmailActivity':                'ENVIAR EMAIL CRM',
    'MailActivity':                        'ENVIAR EMAIL',
    'SendMailActivity':                    'ENVIAR EMAIL INTERNO',
    'CrmSendSmsActivity':                  'ENVIAR SMS',
    'CrmSendMessageActivity':              'ENVIAR MENSAJE AL CLIENTE',
    'IMNotifyActivity':                    'NOTIFICACION INTERNA',
    'NotifyActivity':                      'NOTIFICACION',
    'CrmControlNotifyActivity':            'NOTIFICAR AL SUPERVISOR',
    'CrmTimelineCommentAdd':               'COMENTARIO EN TIMELINE',
    'DelayActivity':                       'ESPERAR (DELAY)',
    'RobotDelayActivity':                  'PAUSA',
    'WaitConditionActivity':               'ESPERAR CONDICION',
    'CrmChangeStatusActivity':             'CAMBIAR ETAPA',
    'Task2Activity':                       'CREAR TAREA',
    'CreateDocumentActivity':              'CREAR ELEMENTO',
    'DeleteDocumentActivity':              'ELIMINAR ELEMENTO',
    'UpdateListsDocumentActivity':         'MODIFICAR ELEMENTO LISTA',
    'CreateListsDocumentActivity':         'AGREGAR ELEMENTO LISTA',
    'CrmCreateDynamicActivity':            'CREAR ELEMENTO SPA',
    'CrmUpdateDynamicActivity':            'EDITAR ELEMENTO SPA',
    'CrmDeleteDynamicActivity':            'ELIMINAR ELEMENTO SPA',
    'CrmAddProductRow':                    'AGREGAR PRODUCTO',
    'CrmRemoveProductRow':                 'ELIMINAR PRODUCTO',
    'CrmEventAddActivity':                 'AGREGAR EVENTO CRM',
    'CrmExcludeActivity':                  'AGREGAR A EXCEPCIONES',
    'CrmLeadConvert':                      'CONVERTIR LEAD',
    'CrmScoreActivity':                    'ACTUALIZAR PUNTUACION',
    'CrmGetDataEntityActivity':            'OBTENER DATOS DE ELEMENTO',
    'CrmGenerateEntityDocumentActivity':   'GENERAR DOCUMENTO',
    'CrmGetPaymentUrlActivity':            'CREAR ENLACE DE PAGO',
    'CrmChangeRequisiteActivity':          'MODIFICAR DETALLES',
    'VoximplantCallActivity':              'HACER LLAMADA',
    'Calendar2Activity':                   'EVENTO DE CALENDARIO',
    'SetVariableActivity':                 'DEFINIR VARIABLE',
    'SetGlobalVariableActivity':           'MODIFICAR VARIABLE GLOBAL',
    'MathOperationActivity':               'OPERACION MATEMATICA',
    'ForEachActivity':                     'CICLO FOR EACH',
    'WhileActivity':                       'CICLO WHILE',
    'ParallelActivity':                    'EJECUCION PARALELA',
    'SequenceActivity':                    'SECUENCIA',
    'StartWorkflowActivity':               'INICIAR FLUJO DE TRABAJO',
    'StartScriptActivity':                 'INICIAR SMART SCRIPT',
    'WebHookActivity':                     'WEBHOOK DE SALIDA',
    'DiskUploadActivity':                  'SUBIR AL DRIVE',
    'DiskUploadVersionActivity':           'NUEVA VERSION EN DRIVE',
    'DiskDetailActivity':                  'DETALLES DE OBJETO DRIVE',
    'DiskRemoveActivity':                  'ELIMINAR DEL DRIVE',
    'RequestInformationActivity':          'SOLICITUD DE INFORMACION (requerida)',
    'RequestInformationOptionalActivity':  'SOLICITUD DE INFORMACION (opcional)',
    'ReviewActivity':                      'LEER ELEMENTO',
    'ImAddMemberToGroupChatActivity':      'AGREGAR AL CHAT GRUPAL',
    'SocNetMessageActivity':               'MENSAJE INTERNO (antiguo)',
    'NodeWorkflowActivity':                'WORKFLOW NODE-BASED',
    'EmptyBlockActivity':                  'BLOQUE VACIO',
    'StateInitializationActivity':         'INICIAR ESTADO',
    'BreakActivity':                       'BREAK',
}

DURATION_UNITS = {'m': 'minutos', 'h': 'horas', 'd': 'días', 'w': 'semanas'}
OPERATORS = {'=': '==', '!=': '!=', '>': '>', '<': '<', '>=': '>=', '<=': '<=',
             'like': 'contiene', '!like': 'no contiene'}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def fmt_val(v, portal=None):
    """Formatea un valor para mostrar. Si hay portal, intenta resolver referencias."""
    if v is None:
        return 'null'
    if isinstance(v, bool):
        return 'Sí' if v else 'No'
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, str):
        resolved = resolve_expression(v, portal)
        return resolved[:150]
    if isinstance(v, dict):
        vals = list(v.values())
        if len(vals) == 1:
            return fmt_val(vals[0], portal)
        return '[' + ', '.join(fmt_val(i, portal) for i in vals[:5]) + ']'
    if isinstance(v, (list, tuple)):
        return '[' + ', '.join(fmt_val(i, portal) for i in list(v)[:5]) + ']'
    return str(v)[:120]


def resolve_expression(expr, portal):
    """
    Convierte expresiones BizProc en nombres legibles usando datos del portal.
    Ej: {=Document:ASSIGNED_BY_ID} → "Juan Pérez (Responsable)"
        {=Document:UF_CRM_DEAL_1773674382429} → "Motivo de Contacto"
        user_3094 → "María García"
    """
    if not portal or not isinstance(expr, str):
        return expr

    # Resolver referencias de documento
    if expr.startswith('{=Document:'):
        field_code = expr[11:-1]
        field_name = portal.get('custom_fields', {}).get(field_code, {}).get('name', '')
        if not field_name:
            field_name = portal.get('standard_fields', {}).get(field_code, {}).get('name', field_code)
        return f'{expr} [{field_name}]' if field_name and field_name != field_code else expr

    # Resolver user_ID
    if expr.startswith('user_'):
        user_id = expr[5:]
        user_name = portal.get('users', {}).get(user_id, {}).get('name', '')
        return f'{expr} [{user_name}]' if user_name else expr

    return expr


def parse_fieldcondition(fc, portal=None):
    """Parsea el formato fieldcondition de IfElse/While."""
    conditions = []
    if not fc or not isinstance(fc, dict):
        return conditions
    for item in fc.values():
        if isinstance(item, dict):
            vals = list(item.values())
            if len(vals) >= 3:
                field = fmt_val(vals[0], portal)
                op    = OPERATORS.get(vals[1], vals[1])
                value = fmt_val(vals[2], portal)
                conditions.append(f'{field} {op} {value}')
    return conditions


# ---------------------------------------------------------------------------
# Extractor de actividades
# ---------------------------------------------------------------------------

def extract_activity(node, portal=None, depth=0):
    """
    Extrae recursivamente la información de una actividad y sus hijos.
    Retorna un dict estructurado.
    """
    activity_type = node.get('Type', '?')
    props = node.get('Properties', {}) or {}
    children_raw = node.get('Children', {}) or {}
    activated = node.get('Activated', 'Y')
    title = props.get('Title', '')

    result = {
        'type': activity_type,
        'label': ACTIVITY_LABELS.get(activity_type, activity_type),
        'title': title,
        'active': activated == 'Y',
        'depth': depth,
        'properties': {},
        'children': [],
    }

    # --- Propiedades específicas por tipo ---

    if activity_type == 'CrmChangeResponsibleActivity':
        result['properties']['responsible'] = fmt_val(props.get('Responsible'), portal)
        result['properties']['modified_by'] = fmt_val(props.get('ModifiedBy'), portal)

    elif activity_type == 'GetUserActivity':
        result['properties']['user_type'] = props.get('UserType', '')
        result['properties']['user_field'] = fmt_val(props.get('UserField'), portal)
        result['properties']['save_to_variable'] = props.get('Variable', '')

    elif activity_type == 'CrmSetObserverField':
        result['properties']['observers'] = fmt_val(
            props.get('Observers', props.get('Observer', '')), portal)

    elif activity_type == 'IfElseBranchActivity':
        fc = props.get('fieldcondition', {})
        conditions = parse_fieldcondition(fc, portal)
        result['properties']['conditions'] = conditions if conditions else ['[ELSE / sin condición]']

    elif activity_type == 'WhileActivity':
        fc = props.get('fieldcondition', {})
        result['properties']['while_conditions'] = parse_fieldcondition(fc, portal)

    elif activity_type == 'SetFieldActivity':
        fields = props.get('fields', props.get('Fields', {})) or {}
        if isinstance(fields, dict):
            result['properties']['field_assignments'] = {
                k: fmt_val(v, portal) for k, v in list(fields.items())[:20]
            }

    elif activity_type in ('CrmSetCompanyField', 'CrmSetContactField'):
        fields = props.get('fields', props.get('Fields', {})) or {}
        if isinstance(fields, dict):
            result['properties']['field_assignments'] = {
                k: fmt_val(v, portal) for k, v in list(fields.items())[:20]
            }

    elif activity_type in ('CrmSendEmailActivity', 'MailActivity', 'SendMailActivity'):
        result['properties']['to'] = fmt_val(
            props.get('To', props.get('EMAIL_TO', '')), portal)
        result['properties']['subject'] = fmt_val(
            props.get('Subject', props.get('EMAIL_SUBJECT', '')), portal)

    elif activity_type == 'IMNotifyActivity':
        result['properties']['to'] = fmt_val(props.get('MessageUserTo', ''), portal)
        result['properties']['from'] = fmt_val(props.get('MessageUserFrom', ''), portal)
        result['properties']['message'] = fmt_val(props.get('MessageSite', ''), portal)[:200]

    elif activity_type == 'NotifyActivity':
        result['properties']['to'] = fmt_val(props.get('Users', ''), portal)
        result['properties']['message'] = fmt_val(props.get('MessageText', ''), portal)[:200]

    elif activity_type in ('RobotDelayActivity', 'DelayActivity'):
        dur  = props.get('TimeoutDuration', props.get('Delay', ''))
        unit = props.get('TimeoutDurationType', '')
        result['properties']['wait'] = f"{dur} {DURATION_UNITS.get(unit, unit)}".strip()
        if props.get('WaitWorkDayUser'):
            result['properties']['work_calendar_user'] = fmt_val(
                props.get('WaitWorkDayUser'), portal)

    elif activity_type == 'CrmChangeStatusActivity':
        stage_code = props.get('TargetStatus', '')
        stage_name = portal.get('stages', {}).get(stage_code, {}).get('name', '') if portal else ''
        result['properties']['target_stage_code'] = stage_code
        result['properties']['target_stage_name'] = stage_name
        result['properties']['modified_by'] = fmt_val(props.get('ModifiedBy', ''), portal)

    elif activity_type == 'Task2Activity':
        fields = props.get('Fields', {}) or {}
        if isinstance(fields, dict):
            result['properties']['task_title'] = fmt_val(
                fields.get(0, fields.get('TITLE', '')), portal)
            result['properties']['responsible'] = fmt_val(
                fields.get(1, fields.get('RESPONSIBLE_ID', '')), portal)
            result['properties']['description'] = fmt_val(
                fields.get(3, fields.get('DESCRIPTION', '')), portal)[:200]
        result['properties']['hold_to_close'] = props.get('HoldToClose', 'N') == 'Y'
        if props.get('TimeEstimateHour'):
            result['properties']['estimate_hours'] = props.get('TimeEstimateHour')

    elif activity_type == 'CrmTimelineCommentAdd':
        result['properties']['author'] = fmt_val(props.get('AuthorId', ''), portal)
        result['properties']['comment'] = fmt_val(props.get('Comment', ''), portal)[:200]

    elif activity_type == 'WebHookActivity':
        result['properties']['url'] = fmt_val(props.get('HandlerUrl', ''), portal)
        result['properties']['method'] = props.get('Method', 'GET')

    elif activity_type == 'VoximplantCallActivity':
        result['properties']['phone_field'] = fmt_val(props.get('PhoneNumber', ''), portal)

    else:
        # Para tipos no mapeados: mostrar las primeras propiedades relevantes
        for k, v in list(props.items())[:8]:
            if k not in ('Title', 'EditorComment'):
                result['properties'][k] = fmt_val(v, portal)

    # --- Procesar hijos recursivamente ---
    if isinstance(children_raw, dict):
        for child in children_raw.values():
            if isinstance(child, dict):
                result['children'].append(extract_activity(child, portal, depth + 1))

    return result


# ---------------------------------------------------------------------------
# Función principal de parseo
# ---------------------------------------------------------------------------

def parse_bpt(filepath, portal=None):
    """
    Lee un archivo .bpt y retorna el árbol de actividades como dict Python.

    Args:
        filepath: ruta al archivo .bpt
        portal: dict con datos del portal (users, stages, custom_fields)
                Cargado desde el portal skill (users.json, stages.json, etc.)

    Returns:
        dict con estructura:
            {
              'template_name': str,
              'version': int,
              'variables': [...],
              'constants': [...],
              'activities': [...]  ← árbol recursivo de actividades
            }
    """
    filepath = Path(filepath)
    if not filepath.exists():
        raise FileNotFoundError(f"Archivo no encontrado: {filepath}")

    # 1. Leer y descomprimir
    raw_compressed = filepath.read_bytes()
    if raw_compressed[:2] != b'\x78\xda' and raw_compressed[:2] != b'\x78\x9c':
        raise ValueError(f"El archivo no parece ser zlib comprimido (magic: {raw_compressed[:4].hex()})")

    raw_php = zlib.decompress(raw_compressed)

    # 2. Deserializar PHP
    parsed = phpserialize.loads(raw_php, decode_strings=True)

    # 3. Extraer estructura
    template_arr = parsed.get('TEMPLATE', {})
    root = list(template_arr.values())[0] if isinstance(template_arr, dict) else template_arr

    root_props = root.get('Properties', {}) or {}
    template_name = root_props.get('Title', 'Sin título')

    # Variables y constantes
    variables = [
        {'name': v.get('Name', k), 'type': v.get('Type', ''), 'default': v.get('Default', '')}
        for k, v in (parsed.get('VARIABLES', {}) or {}).items()
    ]
    constants = [
        {'name': v.get('Name', k), 'type': v.get('Type', ''), 'value': v.get('Default', '')}
        for k, v in (parsed.get('CONSTANTS', {}) or {}).items()
    ]

    # Actividades (hijos del nodo raíz SequentialWorkflowActivity)
    root_children = root.get('Children', {}) or {}
    activities = []
    for child in (root_children.values() if isinstance(root_children, dict) else root_children):
        if isinstance(child, dict):
            activities.append(extract_activity(child, portal, depth=0))

    return {
        'template_name': template_name,
        'version': parsed.get('VERSION', 2),
        'variables': variables,
        'constants': constants,
        'activities': activities,
        'source_file': str(filepath),
    }


def render_text(parsed_template, indent=0):
    """Genera una representación en texto legible del template."""
    lines = []
    name = parsed_template.get('template_name', '?')
    lines.append(f"=== AUTOMATIZACION: {name} ===")

    if parsed_template.get('variables'):
        lines.append(f"\nVARIABLES:")
        for v in parsed_template['variables']:
            lines.append(f"  {v['name']} ({v['type']})")

    lines.append(f"\nACCIONES:")

    def render_activity(act, depth=0):
        pad = '  ' * depth
        label = act.get('label', act.get('type'))
        title = f' "{act["title"]}"' if act.get('title') else ''
        flag = '' if act.get('active', True) else ' [DESACTIVADO]'
        lines.append(f"{pad}[{label}]{title}{flag}")

        for k, v in (act.get('properties') or {}).items():
            if isinstance(v, dict):
                lines.append(f"{pad}  {k}:")
                for fk, fv in list(v.items())[:10]:
                    lines.append(f"{pad}    {fk} = {fv}")
            elif isinstance(v, list):
                for item in v:
                    lines.append(f"{pad}  {k}: {item}")
            else:
                lines.append(f"{pad}  {k}: {v}")

        for child in (act.get('children') or []):
            render_activity(child, depth + 1)

    for act in parsed_template.get('activities', []):
        render_activity(act)

    return '\n'.join(lines)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def load_portal(portal_dir):
    """Carga los archivos del portal skill para resolver nombres reales."""
    portal_dir = Path(portal_dir)
    portal = {}
    for fname, key in [('users.json', 'users'), ('stages.json', 'stages'),
                        ('custom_fields.json', 'custom_fields')]:
        fpath = portal_dir / fname
        if fpath.exists():
            with open(fpath, encoding='utf-8') as f:
                portal[key] = json.load(f)
    return portal


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description='Parsea un archivo .bpt de Bitrix24')
    ap.add_argument('bpt_file', help='Ruta al archivo .bpt')
    ap.add_argument('--portal', help='Directorio del portal skill (para resolver nombres reales)')
    ap.add_argument('--output', help='Guardar resultado como JSON en este archivo')
    ap.add_argument('--text', action='store_true', help='Mostrar en texto legible (default: JSON)')
    args = ap.parse_args()

    portal_data = load_portal(args.portal) if args.portal else None

    result = parse_bpt(args.bpt_file, portal=portal_data)

    if args.text or not args.output:
        print(render_text(result))

    if args.output:
        with open(args.output, 'w', encoding='utf-8') as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        print(f"\nGuardado en: {args.output}")
