"""Conservative, evidence-aware decision analysis of the research catalog.

No heuristic score is presented as measured performance. Trigger conditions are
checked against observations, never assumed from shared keywords or graph cycles.
"""
from __future__ import annotations

import math
from decimal import Decimal, ROUND_FLOOR, ROUND_CEILING

VERSION = "0.1-research"
TRUSTED = {"verified", "user_observed", "synthetic_fixture"}


def condition_result(condition, observations):
    key = condition["state"]
    if key not in observations:
        return "unknown"
    left, right = observations[key], condition["value"]
    op = condition["op"]
    if key.startswith(("status.", "action.")) and (type(left) is not bool or type(right) is not bool):
        return "incompatible_type"
    if key.startswith("resource.") and any(type(v) not in (int, float) or not math.isfinite(v) for v in (left, right)):
        return "incompatible_type"
    operations = {
        "==": lambda: left == right, "!=": lambda: left != right,
        ">=": lambda: left >= right, "<=": lambda: left <= right,
        ">": lambda: left > right, "<": lambda: left < right,
        "eq": lambda: left == right, "gte": lambda: left >= right,
        "lte": lambda: left <= right,
    }
    if op not in operations:
        return "unsupported_operator"
    try:
        return "satisfied" if operations[op]() else "unsatisfied"
    except TypeError:
        return "incompatible_type"


def analyze(state, options, catalog, effects):
    """Return eligibility and conditional links, deliberately no speed ranking.

    `rules` and `availability_overrides` require evidence/status, not just values.
    Fixture assumptions can exercise logic, but cannot clear the product gate.
    Each option is one install/replacement; unknown prices and caps block legality.
    """
    items = {item["id"]: item for item in catalog["items"]}
    effect_map = {effect["id"]: effect for effect in effects["effects"]}
    installed = state.get("installed", [])
    if len(set(installed)) != len(installed):
        raise ValueError("Duplicate installed IDs require a verified stacking model")
    if any(item not in items for item in installed):
        raise ValueError("Unknown installed item")
    credits = state.get("credits")
    if type(credits) not in (int, float) or not math.isfinite(credits) or credits < 0:
        raise ValueError("credits must be a finite nonnegative number")
    observations = state.get("observations", {})
    results = []
    for option in options:
        item_id = option["item_id"]
        if item_id not in items:
            raise ValueError(f"Unknown option: {item_id}")
        item = items[item_id]
        blockers, unknowns = [], []
        price = option.get("price")
        if price is None:
            unknowns.append("offered_price_unknown")
        elif isinstance(price, bool) or not isinstance(price, (int, float)) or not math.isfinite(price) or price < 0:
            raise ValueError("price must be finite and nonnegative")
        elif price > state["credits"]:
            blockers.append("unaffordable")
        replace = option.get("replace")
        if replace is not None and replace not in installed:
            blockers.append("replacement_not_installed")
        elif replace is not None:
            if items[replace]["kind"] != item["kind"]:
                blockers.append("cross_kind_replacement")
            rule = state.get("rules", {}).get("replacement_allowed", {})
            if rule.get("status") not in TRUSTED or not rule.get("evidence"):
                unknowns.append("replacement_rule_unverified")
            elif rule.get("value") is not True:
                blockers.append("replacement_disallowed")
        if item_id in installed and replace != item_id:
            unknowns.append("duplicate_stacking_unverified")
        # Check the entire post-choice loadout, including loss of an enabler.
        next_ids = [old for old in installed if old != replace] + [item_id]
        slot = state.get("rules", {}).get("part_slots", {})
        if slot.get("status") not in TRUSTED or not slot.get("evidence"):
            unknowns.append("part_slot_rule_unverified")
        elif type(slot.get("value")) is not int or slot["value"] < 0:
            raise ValueError("part_slots must be a nonnegative integer")
        elif sum(items[k]["kind"] == "part" for k in next_ids) > slot["value"]:
            blockers.append("part_slots_exceeded")
        # Until active/crash slot constraints are implemented, ability changes abstain.
        if any(items[k]["kind"] != "part" for k in next_ids):
            unknowns.append("non_part_equipment_legality_not_implemented")
        if sum(items[k]["kind"] == "part" for k in next_ids) > 1:
            rule = state.get("rules", {}).get("part_coexistence", {})
            if rule.get("status") not in TRUSTED or not rule.get("evidence"):
                unknowns.append("part_coexistence_and_family_stacking_unverified")
            elif rule.get("value") is not True:
                blockers.append("part_coexistence_disallowed")
        for next_id in next_ids:
            candidate = items[next_id]
            available = state.get("availability_overrides", {}).get(next_id, {})
            if not (available.get("status") in TRUSTED and available.get("evidence")):
                unknowns.append(f"standard_availability_unverified:{next_id}")
        next_effects = [effect_map[eid] for k in next_ids for eid in items[k].get("effect_ids", [])]
        checks = []
        for effect in next_effects:
            prerequisites = effect.get("requires", []) + effect.get("trigger", {}).get("conditions", [])
            requirements = []
            for condition in prerequisites:
                result = condition_result(condition, observations)
                # A candidate producer is only a possible chain, never proof of uptime.
                producers = sorted({other["item_id"] for other in next_effects
                    if other["id"] != effect["id"]
                    and any(p.get("state") == condition["state"]
                        and p.get("operation") in {"grant", "set", "apply", "add_status"}
                        for p in other.get("produces", []))})
                preventers = sorted({other["item_id"] for other in next_effects
                    if any(p.get("state") == condition["state"]
                        and p.get("operation") == "prevent" for p in other.get("produces", []))})
                requirements.append({**condition, "result": result, "possible_producers": producers,
                    "potential_preventers": preventers,
                    "potential_conflict": bool(preventers),
                    "prevention_scope_and_timing": "unverified" if preventers else None})
            event = effect.get("trigger", {}).get("event")
            event_result = "satisfied" if event == "equipped" or event in state.get("observed_events", []) else "unknown"
            checks.append({"effect_id": effect["id"], "item_id": effect["item_id"],
                "trigger": effect.get("trigger"), "requirements": requirements,
                "trigger_event_result": event_result,
                "active_effect_confirmed": False,
                "source_id": effect.get("evidence", {}).get("source_id"),
                "interpretation": "prerequisites_only_not_measured_benefit"})
        results.append({"item_id": item_id, "eligibility": "infeasible" if blockers else (
            "insufficient_evidence" if unknowns else "passive_checks_passed_not_full_legality"),
            "blockers": sorted(set(blockers)), "unknowns": sorted(set(unknowns)),
            "replaced": replace, "resulting_items": next_ids, "effect_checks": checks})
    return {"version": VERSION, "ranking": None,
        "product_gate": "HOLD",
        "reason": "Legality checks and prerequisites do not establish comparative race performance.",
        "synthetic_assumptions": state.get("synthetic_fixture", False), "options": results}


def activation_bound(energy, cost, reload_seconds, race_seconds):
    """Scenario-only upper bound with no regeneration, one ability, at t=0.

    Activation times must be strictly before race end. Instant activation and no
    other restrictions are assumed. This is not a fitted Galactic Racer model.
    """
    vals = (energy, cost, reload_seconds, race_seconds)
    if any(isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x) for x in vals):
        raise ValueError("finite numeric inputs required")
    if energy < 0 or cost <= 0 or reload_seconds <= 0 or race_seconds < 0:
        raise ValueError("positive cost/reload and nonnegative energy/duration required")
    e, c, reload, duration = (Decimal(str(v)) for v in vals)
    return min(int((e / c).to_integral_value(rounding=ROUND_FLOOR)),
               int((duration / reload).to_integral_value(rounding=ROUND_CEILING)))


def heat_window(current_heat, threshold, heating_rate, cooling_rate):
    """Constant-rate scenario until threshold; no game coefficients assumed."""
    vals = (current_heat, threshold, heating_rate, cooling_rate)
    if any(isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x) for x in vals):
        raise ValueError("finite numeric inputs required")
    if min(vals) < 0 or threshold <= 0:
        raise ValueError("nonnegative inputs and a positive threshold required")
    if current_heat >= threshold:
        return {"seconds": 0, "interpretation": "threshold_already_reached"}
    net = heating_rate - cooling_rate
    if net <= 0:
        return {"seconds": None, "interpretation": "no_threshold_crossing_in_constant_rate_scenario"}
    return {"seconds": (threshold-current_heat)/net, "interpretation": "constant_rate_scenario_only"}
