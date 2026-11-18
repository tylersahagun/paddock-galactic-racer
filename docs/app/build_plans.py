"""Validate planned builds without treating them as observed tour equipment."""
import json
from pathlib import Path

from logic.advisor import catalog_response

ROOT = Path(__file__).resolve().parents[1]
STATS = {'Cornering','Afterburner','Resilience','Ramjet','Battery','Advanced handling'}
VEHICLES = {'','Speeder Bike','Landspeeder','Skim Speeder'}


def validate_plan(payload):
    if not isinstance(payload,dict):
        raise ValueError('Build must be an object')
    guides=json.loads((ROOT/'research/character-guides.json').read_text())
    racers={r['id']:r for r in guides['characters']}
    equipment={i['id']:i for i in catalog_response()['items']}
    equipment.update(guides['equipment'])
    name=payload.get('name','')
    if not isinstance(name,str) or not name.strip() or len(name)>120:
        raise ValueError('Give the build a name of up to 120 characters')
    if payload.get('racer_id') not in racers:
        raise ValueError('Choose a known multiplayer racer')
    if payload.get('vehicle','') not in VEHICLES:
        raise ValueError('Choose a supported vehicle or leave it unselected')
    if payload.get('stat_basis','planned_additions')!='planned_additions':
        raise ValueError('Builder points are planned additions, not observed stat levels')
    focus=payload.get('focus','open')
    if focus not in {'open','aggression','ramjet','afterburner','abilities','consistency'}:
        raise ValueError('Choose a supported playstyle')
    stats=payload.get('stats',{})
    if not isinstance(stats,dict) or not set(stats)<=STATS:
        raise ValueError('Unknown stat name')
    if any(type(v) is not int or v<0 or v>10000 for v in stats.values()):
        raise ValueError('Planned points must be nonnegative whole numbers (up to 10000 per field)')
    notes=payload.get('notes','')
    if not isinstance(notes,str) or len(notes)>20000:
        raise ValueError('Build notes are too long')
    custom=payload.get('custom_items',[])
    if not isinstance(custom,list) or len(custom)>100:
        raise ValueError('Too many custom items')
    custom_clean=[]
    for item in custom:
        if not isinstance(item,dict): raise ValueError('Invalid custom item')
        iid=item.get('id');kind=item.get('kind');title=item.get('name');description=item.get('description','')
        if not isinstance(iid,str) or not iid.startswith('custom.') or len(iid)>100 or iid in equipment:
            raise ValueError('Custom item IDs must be unique')
        if kind not in {'part','ability','crash_ability'} or not isinstance(title,str) or not title.strip() or len(title)>120:
            raise ValueError('Custom items need a name and equipment type')
        if not isinstance(description,str) or len(description)>4000:
            raise ValueError('Custom item description is too long')
        record={'id':iid,'name':title.strip(),'kind':kind,'description':description}
        custom_clean.append(record);equipment[iid]=record
    result={'name':name.strip(),'racer_id':payload['racer_id'],'vehicle':payload.get('vehicle',''),
            'stats':stats,'stat_basis':'planned_additions','focus':focus,'notes':notes,'custom_items':custom_clean}
    for group,kind in [('parts','part'),('abilities','ability'),('crash_abilities','crash_ability')]:
        ids=payload.get(group,[])
        if not isinstance(ids,list) or len(ids)>100 or any(not isinstance(i,str) for i in ids) or len(set(ids))!=len(ids):
            raise ValueError('Equipment selections must be a list of distinct IDs')
        if any(i not in equipment or equipment[i]['kind']!=kind for i in ids):
            raise ValueError('Unknown equipment or equipment in the wrong group')
        result[group]=ids
    reference=payload.get('guide_ref')
    if reference is not None:
        if not isinstance(reference,dict) or reference.get('racer_id')!=payload['racer_id'] or not any(b['id']==reference.get('build_id') for b in racers[payload['racer_id']]['builds']):
            raise ValueError('Starting guide must match this racer')
        result['guide_ref']={'racer_id':reference['racer_id'],'build_id':reference['build_id']}
    if 'revision' in payload: result['revision']=payload['revision']
    return result


def validate_backup(envelope):
    if not isinstance(envelope,dict) or envelope.get('kind')!='paddock_build_plans':
        raise ValueError('Choose a Paddock build-plan backup; tour backups belong in Tour history')
    if not isinstance(envelope.get('histories'),dict):
        raise ValueError('Build revision histories are required')
    for history in envelope['histories'].values():
        if not isinstance(history,list): raise ValueError('Invalid build history')
        for plan in history: validate_plan(plan)
    return envelope
