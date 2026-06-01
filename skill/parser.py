import zlib
import phpserialize

ROOT_CONTAINER_TYPES = {'SequentialWorkflowActivity', 'ParallelActivity'}


def _load(path):
    with open(path, 'rb') as f:
        raw = f.read()
    decompressed = zlib.decompress(raw)
    return phpserialize.loads(decompressed, decode_strings=True)


def _children(node):
    ch = node.get('Children')
    if not ch:
        return []
    if isinstance(ch, dict):
        return list(ch.values())
    if isinstance(ch, list):
        return ch
    return []


def _walk(node, out, depth=0):
    if not isinstance(node, dict):
        return
    code = node.get('Type')
    if code and code not in ROOT_CONTAINER_TYPES:
        out.append({
            'code': code,
            'name': node.get('Name'),
            'title': (node.get('Properties') or {}).get('Title'),
            'properties': node.get('Properties') or {},
            'depth': depth,
        })
    for child in _children(node):
        _walk(child, out, depth + 1)


def parse_bpt(path):
    data = _load(path)
    template = data.get('TEMPLATE') or {}
    root = template.get(0) if isinstance(template, dict) else (template[0] if template else None)
    activities = []
    if root is not None:
        _walk(root, activities)
    return {
        'version': data.get('VERSION'),
        'activities': activities,
        'root_keys': list(data.keys()) if isinstance(data, dict) else [],
    }


if __name__ == '__main__':
    import sys
    import json
    print(json.dumps(parse_bpt(sys.argv[1]), indent=2, ensure_ascii=False, default=str))
