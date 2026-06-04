#!/usr/bin/env python3
"""
validate.py — Valida datos normalizados antes de importar al catálogo Bitrix24.

Uso:
    python validate.py --data normalized_data.json --context portal_catalog_context.json

portal_catalog_context.json debe contener:
    {
        "catalogId": 24,
        "priceTypes": [{"id": 1, "name": "Minorista", "code": "BASE"}],
        "stores": [{"id": 1, "title": "Local", "code": "store_1"}],
        "existingSections": [{"id": 10, "name": "Electrónica", "parentId": null}],
        "existingProducts": [{"id": 100, "sku": "ABC001", "name": "Producto existente"}]
    }

Salida:
    JSON con errors[], warnings[], summary{} y annotated_rows[] (cada fila marcada con status).
"""

import argparse
import json
import sys
from collections import defaultdict


# ---------------------------------------------------------------------------
# Reglas de validación
# ---------------------------------------------------------------------------

def validate_products(rows, context, errors, warnings, stats):
    """Valida filas de tipo products."""
    price_type_names = {pt["name"].lower() for pt in context.get("priceTypes", [])}
    price_type_codes = {pt["code"].lower() for pt in context.get("priceTypes", [])}
    existing_skus = {p["sku"].lower(): p for p in context.get("existingProducts", [])}

    seen_skus = {}
    sku_status = {}  # sku → "new" | "update" | "skip"

    for row in rows:
        row_num = row.get("_source_row", "?")
        sku = row.get("sku", "").strip() if row.get("sku") else ""
        name = row.get("name", "").strip() if row.get("name") else ""

        # Error: SKU vacío
        if not sku:
            errors.append({"row": row_num, "field": "sku",
                           "message": "SKU vacío — fila no puede importarse sin código"})
            row["_status"] = "error"
            continue

        # Error: Nombre vacío
        if not name:
            errors.append({"row": row_num, "field": "name",
                           "message": f"SKU {sku}: nombre vacío"})
            row["_status"] = "error"
            continue

        # Error: SKU duplicado en el archivo
        sku_lower = sku.lower()
        if sku_lower in seen_skus:
            errors.append({"row": row_num, "field": "sku",
                           "message": f"SKU '{sku}' duplicado en el archivo "
                                      f"(aparece también en fila {seen_skus[sku_lower]})"})
            row["_status"] = "error"
            continue
        seen_skus[sku_lower] = row_num

        # Info: producto ya existe → actualizar
        if sku_lower in existing_skus:
            row["_status"] = "update"
            sku_status[sku] = "update"
            stats["products_to_update"] += 1
        else:
            row["_status"] = "new"
            sku_status[sku] = "new"
            stats["products_to_create"] += 1

        # Advertencia: sin sección
        if not row.get("section"):
            warnings.append({"row": row_num, "field": "section",
                             "message": f"SKU {sku}: sin sección → se ubicará en raíz del catálogo"})

        # Validar precio si viene en la misma fila
        price = row.get("price")
        if price is not None:
            try:
                price_val = float(str(price).replace(",", "."))
                if price_val < 0:
                    errors.append({"row": row_num, "field": "price",
                                   "message": f"SKU {sku}: precio negativo ({price_val})"})
                    row["_status"] = "error"
            except (ValueError, TypeError):
                errors.append({"row": row_num, "field": "price",
                               "message": f"SKU {sku}: precio no numérico ('{price}')"})
                row["_status"] = "error"

        # Advertencia: tipo de precio no existe en portal
        price_type = row.get("price_type", "")
        if price_type:
            pt_lower = price_type.lower()
            if pt_lower not in price_type_names and pt_lower not in price_type_codes:
                errors.append({"row": row_num, "field": "price_type",
                               "message": f"SKU {sku}: tipo de precio '{price_type}' "
                                          f"no existe en el portal"})

    return sku_status


def validate_prices(rows, context, errors, warnings, stats, known_skus=None):
    """Valida filas de tipo prices."""
    price_type_names = {pt["name"].lower(): pt["id"] for pt in context.get("priceTypes", [])}
    price_type_codes = {pt["code"].lower(): pt["id"] for pt in context.get("priceTypes", [])}
    existing_skus = {p["sku"].lower() for p in context.get("existingProducts", [])}
    all_known_skus = existing_skus | ({s.lower() for s in (known_skus or set())})

    for row in rows:
        row_num = row.get("_source_row", "?")
        sku = row.get("sku", "").strip() if row.get("sku") else ""

        if not sku:
            errors.append({"row": row_num, "field": "sku",
                           "message": "SKU vacío en línea de precio"})
            row["_status"] = "error"
            continue

        # Advertencia: SKU no conocido (puede estar siendo creado en esta misma importación)
        if sku.lower() not in all_known_skus:
            warnings.append({"row": row_num, "field": "sku",
                             "message": f"SKU '{sku}' no encontrado en portal "
                                        f"(se asume que se crea en esta importación)"})

        price = row.get("price")
        if price is None:
            errors.append({"row": row_num, "field": "price",
                           "message": f"SKU {sku}: precio vacío"})
            row["_status"] = "error"
            continue
        try:
            price_val = float(str(price).replace(",", "."))
            if price_val < 0:
                errors.append({"row": row_num, "field": "price",
                               "message": f"SKU {sku}: precio negativo ({price_val})"})
                row["_status"] = "error"
                continue
        except (ValueError, TypeError):
            errors.append({"row": row_num, "field": "price",
                           "message": f"SKU {sku}: precio no numérico ('{price}')"})
            row["_status"] = "error"
            continue

        price_type = row.get("price_type", "")
        if price_type:
            pt_lower = price_type.lower()
            if pt_lower not in price_type_names and pt_lower not in price_type_codes:
                errors.append({"row": row_num, "field": "price_type",
                               "message": f"SKU {sku}: tipo de precio '{price_type}' "
                                          f"no existe en el portal"})
                row["_status"] = "error"
                continue
        elif not price_type and not context.get("priceTypes"):
            errors.append({"row": row_num, "field": "price_type",
                           "message": f"SKU {sku}: no se especificó tipo de precio "
                                      f"y el portal tiene múltiples tipos"})

        if row.get("_status") != "error":
            row["_status"] = "new"
            stats["prices_to_load"] += 1


def validate_stock(rows, context, errors, warnings, stats, known_skus=None):
    """Valida filas de tipo stock."""
    store_titles = {s["title"].lower(): s["id"] for s in context.get("stores", [])}
    store_codes  = {s["code"].lower(): s["id"] for s in context.get("stores", [])}
    existing_skus = {p["sku"].lower() for p in context.get("existingProducts", [])}
    all_known_skus = existing_skus | ({s.lower() for s in (known_skus or set())})

    for row in rows:
        row_num = row.get("_source_row", "?")
        sku = row.get("sku", "").strip() if row.get("sku") else ""

        if not sku:
            errors.append({"row": row_num, "field": "sku",
                           "message": "SKU vacío en línea de stock"})
            row["_status"] = "error"
            continue

        if sku.lower() not in all_known_skus:
            warnings.append({"row": row_num, "field": "sku",
                             "message": f"SKU '{sku}' no encontrado en portal "
                                        f"(se asume que se crea en esta importación)"})

        qty = row.get("quantity")
        if qty is None:
            errors.append({"row": row_num, "field": "quantity",
                           "message": f"SKU {sku}: cantidad de stock vacía"})
            row["_status"] = "error"
            continue
        try:
            qty_val = float(str(qty).replace(",", "."))
            if qty_val < 0:
                warnings.append({"row": row_num, "field": "quantity",
                                 "message": f"SKU {sku}: stock negativo ({qty_val}) — puede indicar dato erróneo"})
        except (ValueError, TypeError):
            errors.append({"row": row_num, "field": "quantity",
                           "message": f"SKU {sku}: cantidad no numérica ('{qty}')"})
            row["_status"] = "error"
            continue

        store = row.get("store", "")
        if store:
            s_lower = store.lower()
            if s_lower not in store_titles and s_lower not in store_codes:
                errors.append({"row": row_num, "field": "store",
                               "message": f"SKU {sku}: depósito '{store}' no existe en el portal. "
                                          f"Disponibles: {', '.join(store_titles.keys())}"})
                row["_status"] = "error"
                continue
        elif len(context.get("stores", [])) > 1:
            warnings.append({"row": row_num, "field": "store",
                             "message": f"SKU {sku}: no se especificó depósito y hay múltiples "
                                        f"({len(context['stores'])})"})

        if row.get("_status") != "error":
            row["_status"] = "new"
            stats["stock_lines_to_load"] += 1


def validate_discounts(rows, context, errors, warnings, stats):
    """Valida reglas de descuento por volumen."""
    for row in rows:
        row_num = row.get("_source_row", "?")
        from_qty = row.get("discount_from_qty")
        disc_pct = row.get("discount_pct")

        if from_qty is None and disc_pct is None:
            warnings.append({"row": row_num, "message": "Fila de descuento sin cantidad ni porcentaje, ignorada"})
            row["_status"] = "skip"
            continue

        if from_qty is not None:
            try:
                float(str(from_qty).replace(",", "."))
            except (ValueError, TypeError):
                errors.append({"row": row_num, "field": "discount_from_qty",
                               "message": f"Cantidad mínima de descuento no numérica ('{from_qty}')"})
                row["_status"] = "error"
                continue

        if disc_pct is not None:
            try:
                pct = float(str(disc_pct).replace(",", ".").replace("%", ""))
                if not (0 <= pct <= 100):
                    warnings.append({"row": row_num, "field": "discount_pct",
                                    "message": f"Porcentaje de descuento fuera de rango ({pct}%)"})
            except (ValueError, TypeError):
                errors.append({"row": row_num, "field": "discount_pct",
                               "message": f"Porcentaje de descuento no numérico ('{disc_pct}')"})
                row["_status"] = "error"
                continue

        if row.get("_status") != "error":
            row["_status"] = "new"
            stats["discount_rules_to_load"] += 1


# ---------------------------------------------------------------------------
# Runner principal
# ---------------------------------------------------------------------------

def validate_all(normalized_data, context):
    errors = []
    warnings = []
    stats = defaultdict(int)
    annotated_data = {}

    known_skus = set()  # SKUs que se crearán en esta importación (para cross-validación)

    # Primera pasada: recolectar SKUs nuevos de sheets de productos
    for sheet_name, sheet_data in normalized_data.get("data", {}).items():
        sheet_type = sheet_data.get("type")
        if sheet_type in ("products", "mixed"):
            for row in sheet_data["rows"]:
                sku = row.get("sku", "").strip()
                if sku:
                    known_skus.add(sku)

    # Segunda pasada: validar cada sheet según su tipo
    for sheet_name, sheet_data in normalized_data.get("data", {}).items():
        sheet_type = sheet_data.get("type")
        rows = sheet_data.get("rows", [])
        annotated_rows = [dict(r) for r in rows]  # copia para anotar

        if sheet_type in ("products", "mixed"):
            sku_status = validate_products(annotated_rows, context, errors, warnings, stats)
            # Si es mixed, validar también precios y stock de las mismas filas
            if sheet_type == "mixed":
                price_rows = [r for r in annotated_rows if r.get("price")]
                validate_prices(price_rows, context, errors, warnings, stats, known_skus)
                stock_rows = [r for r in annotated_rows if r.get("quantity")]
                validate_stock(stock_rows, context, errors, warnings, stats, known_skus)

        elif sheet_type == "prices":
            validate_prices(annotated_rows, context, errors, warnings, stats, known_skus)

        elif sheet_type == "stock":
            validate_stock(annotated_rows, context, errors, warnings, stats, known_skus)

        elif sheet_type == "discounts":
            validate_discounts(annotated_rows, context, errors, warnings, stats)

        else:
            warnings.append(f"Hoja '{sheet_name}': tipo '{sheet_type}' no reconocido, ignorada.")

        annotated_data[sheet_name] = {
            "type": sheet_type,
            "rows": annotated_rows,
        }

    # Contar secciones nuevas
    existing_section_names = {s["name"].lower() for s in context.get("existingSections", [])}
    new_sections = set()
    for sheet_data in normalized_data.get("data", {}).values():
        for row in sheet_data.get("rows", []):
            sec = row.get("section", "").strip().lower()
            if sec and sec not in existing_section_names:
                new_sections.add(sec)
    stats["sections_to_create"] = len(new_sections)

    return {
        "errors": errors,
        "warnings": warnings,
        "summary": dict(stats),
        "can_proceed": len(errors) == 0,
        "annotated_data": annotated_data,
    }


def format_report(result):
    """Genera reporte legible para mostrar al usuario."""
    lines = []

    if result["errors"]:
        lines.append(f"ERRORES ({len(result['errors'])} — bloquean la importación):")
        for e in result["errors"]:
            row = e.get("row", "?")
            lines.append(f"  - Fila {row}: {e['message']}")
        lines.append("")

    if result["warnings"]:
        lines.append(f"ADVERTENCIAS ({len(result['warnings'])} — la importación puede continuar):")
        for w in result["warnings"]:
            row = w.get("row", "?") if isinstance(w, dict) else "?"
            msg = w["message"] if isinstance(w, dict) else w
            lines.append(f"  - Fila {row}: {msg}" if row != "?" else f"  - {msg}")
        lines.append("")

    s = result["summary"]
    lines.append("RESUMEN:")
    if s.get("sections_to_create"):
        lines.append(f"  Secciones nuevas a crear:   {s['sections_to_create']}")
    if s.get("products_to_create"):
        lines.append(f"  Productos a crear:           {s['products_to_create']}")
    if s.get("products_to_update"):
        lines.append(f"  Productos a actualizar:      {s['products_to_update']}")
    if s.get("prices_to_load"):
        lines.append(f"  Precios a cargar:            {s['prices_to_load']}")
    if s.get("stock_lines_to_load"):
        lines.append(f"  Líneas de stock a cargar:    {s['stock_lines_to_load']}")
    if s.get("discount_rules_to_load"):
        lines.append(f"  Reglas de descuento:         {s['discount_rules_to_load']}")

    lines.append("")
    if result["can_proceed"]:
        lines.append("✓ Sin errores — listo para mostrar preview y confirmar con el usuario.")
    else:
        lines.append("✗ Hay errores — corregir el archivo antes de continuar.")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Valida datos normalizados para catalog-importer.")
    parser.add_argument("--data", required=True, help="JSON producido por parse_input.py")
    parser.add_argument("--context", required=True, help="JSON con datos del catálogo del portal")
    parser.add_argument("--output", help="Archivo de salida JSON con resultado de validación")
    args = parser.parse_args()

    with open(args.data, encoding="utf-8") as f:
        normalized_data = json.load(f)

    with open(args.context, encoding="utf-8") as f:
        context = json.load(f)

    result = validate_all(normalized_data, context)

    report = format_report(result)
    print(report)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2, default=str)
        print(f"\nResultado detallado guardado en: {args.output}")

    sys.exit(0 if result["can_proceed"] else 1)


if __name__ == "__main__":
    main()
