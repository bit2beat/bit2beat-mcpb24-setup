import os
import pytest
from parser import parse_bpt

SAMPLE = os.path.join(os.path.dirname(__file__), 'samples', 'sample1.bpt')


@pytest.mark.skipif(not os.path.exists(SAMPLE), reason="sample real requerido")
def test_parse_returns_activity_tree():
    result = parse_bpt(SAMPLE)
    assert isinstance(result, dict)
    assert 'activities' in result
    assert isinstance(result['activities'], list)
    for act in result['activities']:
        assert 'code' in act


@pytest.mark.skipif(not os.path.exists(SAMPLE), reason="sample real requerido")
def test_sample_has_known_activities():
    acts = parse_bpt(SAMPLE)['activities']
    codes = [a['code'] for a in acts]
    # root container excluded; rest_ robot + CrmChangeStatusActivity present
    assert any(c.startswith('rest_') for c in codes)
    assert 'CrmChangeStatusActivity' in codes
    # the rest_ activity exposes its human title
    rest = next(a for a in acts if a['code'].startswith('rest_'))
    assert rest['title'] and 'Send message' in rest['title']
