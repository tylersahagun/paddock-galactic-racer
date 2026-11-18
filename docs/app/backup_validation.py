from datetime import datetime
import re

ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,100}$")

def timestamp(value):
    if not isinstance(value,str): raise ValueError('Timestamp must be an ISO8601 string')
    try: parsed=datetime.fromisoformat(value.replace('Z','+00:00'))
    except ValueError: raise ValueError('Invalid ISO8601 timestamp')
    if parsed.tzinfo is None or parsed.utcoffset() is None: raise ValueError('Timestamp timezone is required')
    return parsed


def validate_json(value, depth=0):
    if depth>30: raise ValueError('JSON nesting is too deep')
    if value is None or type(value) in (str,bool,int):
        if isinstance(value,str) and len(value)>200000: raise ValueError('Text field too long')
        return
    if type(value) is float:
        import math
        if not math.isfinite(value): raise ValueError('Nonfinite values are not accepted')
        return
    if isinstance(value,list):
        if len(value)>10000: raise ValueError('Too many list items')
        for item in value: validate_json(item,depth+1)
        return
    if isinstance(value,dict):
        if len(value)>10000: raise ValueError('Too many object fields')
        for key,item in value.items():
            if not isinstance(key,str): raise ValueError('JSON keys must be strings')
            validate_json(item,depth+1)
        return
    raise ValueError('Unsupported JSON value')


def prepare_import(envelope):
    if not isinstance(envelope,dict) or type(envelope.get('schema_version')) is not int or envelope.get('schema_version')!=1 or not isinstance(envelope.get('tours'),list) or not isinstance(envelope.get('histories'),dict):
        raise ValueError('Import requires a version1 export with tours and histories')
    validate_json(envelope)
    prepared=[];seen=set()
    for latest in envelope['tours']:
        if not isinstance(latest,dict): raise ValueError('Invalid imported tour')
        tid=latest.get('id'); rev=latest.get('revision')
        if not isinstance(tid,str) or not ID_RE.fullmatch(tid) or tid in seen: raise ValueError('Imported IDs must be unique and valid')
        seen.add(tid)
        if type(rev) is not int or rev<1: raise ValueError('Invalid imported revision')
        history=envelope['histories'].get(tid)
        if not isinstance(history,list) or len(history)!=rev: raise ValueError('Complete revision history is required')
        creation=None; previous_updated=None
        for index,record in enumerate(history,1):
            if not isinstance(record,dict) or record.get('id')!=tid or type(record.get('revision')) is not int or record.get('revision')!=index: raise ValueError('Invalid revision sequence')
            created=timestamp(record.get('created_at')); updated=timestamp(record.get('updated_at'))
            if creation is None: creation=created
            if created!=creation or updated<created or (previous_updated is not None and updated<previous_updated):
                raise ValueError('Imported revision chronology is inconsistent')
            previous_updated=updated
        if history[-1]!=latest: raise ValueError('Latest record must match the final revision')
        prepared.append((tid,rev,history))
    if set(envelope['histories'])!=seen: raise ValueError('Orphan revision histories are not accepted')
    return [history for _, _, history in prepared]
