"""
test_roundtrip.py — Gate de seguridad del builder.py de BizProc.

Antes de habilitar la ESCRITURA/IMPORTACIÓN de un .bpt, este test verifica que
el builder serializa y reconstruye la estructura de forma fiel:

    estructura en memoria  --save()-->  .bpt (PHP + zlib)  --load()-->  estructura

Si el round-trip no es estructuralmente equivalente, el builder NO es confiable
y la skill bizproc debe limitarse a LEER/EXPORTAR (no importar).

Equivalencia PHP: phpserialize representa los arrays PHP como dicts con claves
enteras. Por eso una lista Python `['a','b']` y un dict `{0:'a',1:'b'}` son el
MISMO array en PHP. La normalización de abajo colapsa ambos a la misma forma
antes de comparar (es la representación que Bitrix realmente consume).

Uso:
    python test_roundtrip.py [--bpt archivo_real.bpt]

  - Sin argumentos: construye un template sintético representativo (delay,
    notificación, if/else con ramas, while, parallel, tarea) y valida el
    round-trip del builder + interop con el parser.
  - Con --bpt: además valida el round-trip sobre un .bpt REAL exportado del
    portal (load -> save -> load), el caso que exige el spec.

Salida: imprime PASS/FAIL y termina con código 0 (ok) o 1 (falló el gate).
"""

import sys
import json
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

try:
    import phpserialize  # noqa: F401
except ImportError:
    print("ERROR: Instalar phpserialize con: pip install phpserialize")
    sys.exit(1)

from builder import (
    BptBuilder,
    make_delay,
    make_notify_internal,
    make_ifelse,
    make_while,
    make_parallel,
    make_create_task,
    make_change_stage,
)
from parser import parse_bpt


# ---------------------------------------------------------------------------
# Normalización para comparación estructural (equivalencia PHP)
# ---------------------------------------------------------------------------

def normalize(obj):
    """
    Colapsa la estructura a su forma PHP canónica:
      - listas/tuplas -> dict con claves "0","1",... (igual que un array PHP)
      - claves de dict -> string (PHP no distingue 0 de "0" como clave de array)
      - bytes -> str
    Así, una lista Python y el dict int-keyed que devuelve phpserialize al
    releer se comparan como iguales.
    """
    if isinstance(obj, (list, tuple)):
        return {str(i): normalize(v) for i, v in enumerate(obj)}
    if isinstance(obj, dict):
        return {str(k): normalize(v) for k, v in obj.items()}
    if isinstance(obj, bytes):
        return obj.decode("utf-8", "replace")
    return obj


def first_diff(a, b, path="root"):
    """Devuelve una descripción del primer punto donde a y b difieren, o None."""
    if isinstance(a, dict) and isinstance(b, dict):
        ka, kb = set(a), set(b)
        if ka != kb:
            return f"{path}: claves distintas. solo_en_A={ka - kb} solo_en_B={kb - ka}"
        for k in a:
            d = first_diff(a[k], b[k], f"{path}.{k}")
            if d:
                return d
        return None
    if a != b:
        return f"{path}: {a!r} != {b!r}"
    return None


def assert_roundtrip(parsed_before, label):
    """Guarda parsed_before en un .bpt, lo relee y compara estructuralmente."""
    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / "rt.bpt"

        b = BptBuilder()
        b._parsed = parsed_before
        b.save(str(out))

        # magic zlib correcto
        magic = out.read_bytes()[:2]
        if magic not in (b"\x78\xda", b"\x78\x9c"):
            return False, f"[{label}] magic zlib inesperado: {magic.hex()}"

        reloaded = BptBuilder(str(out))._parsed

        diff = first_diff(normalize(parsed_before), normalize(reloaded))
        if diff:
            return False, f"[{label}] round-trip NO fiel -> {diff}"

        # interop: el parser debe poder leer lo que el builder escribió
        try:
            parsed_view = parse_bpt(str(out))
        except Exception as e:  # noqa: BLE001
            return False, f"[{label}] el parser no pudo leer el .bpt del builder: {e}"

        return True, f"[{label}] OK ({len(parsed_view.get('activities', []))} actividades de nivel raíz)"


# ---------------------------------------------------------------------------
# Template sintético representativo
# ---------------------------------------------------------------------------

def build_representative():
    b = BptBuilder()
    b.append_activities([
        make_delay(24, "h", "Esperar 24hs", wait_workday_user=["user_1"]),
        make_notify_internal(
            ["{=Document:ASSIGNED_BY_ID}", "user_42"],
            "El deal lleva 24hs sin avanzar",
            from_user="user_1",
        ),
        make_ifelse([
            {
                "title": "Si está ganado",
                "conditions": [{"field": "STAGE_ID", "operator": "=", "value": "WON"}],
                "activities": [
                    make_change_stage("WON", modified_by="user_1"),
                    make_create_task("Felicitar al cliente", "user_42",
                                     description="Mandar regalo", hold_to_close=True),
                ],
            },
            {
                "title": "ELSE",
                "conditions": [],
                "activities": [make_notify_internal("user_1", "Revisar el deal")],
            },
        ], title="¿Ganado?"),
        make_while(
            [{"field": "RETRIES", "operator": "<", "value": "3"}],
            [make_delay(1, "h", "Reintento")],
            title="Reintentar",
        ),
        make_parallel(
            [
                [make_notify_internal("user_1", "Rama A")],
                [make_notify_internal("user_42", "Rama B")],
            ],
            title="Avisos en paralelo",
        ),
    ])
    return b._parsed


def main():
    real_bpt = None
    if len(sys.argv) >= 3 and sys.argv[1] == "--bpt":
        real_bpt = sys.argv[2]

    results = []

    # 1. Round-trip del template sintético (cubre anidamiento y todos los make_*)
    results.append(assert_roundtrip(build_representative(), "sintético"))

    # 2. Round-trip sobre un .bpt real (load -> save -> load), si se proveyó
    if real_bpt:
        try:
            real_parsed = BptBuilder(real_bpt)._parsed
            results.append(assert_roundtrip(real_parsed, f"real:{Path(real_bpt).name}"))
        except Exception as e:  # noqa: BLE001
            results.append((False, f"[real] no se pudo cargar {real_bpt}: {e}"))
    else:
        print("AVISO: sin --bpt no se valida contra un .bpt real exportado del portal.")
        print("       Para el gate completo: python test_roundtrip.py --bpt export.bpt")

    ok = all(r[0] for r in results)
    print("\n=== RESULTADO DEL GATE DE ROUND-TRIP ===")
    for passed, msg in results:
        print(("  PASS " if passed else "  FAIL ") + msg)
    print("=========================================")
    print("GATE:", "PASS — builder habilitado para escritura" if ok
          else "FAIL — bizproc debe limitarse a leer/exportar")

    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
