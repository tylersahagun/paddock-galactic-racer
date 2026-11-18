"""Browser worker entry point. Arguments and results cross the JS boundary as JSON."""
import json

from app.backup_validation import prepare_import, validate_json
from app.build_plans import validate_backup, validate_plan
from logic.advisor import advise
from logic.watchlist import prepare_watchlist


def import_builds(backup):
    validate_backup(backup)
    return prepare_import(backup)


def analyze(body):
    return advise(body['state'], body['options'])


OPERATIONS = {
    'analyze': analyze,
    'import_builds': import_builds,
    'import_tours': prepare_import,
    'validate_plan': validate_plan,
    'watchlist': lambda body: prepare_watchlist(
        body['state'], tour_id=body['tour_id'], revision=body['revision']
    ),
}


def dispatch(operation, encoded):
    try:
        payload = json.loads(encoded)
        validate_json(payload)
        return json.dumps({'value': OPERATIONS[operation](payload)}, allow_nan=False)
    except (KeyError, TypeError, ValueError) as error:
        return json.dumps({'error': str(error)})
