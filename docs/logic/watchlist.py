"""Prepared, conditional targets for a future offer, using reviewed Paddock data.

This is a small explanation queue, not a performance ranking or a shop prediction.
It never promotes OCR text, assumes full fuel/status uptime, or applies a choice.
"""
from __future__ import annotations

from collections import OrderedDict
import copy
import hashlib
import json
from threading import RLock

from logic.advisor import advise, load_data, validate_state, _family, KINDS

VERSION = '0.1-prepared-watchlist'
_CACHE = OrderedDict()
_LOCK = RLock()
_CACHE_LIMIT = 64


def _hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'),
                                   ensure_ascii=False, allow_nan=False).encode()).hexdigest()


def _plan(item_id, reason, prerequisites, tradeoffs):
    return {'item_id': item_id, 'reason': reason, 'prerequisites': prerequisites,
            'tradeoffs': tradeoffs}


def _plans(state, items):
    installed = set(state.get('installed', []))
    traits = {'trait.afterburner_superiority', 'trait.afterburner_fuel_tank', 'trait.burn_bright'}
    stats = state.get('stats', {})
    afterburner_stat = stats.get('Afterburner') if isinstance(stats, dict) else None
    afterburner = (bool(installed & traits) or state.get('focus') == 'afterburner'
                   or (type(afterburner_stat) in (int, float) and afterburner_stat > 0)
                   or any(i.startswith('part.optimized_fuel_') for i in installed))
    regular_ability = any(items.get(i, {}).get('kind') == 'ability' for i in installed)
    cooled_source = any(i in installed for i in ['ability.vent', 'ability.supercooled_vent',
                       'part.thermoactive_fuel', 'part.coolant_cycler_iii', 'part.cooling_aerofoils',
                       'part.surplus_cooling', 'part.cooling_actuator_i'])
    plans = []
    if afterburner:
        if regular_ability:
            plans.append(_plan('part.refueling_abilities',
                'An ability-triggered refill could support repeated Afterburner use and full-fuel payoffs.',
                ['A legal regular ability activation with energy and reload available.',
                 'Some tank fuel missing for an immediate refill benefit.'],
                ['The existing source claims a full refill, not extra power or unlimited fuel.',
                 'Full-fuel bonus timing and full-use checks remain unmeasured.']))
        plans += [
            _plan('part.depleted_shielding',
                  'Adds a short protection window after a full use of your main boost.',
                  ['An actual full Afterburner use; merely equipping Afterburner traits is insufficient.'],
                  ['Only five seconds of described protection; full-use timing is unmeasured.',
                   'Shielding can prevent incoming Concussed during protection, reducing Impact Regulator trigger opportunities.']),
            _plan('part.repulsormod_i',
                  'Adds a Speed payoff whose trigger you can attempt through landing execution.',
                  ['A jump opportunity and a Perfect Landing.'],
                  ['The described window is five seconds; the Speed amount is unspecified.',
                   'Value depends on track opportunities and landing consistency.']),
            _plan('part.optimized_fuel_iv' if 'part.optimized_fuel_iii' in installed else 'part.optimized_fuel_iii',
                  'A full-fuel Afterburner payoff connects to the boost focus and possible overtake refills.',
                  ['Reach full fuel; Burn Bright restores only a fraction on each overtake.'],
                  ['Full-fuel condition timing is unknown; do not assume the bonus lasts for an entire tank.',
                   'Listed Afterburner power is not a measured speed or lap-time gain.']),
            _plan('part.surging_inlets_iii',
                  'Adds a traffic-dependent Surging path alongside Afterburner.',
                  ['Five seconds of slipstreaming before the described 20-second Surging window.'],
                  ['No guaranteed trigger in clean air or while leading; refresh and timing remain unknown.']),
        ]
        if not regular_ability:
            plans.insert(1, _plan('ability.shield',
                'Adds an on-demand defensive option while the current foundation has no regular ability.',
                ['A free ability slot or a permitted replacement, plus sufficient energy and reload readiness.'],
                ['Spends ability resources on defense; ten seconds of described protection is not permanent uptime.']))
    if cooled_source or state.get('focus') == 'ramjet':
        plans += [
            _plan('part.ramjet_accelerator_i',
                  'A Cooled payoff can connect to your recorded cooling sources.',
                  ['Actual Cooled while Ramjet is usable; installed cooling equipment does not establish uptime.'],
                  ['Energy, heat management and interruptions still constrain the benefit.']),
            _plan('part.enhanced_coolant_i',
                  'Amplifies Cooled rather than providing another status source.',
                  ['A usable Cooled source and actual Cooled uptime.'],
                  ['Does not grant Cooled or Frozen and does not guarantee sustained Ramjet.']),
            _plan('part.cooling_overcharge',
                  'A possible bridge from actual Cooled to Overcharged.',
                  ['Actual Cooled, with activation and resource timing still checked.'],
                  ['Overcharged duration/refresh and temporary-energy behavior remain unmeasured.'])]
    if regular_ability:
        plans += [
            _plan('part.refueling_abilities',
                  'Turns a legal ability activation into a possible Afterburner refill.',
                  ['A regular ability, energy and reload readiness; missing fuel for immediate value.'],
                  ['Refill alone is not a self-sustaining energy loop.']),
            _plan('part.ability_catalyst',
                  'Ability activations can develop a source-described Afterburner refill-rate benefit.',
                  ['Legal ability activations and useful remaining race time.'],
                  ['Accumulation, cap and persistence are unmeasured; no exact pace gain is known.']),
            _plan('part.shield_cycler_i',
                  'Adds a source-described protection window to ability activation.',
                  ['A legal ability activation with energy and reload available.'],
                  ['Protection is timed; overlap does not prove increased potency or permanent shielding.']),
        ]
    if not cooled_source and (state.get('focus') == 'ramjet' or 'part.ramjet_cooling_i' in installed):
        plans.insert(0, _plan('ability.vent',
            'Provides an explicit Cooled source before investing in additional Cooled-only payoffs.',
            ['Legal activation, sufficient energy and reload readiness.'],
            ['Vent is not Supercooled Vent; it does not establish Frozen or unlimited boost.']))
    if installed:
        plans.append(_plan('part.repulsormod_i',
            'A possible standalone Speed window from a Perfect Landing.',
            ['A jump opportunity and a Perfect Landing.'],
            ['Landing consistency and the unspecified Speed amount determine practical value.']))
    return plans


def _replacement(item, state, items):
    current = [items[i] for i in state.get('installed', []) if i in items]
    same_family = [i for i in current if _family(i['id']) == _family(item['id'])]
    if same_family:
        old = same_family[0]
        if (type(item.get('tier')) is int and type(old.get('tier')) is int
                and item['tier'] > old['tier']):
            return old['id'], False
        return None, True  # Do not suggest a duplicate, downgrade or unverified tier substitution.
    cap_key = {'part': 'parts', 'ability': 'abilities', 'crash_ability': 'crash_abilities'}[item['kind']]
    cap = state.get('caps', {}).get(cap_key)
    count = sum(i['kind'] == item['kind'] for i in current)
    full = state.get('constraints_observed') is True and type(cap) is int and count >= cap
    if not full:
        return None, False
    if cap == 0:
        return None, True
    # This is an explicit suggestion for review, never a confirmed replacement.
    if item['kind'] == 'part':
        for iid in ['part.impact_regulator_ii', 'part.impact_regulator_iii']:
            if iid in state.get('installed', []):
                return iid, False
    return None, False


def prepare_watchlist(state, *, tour_id=None, revision=None, limit=3):
    """Return conditional future targets bound to this exact build and catalog.

    Pass the tour identity and revision for cache isolation. Anonymous calls are
    not cached. Callers must discard a response after any binding changes.
    """
    if type(limit) is not int or not 1 <= limit <= 10:
        raise ValueError('Watchlist limit must be an integer from 1 to 10')
    if tour_id is not None and (not isinstance(tour_id, str) or not tour_id):
        raise ValueError('tour_id must be a nonempty string or null')
    if revision is not None and (type(revision) is not int or revision < 1):
        raise ValueError('revision must be a positive integer or null')
    if not isinstance(state, dict):
        raise ValueError('state must be an object')
    catalog, effects, graph = load_data()
    data = (catalog, effects, graph)
    items = {i['id']: i for i in catalog['items']}
    custom = state.get('custom_items', [])
    if not isinstance(custom, list):
        raise ValueError('custom_items must be a list')
    for i in custom:
        if not isinstance(i, dict) or not isinstance(i.get('id'), str) or not i['id'].startswith('custom.'):
            raise ValueError('Custom IDs must start custom.')
        if i['id'] in items or i.get('kind') not in KINDS or not isinstance(i.get('name'), str) or not i['name'].strip():
            raise ValueError('Invalid or duplicate custom item')
        items[i['id']] = {**i, 'effect_ids': [], 'unmodeled': True}
    # Validate using an ordinary known item without asserting it is actually offered.
    validate_state(state, [{'item_id': 'ability.vent', 'price': None}], items)
    build_fingerprint = _hash({'state': state, 'catalog': catalog, 'effects': effects, 'graph': graph,
                               'watchlist_version': VERSION})
    cache_key = (tour_id, revision, build_fingerprint, limit)
    if tour_id is not None:
        with _LOCK:
            if cache_key in _CACHE:
                _CACHE.move_to_end(cache_key)
                return copy.deepcopy(_CACHE[cache_key])
    sources = {s['id']: s for s in catalog['sources']}
    unknown = [{'id': iid, 'name': items[iid]['name']} for iid in state.get('installed', [])
               if not items[iid].get('effect_ids')]
    result = {'version': VERSION, 'build_fingerprint': build_fingerprint,
              'tour_id': tour_id, 'revision': revision,
              'label': 'Look for next · conditional future targets', 'entries': [],
              'unknown_items': unknown,
              'limitations': [
                  'These targets are alternative next choices, not a bundle; they are not current offers, guaranteed stock, affordable purchases, or a performance ranking.',
                  'Confirm actual tier, price, slot limits and permitted replacement when an item is offered.',
                  'Prepared advice uses durable build connections; temporary statuses are not assumed to persist into the next decision.',
                  'Stats are recorded but do not drive a calibrated physical-performance model.']}
    if unknown:
        result['limitations'].append('Unmodeled equipped items may change the comparison; this is not a complete ranking.')
    proposed = set()
    for plan in _plans(state, items):
        iid = plan['item_id']
        if iid in proposed or iid in state.get('installed', []) or iid not in items:
            continue
        proposed.add(iid)
        candidate = items[iid]
        replacement, skip = _replacement(candidate, state, items)
        if skip or not candidate.get('effect_ids'):
            continue
        prospective = copy.deepcopy(state)
        prospective['observations'] = {}
        prospective.pop('observed_events', None)
        option = {'item_id': iid, 'price': None, 'offered_in_game': False,
                  'replaces': replacement, 'replacement_confirmed': False}
        comparison = advise(prospective, [option], data)['options'][0]
        tradeoffs = list(plan['tradeoffs'])
        needs_replacement = any('exceeds the observed' in b for b in comparison['blockers'])
        if comparison['blockers'] and not needs_replacement:
            continue
        if needs_replacement:
            tradeoffs.append('The observed slots are full. A permitted replacement is required; none is selected by this watchlist.')
        if replacement:
            tradeoffs.append('Consider replacing '+items[replacement]['name']+' only if the game permits it; its effects would be lost.')
            tradeoffs += comparison['replacement_losses']
        if iid == 'part.refueling_abilities' and any(i.startswith('part.optimized_fuel_') for i in state.get('installed', [])):
            tradeoffs.append('A refill can reach full fuel; it does not settle when Optimized Fuel checks its condition.')
        entry_sources = [sources[candidate['source_id']]]
        for installed in state.get('installed', []):
            sid = items[installed].get('source_id')
            if sid in sources and sid not in {s['id'] for s in entry_sources}:
                entry_sources.append(sources[sid])
        result['entries'].append({**plan, 'name': candidate['name'], 'fit': 'conditional',
            'tradeoffs': list(dict.fromkeys(tradeoffs)), 'replaces': replacement,
            'replacement_name': items[replacement]['name'] if replacement else None,
            'replacement_required': needs_replacement or replacement is not None,
            'sources': copy.deepcopy(entry_sources), 'availability': 'hypothetical_future_offer',
            'affordability': 'unknown_until_offered',
            'evidence_status': candidate.get('evidence_status', 'source_claim'),
            'advisor_fit': comparison['fit'], 'advisor_unknowns': comparison['unknowns']})
        if len(result['entries']) == limit:
            break
    if not result['entries']:
        result['limitations'].insert(0, 'Record the actual starting equipment or build intention to prepare useful targets; no previous tour is assumed.')
    if tour_id is not None:
        with _LOCK:
            _CACHE[cache_key] = copy.deepcopy(result)
            _CACHE.move_to_end(cache_key)
            while len(_CACHE) > _CACHE_LIMIT:
                _CACHE.popitem(last=False)
    return result
