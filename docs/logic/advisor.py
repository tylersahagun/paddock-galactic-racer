"""Evidence-qualified synergy advice, separate from measured performance.

Rules below compare supported prerequisite connections. They do not simulate a
race, estimate win probability, or promote source claims into verified mechanics.
"""
from __future__ import annotations
import copy
import json
import math
from pathlib import Path
import re

from logic.engine import condition_result

ROOT = Path(__file__).resolve().parents[1]
VERSION = '0.3-provisional-fit'
KINDS = {'part', 'ability', 'crash_ability', 'trait', 'stat'}
CAP_KEYS = {'part':'parts', 'ability':'abilities', 'crash_ability':'crash_abilities'}
FIT_ORDER = {'strong':0, 'conditional':1, 'weak':2, 'unknown':3, 'blocked':4}


def finite(value, name, minimum=0, optional=False):
    if optional and value is None:
        return None
    if type(value) not in (int, float) or not math.isfinite(value) or value < minimum:
        raise ValueError(f'{name} must be a finite number >= {minimum}')
    return value


def load_data():
    def read(name): return json.loads((ROOT/'research'/name).read_text())
    return read('catalog.json'), read('effects.json'), read('interactions.json')


def catalog_response():
    catalog, effects, graph = load_data()
    racers = [
        {'name':kit['racer_name'], 'style':kit['racer_style'], 'kit_id':kit['id'], 'source_id':kit['source_id'], 'status':'source_claim'}
        for kit in catalog['starting_kits']]
    # Suggestions only; user can enter any actual track name. Never infer a track.
    return {'version':VERSION, 'items':catalog['items'], 'effects':effects['effects'],
            'sources':catalog['sources'], 'starting_kits':catalog['starting_kits'],
            'racers':racers, 'tracks':[], 'chains':graph['candidate_chains'],
            'coverage':{'complete_catalog':False, 'mechanics':'source_claims_and_observed_descriptions_not_runtime_verified',
                        'label':'Focused research subset; custom items supported as unmodeled inputs'}}


def validate_state(state, options, items):
    if not isinstance(state, dict) or not isinstance(options, list) or not 1 <= len(options) <= 50:
        raise ValueError('state must be an object and options must contain 1–50 choices')
    finite(state.get('credits'), 'credits', optional=True)
    installed = state.get('installed', [])
    if not isinstance(installed, list) or len(installed) > 100 or any(type(x) is not str for x in installed):
        raise ValueError('installed must be a list of item IDs')
    if len(set(installed)) != len(installed): raise ValueError('Duplicate installed IDs are not supported; record actual tier separately')
    for item_id in installed:
        if item_id not in items: raise ValueError('Unknown installed item: '+item_id)
        if items[item_id]['kind'] not in KINDS: raise ValueError('Statuses belong in observations, not equipment')
    caps = state.get('caps', {})
    if not isinstance(caps, dict): raise ValueError('caps must be an object')
    for key, value in caps.items():
        if key not in CAP_KEYS.values(): raise ValueError('Unknown equipment-cap category')
        if value is not None and (type(value) is not int or not 0 <= value <= 100): raise ValueError('Slot limits must be whole numbers from 0 to100 or null')
    if type(state.get('constraints_observed', False)) is not bool: raise ValueError('constraints_observed must be boolean')
    if state.get('remaining_stages') is not None and (type(state['remaining_stages']) is not int or not 0 <= state['remaining_stages'] <= 100):
        raise ValueError('remaining_stages must be a whole number or null')
    observations = state.get('observations', {})
    if not isinstance(observations, dict): raise ValueError('observations must be an object')
    for key, value in observations.items():
        if not isinstance(key, str): raise ValueError('Observation keys must be strings')
        if key.startswith(('status.', 'action.')) and type(value) is not bool: raise ValueError('Status/action observations must be true or false')
        if key.startswith('resource.'): finite(value, key)
    seen = set()
    for option in options:
        if not isinstance(option, dict) or not isinstance(option.get('item_id'), str): raise ValueError('Each option needs item_id')
        if option['item_id'] not in items: raise ValueError('Unknown option; add it as a custom item first')
        if option['item_id'] in seen: raise ValueError('Each offered item may appear once; combine identical offers')
        seen.add(option['item_id'])
        finite(option.get('price'), 'offered price', optional=True)
        for key in ['offered_in_game','replacement_confirmed']:
            if type(option.get(key, False)) is not bool: raise ValueError(key+' must be boolean')
        if option.get('replaces') is not None and not isinstance(option['replaces'], str): raise ValueError('Replacement must be an installed item ID')


def _family(item_id):
    return re.sub(r'_(i|ii|iii|iv|v)$', '', item_id)


def advise(state, options, data=None):
    catalog, effects_doc, graph = data or load_data()
    items = {i['id']:copy.deepcopy(i) for i in catalog['items']}
    custom = state.get('custom_items', []) if isinstance(state, dict) else []
    if not isinstance(custom, list) or len(custom)>100: raise ValueError('custom_items must be a list of at most100 entries')
    for item in custom:
        if not isinstance(item, dict) or not isinstance(item.get('id'), str) or not item['id'].startswith('custom.'):
            raise ValueError('Custom IDs must start custom.')
        if item['id'] in items: raise ValueError('Duplicate custom item ID')
        if item.get('kind') not in KINDS or not isinstance(item.get('name'), str) or not item['name'].strip():
            raise ValueError('Custom items need a name and valid equipment kind')
        items[item['id']] = {**item, 'effect_ids':[], 'source_id':None, 'unmodeled':True}
    validate_state(state, options, items)
    effects = {e['id']:e for e in effects_doc['effects']}
    source_map = {s['id']:s for s in catalog['sources']}
    installed = state.get('installed', [])
    observations = state.get('observations', {})
    def item_effects(ids):
        return [effects[e] for item_id in ids for e in items[item_id].get('effect_ids', []) if e in effects]
    def support_state(effect, target):
        reqs = effect.get('requires', [])
        if effect['item_id'] == 'trait.optimized_reserves':
            reqs = [c for c in reqs if c['state'] != 'resource.energy']
        results = [condition_result(c, observations) for c in reqs]
        if 'unsatisfied' in results or 'incompatible_type' in results:
            return 'unavailable_now'
        event = effect.get('trigger', {}).get('event')
        if event == 'ability_activation' and observations.get('action.ability_activation') is False:
            return 'unavailable_now'
        gradual = any(p['state'] == target and p['operation'] == 'gradual_buildup' for p in effect['produces'])
        if event != 'equipped' or gradual or any(r != 'satisfied' for r in results):
            return 'conditional'
        return 'supported_now'
    def producer_paths(ids, target, exclude=None):
        return [{'item_id':e['item_id'], 'support':support_state(e, target)}
                for e in item_effects(ids) if e['item_id'] != exclude
                and any(p['state']==target and p['operation'] in {'grant','apply','set','add_status','gradual_buildup'} for p in e['produces'])]
    def producers(ids, target, exclude=None):
        return [p['item_id'] for p in producer_paths(ids,target,exclude)]
    def preventers(ids, target):
        observed_statuses = [iid for iid,item in items.items() if item['kind']=='status' and observations.get(iid) is True]
        return [e['item_id'] for e in item_effects(ids+observed_statuses) if any(p['state']==target and p['operation']=='prevent' for p in e['produces'])]
    results=[]
    for option in options:
        iid=option['item_id']; item=items[iid]; replacement=option.get('replaces')
        blockers=[]; unknowns=[]; reasons=[]; connections=[]; losses=[]
        kind=item['kind']; price=option.get('price'); conditional_path=False
        if kind not in {'part','ability','crash_ability','stat'}: blockers.append('Traits and statuses are not ordinary installable shop choices; record observed traits in the build editor.')
        if price is None: unknowns.append('Actual offered price is not recorded.')
        elif state.get('credits') is None: unknowns.append('Current credits are unknown.')
        elif price>state['credits']: blockers.append('This option exceeds current credits.')
        if replacement is not None:
            if replacement not in installed: blockers.append('Replacement is not in the current build.')
            elif items[replacement]['kind'] != kind: blockers.append('Replacement crosses equipment categories.')
            else:
                losses.append('Removes '+items[replacement]['name']+'.')
                if not option.get('replacement_confirmed'): unknowns.append('Confirm that the game permits this replacement/upgrade.')
        if iid in installed and replacement != iid: blockers.append('This exact item is already installed; duplicate stacking is not modeled.')
        next_ids=[x for x in installed if x != replacement]+[iid]
        for category, cap_key in CAP_KEYS.items():
            count=sum(items[x]['kind']==category for x in next_ids)
            if not count: continue
            cap=state.get('caps',{}).get(cap_key)
            if not state.get('constraints_observed') or cap is None:
                unknowns.append('Confirm the current '+cap_key.replace('_',' ')+' limit in this mode.')
            elif count>cap: blockers.append('The resulting build exceeds the observed '+cap_key.replace('_',' ')+' limit.')
        if not option.get('offered_in_game'): unknowns.append('Option availability has not been confirmed from an actual offer.')
        if any(x!=iid and _family(x)==_family(iid) for x in next_ids): unknowns.append('Same-family tier coexistence is unverified; confirm the actual replacement.')
        if any(items[x].get('unmodeled') for x in next_ids): unknowns.append('A custom item has unmodeled effects; it may change these interactions.')
        candidate_effects=item_effects([iid])
        checks=[]; missing=[]; conflicts=[]; observed_supported=0
        for effect in candidate_effects:
            requires=list(effect.get('requires',[]))
            # Depletion is an event launching a timed buff, not a persistent prerequisite.
            if effect['item_id']=='trait.optimized_reserves':
                requires=[c for c in requires if c['state']!='resource.energy']
                reasons.append('Overcharged is triggered on depletion; a later energy rise does not by itself cancel the stated 30-second benefit.')
            for condition in requires:
                target=condition['state']; observed=condition_result(condition, observations)
                paths=producer_paths(next_ids,target,exclude=iid)
                available=[p['item_id'] for p in paths if p['support']!='unavailable_now']
                prevented=preventers(next_ids,target)
                check={'state':target,'observed':observed,'possible_sources':available,'potential_preventers':prevented,'source_paths':paths}
                checks.append(check)
                if observed=='satisfied':
                    observed_supported+=1; reasons.append('You observed '+target.replace('status.','').replace('resource.','')+' satisfying this condition now; its uptime is not assumed permanent.')
                elif available:
                    conditional_path=True
                    connections.append(target)
                    reasons.append('Connects to '+', '.join(items[x]['name'] for x in sorted(set(available)))+' through '+target.replace('status.','')+'. This is a conditional path: activation, resources or status timing have not established the benefit now.')
                else:
                    missing.append(target); reasons.append('Needs '+target.replace('status.','').replace('resource.','')+'; no known enabling item is recorded. Track or opponent effects may still supply it.')
                if prevented:
                    conflicts.append(target); unknowns.append('Potential '+target.replace('status.','')+' prevention conflict with '+', '.join(items[x]['name'] for x in sorted(set(prevented)))+'; self/external and pre-existing-state behavior is unverified.')
            for p in effect['produces']:
                if p['operation'] not in {'grant','apply','set','add_status','gradual_buildup'}: continue
                if p['state'].startswith('status.') and observations.get(p['state']) is True:
                    conditional_path=True
                    reasons.append(p['state'].replace('status.','')+' is already observed active; another source may improve later uptime, but extra potency or refresh is not assumed.')
                consumers=[e['item_id'] for e in item_effects(next_ids) if e['item_id']!=iid
                    and any(c['state']==p['state'] for c in e.get('requires',[]))]
                if consumers:
                    if support_state(effect,p['state'])!='supported_now': conditional_path=True
                    connections.append(p['state']); reasons.append('Could enable '+', '.join(items[x]['name'] for x in sorted(set(consumers)))+' through '+p['state'].replace('status.','')+'. This is a source connection, not guaranteed activation.')
                if p['operation']=='gradual_buildup': unknowns.append('Gradual status buildup is not immediate application; timing remains unknown.')
        if replacement in installed:
            # Find support lost for retained items, even if the status is observed now.
            retained=[x for x in installed if x!=replacement]
            for e in item_effects(retained):
                for c in e.get('requires',[]):
                    target=c['state']
                    if producers(installed,target) and not producers(next_ids,target):
                        losses.append(items[e['item_id']]['name']+' loses its recorded '+target.replace('status.','')+' source.')
        ramjet_target = any('ramjet' in p['state'] for e in candidate_effects for p in e['produces'])
        if ramjet_target and (observations.get('status.choked') is True or observations.get('status.disrupted') is True):
            conditional_path=True
            reasons.append('Observed Choked/Disrupted can disable Ramjet; this source-fit connection does not establish usable boost while that condition lasts.')
        if iid=='part.superconducting_ramjet':
            reasons.append('Frozen carries a steering penalty; the power modifier is not a measured speed gain or an automatic advantage on this track.')
        if iid=='part.refueling_abilities' and observations.get('resource.current_afterburner') is not None and observations.get('resource.current_afterburner')==observations.get('resource.afterburner_capacity'):
            reasons.append('Afterburner is already full: a full refill adds zero immediate fuel, though later activations may help.')
        # Newly reviewed Xbox descriptions expose prerequisites without inventing runtime uptime.
        if iid.startswith('part.optimized_fuel_'):
            unknowns.append('Full-fuel condition timing is unverified: do not assume the power bonus lasts for the entire tank or converts directly to speed.')
        if iid.startswith('part.impact_regulator_'):
            reasons.append('Requires Concussed affecting your own vehicle and then clearing; your offensive mine applies its statuses to opponents, not a demonstrated self-trigger.')
            shielding = [e['item_id'] for e in item_effects(next_ids) if any(p['state']=='status.shielded' and p['operation']=='grant' for p in e['produces'])]
            if shielding:
                unknowns.append('Potential tradeoff: timed Shielded can block incoming Concussed and reduce Impact Regulator trigger opportunities; avoiding disruption can still be beneficial.')
        if iid in {'ability.freezing_concussion_mine', 'ability.ion_bolt', 'ability.shockwave'}:
            reasons.append('The described statuses affect opponents; this does not establish those statuses on your vehicle.')
        if iid=='part.depleted_shielding':
            unknowns.append('What qualifies as a full Afterburner use and how mid-use refills affect the trigger remain unmeasured; the described Shielded window is only 5 seconds.')
        if any(p['state']=='status.shielded' and p['operation']=='grant' for e in candidate_effects for p in e['produces']) and any(x.startswith('part.impact_regulator_') for x in next_ids):
            unknowns.append('Shielded blocks externally applied statuses during its window and may prevent incoming Concussed that would have triggered Impact Regulator.')
        if iid=='crash_ability.charging_blast':
            reasons.append('This is crash recovery, not a regular ability activation: the effect requires a Crash/reset, and per-opponent Energy recovery requires affected nearby targets.')
            unknowns.append('The duration and amount of the stated Overcharged/Speed benefits are unspecified; no sustainable loop is established.')
        if item.get('unmodeled') or not candidate_effects:
            fit='unknown'; reasons.append('No reviewed effect model for this item; its description is saved without automatic mechanical assumptions.')
        elif missing:
            fit='weak' if state.get('remaining_stages') is not None and state['remaining_stages']<=1 else 'conditional'
            if fit=='weak': reasons.append('With one or fewer stages remaining, missing enablers have little known time to become useful.')
        elif conflicts or losses or conditional_path:
            fit='conditional'
        elif connections or observed_supported:
            fit='strong'
        else:
            fit='conditional'; reasons.append('The source describes a standalone effect, but the current subset does not establish a superior combination.')
        if unknowns and fit=='strong':
            # Strong mechanical connectivity can be shown, but unresolved legality must not rank as ready.
            fit='conditional'
        if blockers: fit='blocked'
        builds=[]
        for chain in graph.get('candidate_chains',[]):
            components=chain['components']
            if iid not in components: continue
            present=[x for x in components if x in next_ids]; needed=[x for x in components if x not in next_ids]
            builds.append({'id':chain['id'],'name':chain['name'],'present':present,'missing':needed,
                           'unknowns':chain['unknowns'],'complete_components':not needed,
                           'note':'Component presence is not proof of legality, uptime or best performance.'})
        evidence_items=next_ids+([replacement] if replacement in items else [])+[x for x,item_info in items.items() if item_info['kind']=='status' and observations.get(x) is True]
        source_ids={items[x].get('source_id') for x in evidence_items if items[x].get('source_id')}
        if ramjet_target and (observations.get('status.choked') is True or observations.get('status.disrupted') is True): source_ids.add('gl-glossary')
        results.append({'item_id':iid,'name':item['name'],'price':price,'eligibility':'blocked' if blockers else 'conditional' if unknowns else 'eligible',
                        'fit':fit,'reasons':blockers+list(dict.fromkeys(reasons)), 'blockers':blockers,
                        'unknowns':list(dict.fromkeys(unknowns))+['Source descriptions are not independently verified current-Xbox mechanics.','No exact speed gain or win probability is estimated.'],
                        'sources':[source_map[s] for s in sorted(source_ids) if s in source_map],
                        'builds_into':builds,'replacement_losses':list(dict.fromkeys(losses)),
                        'prerequisite_checks':checks,'resulting_installed':next_ids})
    ordered=sorted(enumerate(results),key=lambda pair:(FIT_ORDER[pair[1]['fit']],pair[0]))
    return {'version':VERSION,'label':'Provisional synergy fit','readiness':'supported_research_companion_not_validated_optimizer',
            'ranking':[r['item_id'] for _,r in ordered], 'ranking_kind':'provisional_fit_display_grouping_not_measured_performance',
            'unknown_choice_ids':[r['item_id'] for r in results if r['fit']=='unknown'], 'options':results,
            'limitations':['Fit grades compare source-supported connections, not measured speed or universal best builds.',
                           'Equipment limits and actual offers are user observations; unknown values remain unknown.',
                           'No infinite resource loop, permanent status uptime, or inferred campaign trait is assumed.']}
