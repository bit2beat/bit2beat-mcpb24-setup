"""
builder.py — Bitrix24 BizProc Template Builder
Modifica o construye desde cero un template BizProc (.bpt).
Toma un dict Python (parseado por parser.py o construido nuevo)
y genera un archivo .bpt válido (PHP serializado + zlib).

Uso:
    from builder import BptBuilder
    b = BptBuilder('original.bpt')
    b.add_activity_after('A2319_14104_24651_4061', new_activity_dict)
    b.save('modified.bpt')
"""

import zlib
import json
import sys
import copy
import random
import string
from pathlib import Path

try:
    import phpserialize
except ImportError:
    print("ERROR: Instalar phpserialize con: pip install phpserialize")
    sys.exit(1)


# ---------------------------------------------------------------------------
# Generador de IDs de actividad
# ---------------------------------------------------------------------------

def generate_activity_id():
    """
    Genera un ID único para una actividad al estilo Bitrix24.
    Formato: A{n1}_{n2}_{n3}_{n4} con números de 4-5 dígitos.
    """
    return 'A' + '_'.join(str(random.randint(1000, 99999)) for _ in range(4))


# ---------------------------------------------------------------------------
# Constructores de actividades comunes
# ---------------------------------------------------------------------------

def make_delay(duration, unit='m', title='Esperar', wait_workday_user=None):
    """
    Construye una actividad RobotDelayActivity.

    Args:
        duration: número (entero o string)
        unit: 'm'=minutos, 'h'=horas, 'd'=días, 'w'=semanas
        title: título visible en el diseñador
        wait_workday_user: lista de user IDs para respetar horario laboral
    """
    props = {
        'TimeoutDuration': str(duration),
        'TimeoutDurationType': unit,
        'WriteToLog': 'N',
        'WaitWorkDayUser': wait_workday_user or [],
        'Title': title,
        'EditorComment': '',
    }
    return _make_activity('RobotDelayActivity', props)


def make_notify_internal(to, message, from_user=None, title='Notificación'):
    """
    Construye una IMNotifyActivity (notificación interna Bitrix24).

    Args:
        to: lista de destinatarios. Puede ser user_ID, {=Document:ASSIGNED_BY_ID}, etc.
        message: texto del mensaje. Puede incluir expresiones {=Document:FIELD}
        from_user: user_ID del remitente. None = sistema
        title: título visible en el diseñador
    """
    if not isinstance(to, list):
        to = [to]
    props = {
        'MessageUserTo': to,
        'MessageSite': message,
        'MessageOut': '',
        'MessageType': 4,
        'MessageUserFrom': [from_user] if from_user else [],
        'Title': title,
        'EditorComment': '',
    }
    return _make_activity('IMNotifyActivity', props)


def make_change_stage(stage_code, modified_by=None, title='Cambiar etapa'):
    """
    Construye una CrmChangeStatusActivity.

    Args:
        stage_code: código de etapa (ej: 'FINAL_INVOICE', 'UC_YK9ZP0', 'C3:STAGE2')
        modified_by: user_ID o expresión del responsable del cambio
        title: título visible en el diseñador
    """
    props = {
        'TargetStatus': stage_code,
        'ModifiedBy': modified_by or [],
        'Title': title,
        'EditorComment': '',
    }
    return _make_activity('CrmChangeStatusActivity', props)


def make_modify_field(field_assignments, title='Modificar elemento'):
    """
    Construye una SetFieldActivity.

    Args:
        field_assignments: dict {FIELD_CODE: value_or_expression}
            Ej: {'TITLE': 'Nuevo título', 'ASSIGNED_BY_ID': '{=Document:UF_CRM_FIELD}'}
        title: título visible en el diseñador
    """
    props = {
        'fields': field_assignments,
        'Title': title,
        'EditorComment': '',
    }
    return _make_activity('SetFieldActivity', props)


def make_create_task(task_title, responsible_id, description='',
                     deadline=None, estimate_hours=None,
                     hold_to_close=False, title='Crear tarea'):
    """
    Construye una Task2Activity.

    Args:
        task_title: título de la tarea
        responsible_id: user_ID o expresión del responsable
        description: descripción de la tarea
        deadline: expresión de fecha límite
        estimate_hours: horas estimadas
        hold_to_close: si True, bloquea el avance hasta completar la tarea
        title: título visible en el diseñador
    """
    fields = {
        0: task_title,
        1: responsible_id if isinstance(responsible_id, list) else [responsible_id],
        2: [],  # auditors
        3: description,
    }
    if deadline:
        fields['DEADLINE'] = deadline

    props = {
        'Fields': fields,
        'HoldToClose': 'Y' if hold_to_close else 'N',
        'AUTO_LINK_TO_CRM_ENTITY': 'Y',
        'AsChildTask': '',
        'CheckListItems': [],
        'TimeEstimateHour': str(estimate_hours) if estimate_hours else '',
        'TimeEstimateMin': '',
        'Title': title,
        'EditorComment': '',
    }
    return _make_activity('Task2Activity', props)


def make_ifelse(branches, title='Condición'):
    """
    Construye una IfElseActivity con sus ramas.

    Args:
        branches: lista de dicts, cada uno con:
            {
              'title': 'Nombre de la rama',
              'conditions': [   ← lista de condiciones (AND entre ellas)
                {'field': 'FIELD_CODE', 'operator': '=', 'value': 'valor'}
              ],
              'activities': [...]  ← lista de actividades en esta rama
            }
        La última rama sin conditions es el ELSE.
        title: título del bloque IF/ELSE
    """
    branch_children = {}
    for i, branch in enumerate(branches):
        branch_id = generate_activity_id()
        branch_conditions = {}
        for j, cond in enumerate(branch.get('conditions', [])):
            branch_conditions[j] = {
                0: cond['field'],
                1: cond.get('operator', '='),
                2: cond['value'],
                3: '0',
            }

        branch_activities = {}
        for k, act in enumerate(branch.get('activities', [])):
            branch_activities[k] = act

        branch_props = {
            'Title': branch.get('title', f'Rama {i+1}'),
            'fieldcondition': branch_conditions,
            'EditorComment': '',
        }
        branch_children[i] = {
            'Type': 'IfElseBranchActivity',
            'Name': branch_id,
            'Activated': 'Y',
            'Node': None,
            'Properties': branch_props,
            'Children': branch_activities,
        }

    props = {'Title': title, 'EditorComment': ''}
    activity = _make_activity('IfElseActivity', props)
    activity['Children'] = branch_children
    return activity


def make_while(conditions, activities, title='Mientras'):
    """
    Construye una WhileActivity.

    Args:
        conditions: lista de {'field': str, 'operator': str, 'value': str}
        activities: lista de actividades dentro del ciclo
        title: título visible
    """
    fc = {}
    for i, cond in enumerate(conditions):
        fc[i] = {0: cond['field'], 1: cond.get('operator', '='), 2: cond['value'], 3: '0'}

    inner_seq = make_sequence(activities, title='Secuencia de actividades')

    props = {
        'fieldcondition': fc,
        'Title': title,
        'EditorComment': '',
    }
    activity = _make_activity('WhileActivity', props)
    activity['Children'] = {0: inner_seq}
    return activity


def make_parallel(sequences, title='Ejecución paralela'):
    """
    Construye una ParallelActivity con múltiples ramas secuenciales.

    Args:
        sequences: lista de listas de actividades (cada lista = una rama paralela)
        title: título visible
    """
    children = {}
    for i, seq_activities in enumerate(sequences):
        children[i] = make_sequence(seq_activities, title='Secuencia de actividades')

    props = {'Title': title, 'EditorComment': ''}
    activity = _make_activity('ParallelActivity', props)
    activity['Children'] = children
    return activity


def make_sequence(activities, title='Secuencia de actividades'):
    """Construye una SequenceActivity contenedora."""
    children = {i: act for i, act in enumerate(activities)}
    props = {'Title': title, 'EditorComment': ''}
    activity = _make_activity('SequenceActivity', props)
    activity['Children'] = children
    return activity


def make_supervisor_notify(message, title='Notificar al supervisor'):
    """Construye una CrmControlNotifyActivity."""
    props = {
        'MessageText': message,
        'Title': title,
        'EditorComment': '',
    }
    return _make_activity('CrmControlNotifyActivity', props)


def make_change_responsible(responsible, modified_by=None, title='Cambiar responsable'):
    """Construye una CrmChangeResponsibleActivity."""
    if not isinstance(responsible, list):
        responsible = [responsible]
    props = {
        'Responsible': responsible,
        'ModifiedBy': [modified_by] if modified_by else [],
        'Title': title,
        'EditorComment': '',
    }
    return _make_activity('CrmChangeResponsibleActivity', props)


def make_add_observer(observers, title='Cambiar observadores'):
    """Construye una CrmSetObserverField."""
    if not isinstance(observers, list):
        observers = [observers]
    props = {
        'Observers': observers,
        'Title': title,
        'EditorComment': '',
    }
    return _make_activity('CrmSetObserverField', props)


def make_timeline_comment(comment, author=None, title='Comentario en timeline'):
    """Construye una CrmTimelineCommentAdd."""
    props = {
        'Comment': comment,
        'AuthorId': author or '',
        'Title': title,
        'EditorComment': '',
    }
    return _make_activity('CrmTimelineCommentAdd', props)


# ---------------------------------------------------------------------------
# Función base interna
# ---------------------------------------------------------------------------

def _make_activity(activity_type, properties):
    """Construye la estructura base de una actividad."""
    return {
        'Type': activity_type,
        'Name': generate_activity_id(),
        'Activated': 'Y',
        'Node': None,
        'Properties': properties,
        'Children': {},
    }


# ---------------------------------------------------------------------------
# Clase principal BptBuilder
# ---------------------------------------------------------------------------

class BptBuilder:
    """
    Clase para leer, modificar y guardar templates BizProc (.bpt).

    Ejemplo de uso:
        b = BptBuilder('original.bpt')
        delay = make_delay(24, 'd', 'Esperar 24hs')
        notify = make_notify_internal('{=Document:ASSIGNED_BY_ID}', 'El deal lleva 24hs sin avanzar')
        b.append_activities([delay, notify])
        b.save('modified.bpt')
    """

    def __init__(self, source_bpt=None):
        """
        Args:
            source_bpt: ruta a un .bpt existente. Si None, crea un template nuevo vacío.
        """
        if source_bpt:
            self._load(source_bpt)
        else:
            self._create_empty()

    def _load(self, filepath):
        filepath = Path(filepath)
        raw_compressed = filepath.read_bytes()
        raw_php = zlib.decompress(raw_compressed)
        self._parsed = phpserialize.loads(raw_php, decode_strings=True)
        self._backup = copy.deepcopy(self._parsed)

    def _create_empty(self):
        self._parsed = {
            'VERSION': 2,
            'TEMPLATE': {
                0: {
                    'Type': 'SequentialWorkflowActivity',
                    'Name': 'Template',
                    'Activated': 'Y',
                    'Node': None,
                    'Properties': {'Title': 'Bizproc Automation template'},
                    'Children': {},
                }
            },
            'PARAMETERS': {},
            'VARIABLES': {},
            'CONSTANTS': {},
            'DOCUMENT_FIELDS': {},
        }
        self._backup = copy.deepcopy(self._parsed)

    def _get_root_children(self):
        """Retorna el dict mutable de hijos del nodo raíz."""
        template = self._parsed['TEMPLATE']
        root = list(template.values())[0] if isinstance(template, dict) else template
        return root['Children']

    def append_activities(self, activities):
        """
        Agrega una lista de actividades al final del flujo principal.

        Args:
            activities: lista de dicts de actividad (construidos con make_*)
        """
        children = self._get_root_children()
        next_idx = max(children.keys(), default=-1) + 1 if children else 0
        for i, act in enumerate(activities):
            children[next_idx + i] = act

    def prepend_activities(self, activities):
        """Agrega actividades al inicio del flujo principal."""
        children = self._get_root_children()
        # Reindexar existentes
        existing = {k + len(activities): v for k, v in children.items()}
        for i, act in enumerate(activities):
            existing[i] = act
        children.clear()
        children.update(existing)

    def insert_after(self, activity_name, new_activities):
        """
        Inserta actividades inmediatamente después de la actividad con ese Name.

        Args:
            activity_name: valor de 'Name' de la actividad de referencia (ej: 'A2319_14104_24651_4061')
            new_activities: lista de dicts de actividad
        """
        children = self._get_root_children()
        result = {}
        idx = 0
        inserted = False
        for k in sorted(children.keys()):
            result[idx] = children[k]
            idx += 1
            if children[k].get('Name') == activity_name and not inserted:
                for act in new_activities:
                    result[idx] = act
                    idx += 1
                inserted = True
        children.clear()
        children.update(result)
        if not inserted:
            raise ValueError(f"Actividad '{activity_name}' no encontrada en el flujo principal")

    def remove_activity(self, activity_name):
        """Elimina una actividad del flujo principal por su Name."""
        children = self._get_root_children()
        to_remove = None
        for k, v in children.items():
            if v.get('Name') == activity_name:
                to_remove = k
                break
        if to_remove is None:
            raise ValueError(f"Actividad '{activity_name}' no encontrada")
        del children[to_remove]
        # Reindexar
        reindexed = {i: v for i, (k, v) in enumerate(sorted(children.items()))}
        children.clear()
        children.update(reindexed)

    def apply_value_mapping(self, mapping):
        """
        Reemplaza valores en todo el template según un mapa de traducción.
        Útil para adaptar un template de un portal a otro.

        Args:
            mapping: dict {valor_origen: valor_destino}
            Ej: {
                'user_3094': 'user_7821',
                'UC_YK9ZP0': 'NEW_STAGE_CODE',
                '{=Document:UF_CRM_1657652846}': '{=Document:UF_CRM_9999999}'
            }
        """
        self._parsed = _replace_values_recursive(self._parsed, mapping)

    def get_activity_names(self):
        """Retorna lista de (index, Name, Type, Title) de actividades del flujo principal."""
        children = self._get_root_children()
        result = []
        for k in sorted(children.keys()):
            act = children[k]
            title = (act.get('Properties') or {}).get('Title', '')
            result.append((k, act.get('Name', ''), act.get('Type', ''), title))
        return result

    def save(self, output_path):
        """
        Serializa el template modificado y lo guarda como .bpt.

        Args:
            output_path: ruta de destino del archivo .bpt
        """
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        # Serializar a PHP
        raw_php = phpserialize.dumps(self._parsed)

        # Comprimir con zlib (nivel 6, wbits=15 → zlib format con header 78 DA)
        compressed = zlib.compress(raw_php, level=6)

        output_path.write_bytes(compressed)
        print(f"Guardado: {output_path} ({len(compressed)} bytes)")
        return output_path

    def restore_backup(self):
        """Revierte todos los cambios al estado original cargado."""
        self._parsed = copy.deepcopy(self._backup)


# ---------------------------------------------------------------------------
# Helpers internos
# ---------------------------------------------------------------------------

def _replace_values_recursive(obj, mapping):
    """Recorre recursivamente un dict/list/str y aplica el mapa de traducción."""
    if isinstance(obj, str):
        return mapping.get(obj, obj)
    if isinstance(obj, dict):
        return {k: _replace_values_recursive(v, mapping) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_replace_values_recursive(i, mapping) for i in obj]
    if isinstance(obj, tuple):
        return tuple(_replace_values_recursive(i, mapping) for i in obj)
    return obj


# ---------------------------------------------------------------------------
# CLI de ejemplo
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    import argparse

    ap = argparse.ArgumentParser(description='Construye o modifica un .bpt de Bitrix24')
    ap.add_argument('source', nargs='?', help='Archivo .bpt fuente (opcional)')
    ap.add_argument('--output', required=True, help='Archivo .bpt de salida')
    ap.add_argument('--list', action='store_true', help='Listar actividades del template fuente')
    args = ap.parse_args()

    b = BptBuilder(args.source) if args.source else BptBuilder()

    if args.list and args.source:
        print("Actividades en el flujo principal:")
        for idx, name, atype, title in b.get_activity_names():
            print(f"  [{idx}] {name} | {atype} | {title}")
    else:
        # Ejemplo: agregar delay + notificación al supervisor
        b.append_activities([
            make_delay(24, 'd', 'Esperar 24hs'),
            make_supervisor_notify('El deal lleva 24hs sin avanzar. Revisar.'),
        ])
        b.save(args.output)
