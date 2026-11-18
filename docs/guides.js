import {gameGlyph, gameScript, abilityGlyph, partGlyph} from './game-assets.js';
// Read-only character guides. Recommendations never mutate tour state.
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeURL = value => { try { const u = new URL(value); return ['http:','https:'].includes(u.protocol) ? esc(u.href) : '#'; } catch { return '#'; } };
const remember = (key, value) => { try { localStorage.setItem(key, value); } catch { /* Reading still works without storage. */ } };
const recalled = key => { try { return localStorage.getItem(key); } catch { return null; } };
let guides = null, failure = '', characterId = recalled('paddock.guide.character') || 'biddy-blas';
let buildId = recalled('paddock.guide.build') || '', query = '', compact = recalled('paddock.guide.compact') === 'true';

export async function loadGuides() {
  try {
    const response = await fetch(new URL('./research/character-guides.json', import.meta.url));
    if (!response.ok) throw new Error('The guide could not be loaded.');
    const result = await response.json();
    if (!Array.isArray(result.characters) || result.characters.length !== 13 || !result.equipment) throw new Error('The guide data is incomplete.');
    guides = result; failure = ''; resolveSelection();
  } catch (error) { failure = error.message; }
}
function resolveSelection() {
  const racer = guides.characters.find(c => c.id === characterId) || guides.characters.find(c => c.id === guides.default_character) || guides.characters[0];
  const build = racer.builds.find(b => b.id === buildId) || racer.builds[0];
  characterId = racer.id; buildId = build.id;
  return {racer, build};
}
export function selectGuideRoute(hash) {
  const [, racer, build] = hash.split('/');
  if (racer) characterId = racer;
  if (build) buildId = build;
  if (guides) resolveSelection();
  remember('paddock.guide.character', characterId); remember('paddock.guide.build', buildId);
}
export const guideHash = () => `#guides/${characterId}/${buildId}`;
export const guideData = () => guides;
export function setGuideQuery(value) { query = value; }
export function toggleCompact() { compact = !compact; remember('paddock.guide.compact', String(compact)); }

function highlighted(value) {
  return esc(value).replace(/\b(Afterburner|Ramjet|Burning|Cooled|Surging|Overcharged|Shielded|Redlining|Concussed|Frozen|Energy|Speed|System Malfunction|Perfect Landing|Perfect Landings)\b/g, '<mark>$1</mark>');
}
function panelHeading(label, script, id='') {
  return `<div class="game-panel-heading">${gameScript(script,118)}<h3${id ? ` id="${id}"` : ''}>${esc(label)}</h3></div>`;
}
function effectDetails(item) {
  return `<details class="guide-deep guide-item-evidence"><summary>Effect & evidence</summary><p>${highlighted(item.effect)}</p><p class="note">${item.availability === 'observed_in_user_tour' ? 'Observed in a prior Xbox tour; future availability and runtime behavior remain unverified.' : 'Published description; confirm the actual offer and tier in standard multiplayer.'}</p>${item.url ? `<a href="${safeURL(item.url)}" target="_blank" rel="noreferrer">Read source description</a>` : `<p class="note">Observed in a previous Xbox tour.</p>`}</details>`;
}
function partRows(entries) {
  return `<ol class="guide-items guide-parts">${entries.map((entry,index) => {
    const item=guides.equipment[entry.item_id], icon=partGlyph(item,38);
    return `<li><div class="game-part-symbol${icon.exact ? ' exact-art' : ''}" title="Part category">${icon.html}<span class="game-part-order">${index+1}</span></div><div class="game-item-copy"><div class="guide-item-title"><h4>${esc(item.name)}</h4>${entry.role === 'Extension' ? '<span class="game-optional">Optional</span>' : ''}</div><p>${highlighted(entry.why)}</p>${effectDetails(item)}</div></li>`;
  }).join('')}</ol>`;
}
function abilityRows(entries, starting=false) {
  return `<${starting ? 'ul' : 'ol'} class="guide-items ${starting ? 'game-starting-abilities' : 'guide-abilities'}">${entries.map(entry => {
    const item=guides.equipment[entry.item_id];
    return `<li><div class="game-ability-symbol">${abilityGlyph(entry.item_id,41)}</div><div class="game-item-copy"><h4>${esc(item.name)}</h4><p>${highlighted(entry.why)}</p>${starting ? '' : effectDetails(item)}</div></li>`;
  }).join('')}</${starting ? 'ul' : 'ol'}>`;
}
function statHTML(build) {
  const order=['Cornering','Afterburner','Resilience','Ramjet','Battery','Advanced handling'];
  return `<aside class="game-stats-panel" aria-labelledby="guide-stat-title">${panelHeading('Stat points','stats','guide-stat-title')}<p class="game-budget-title">NEXT 10 EARNED POINTS</p><p class="guide-stat-order">${build.stats.priority.slice(0,3).map((s,i)=>`<span>${i+1}. ${esc(s)}</span>`).join('')}</p><dl class="guide-point-recipe">${order.map(name=>{
    const points=build.stats.next_10_points[name] || 0;
    return `<div class="game-stat-row"><dt>${gameGlyph(name,25,'game-extracted-glyph')}<span>${esc(name)}</span></dt><dd><span class="game-stat-pips" aria-hidden="true">${Array.from({length:10},(_,i)=>`<i class="${i<points ? 'filled' : ''}"></i>`).join('')}</span><strong>+${points}</strong></dd></div>`;
  }).join('')}</dl><p class="game-stat-caption">Suggested additions. Pips divide this ten-point budget; they are not equipped levels or stat caps.</p><details class="guide-deep game-stat-reason"><summary>Spending priorities</summary><p>${highlighted(build.stats.reason)}</p><p>${build.stats.priority.map(esc).join(' → ')}</p></details><p class="game-stat-caption">Fix handling first if you cannot hold your line. Advanced handling is Drift, Kinetic Burst or Knife Edge for your vehicle. Move capped-stat picks to the next useful priority.</p></aside>`;
}
export function guidesHTML() {
  if (!guides) return `<section class="empty-history"><h2>Character guides are unavailable</h2><p>${esc(failure || 'The guide has not loaded yet.')} Check your connection and try again.</p><button class="button secondary" data-action="retry-guides">Retry loading guides</button></section>`;
  const {racer,build}=resolveSelection();
  const matching=guides.characters.filter(c=>`${c.name} ${c.style} ${c.builds.map(b=>[b.name,...b.tags].join(' ')).join(' ')}`.toLowerCase().includes(query.toLowerCase().trim()));
  const others=racer.builds.filter(b=>b.id!==build.id);
  return `<div class="guide-workspace ${compact ? 'guide-compact' : ''}">
    <div class="guide-roster" aria-label="Character guide navigation"><label class="guide-mobile-picker" for="guide-character">Racer<select id="guide-character"${matching.length ? '' : ' disabled'}>${!matching.some(c=>c.id===racer.id) ? `<option value="" selected disabled>${matching.length ? 'Choose a matching racer' : 'No matching racers — clear search'}</option>` : ''}${matching.map(c=>`<option value="${c.id}"${c.id===racer.id ? ' selected' : ''}>${esc(c.name)} · ${esc(c.style)}</option>`).join('')}</select></label><label for="guide-search">Find a racer or synergy<input id="guide-search" type="search" placeholder="Biddy, Burning, Ramjet…" value="${esc(query)}"></label><span class="guide-roster-count">${matching.length} racers · ${racer.builds.length} builds each</span><button class="button secondary small" data-action="guide-compact" aria-pressed="${compact}">${compact ? 'Show full guide' : 'Quick reference'}</button></div>
    <article class="guide-article" aria-labelledby="guide-character-title"><nav class="guide-build-picker" aria-label="Choose a build">${racer.builds.map(b=>`<a href="#guides/${racer.id}/${b.id}"${b.id===build.id ? ' aria-current="page"' : ''}><strong>${esc(b.name)}</strong><span>${esc(b.tags.join(' · '))}</span></a>`).join('')}</nav>
    <div class="guide-build-heading"><h3 id="guide-build-title">${esc(build.name)}</h3><button class="button secondary" data-action="guide-use" data-racer="${racer.id}" data-build="${build.id}">Edit this build</button><span class="guide-evidence-label">Recommended build · performance unmeasured</span></div><p class="guide-build-summary">${highlighted(build.summary)}</p>
    <div class="game-build-board">${statHTML(build)}<div class="game-center-panels"><section class="game-style-panel" aria-labelledby="game-style-title">${panelHeading('Racer style','style','game-style-title')}<div class="game-racer-identity"><h2 id="guide-character-title">${esc(racer.name)}</h2><span>${esc(racer.style)}</span></div><dl class="game-traits">${racer.traits.map(t=>`<div><dt>${esc(t.name)}</dt><dd>${highlighted(t.effect)}</dd></div>`).join('')}</dl><a class="game-source-link guide-deep" href="${safeURL(racer.style_url)}" target="_blank" rel="noreferrer">Multiplayer trait source</a></section>
    <section class="game-abilities-panel" aria-labelledby="guide-abilities-title">${panelHeading('Abilities','abilities','guide-abilities-title')}<p class="game-group-label">Starting kit${racer.kit_note ? ' · source-conflicted' : ''}</p>${racer.kit_note ? `<p class="guide-caution">${esc(racer.kit_note)}</p>` : ''}${racer.starting_abilities.length ? abilityRows(racer.starting_abilities.map(id=>({item_id:id,why:'Starting ability · confirm the current kit in game.'})),true) : '<p class="game-empty-kit">No active ability is listed in the starting kit.</p>'}<h4 class="game-group-label">Additional abilities & upgrades</h4>${abilityRows(build.abilities)}<p class="game-stat-caption">These are targets to acquire or upgrade, not equipped selections. Confirm legal slots and upgrade paths.</p></section></div>
    <section class="game-parts-panel" aria-labelledby="guide-parts-title">${panelHeading('Target parts','parts','guide-parts-title')}<p class="game-group-label">Shopping priority · confirm legal slots</p>${partRows(build.parts)}<p class="game-stat-caption">Part icons indicate the build focus. This list does not assert a part-slot cap.</p></section></div>
    <div class="game-guide-notes"><section class="game-tactics-panel guide-deep" aria-labelledby="guide-loop-title"><h3 id="guide-loop-title">How to run this build</h3><p class="guide-choose"><strong>Choose this when:</strong> ${esc(build.choose_when)}</p><ol class="guide-mechanism" aria-label="How the synergy works">${build.loop.map(step=>`<li>${highlighted(step)}</li>`).join('')}</ol><p class="guide-swap"><strong>If the parts do not appear:</strong> ${highlighted(build.fallback)}</p></section>
    <section class="guide-pitfalls" aria-labelledby="guide-pitfalls-title"><h3 id="guide-pitfalls-title">What can break the build</h3><ul>${build.pitfalls.map(p=>`<li>${highlighted(p)}</li>`).join('')}</ul>${build.experimental_extension ? `<details class="guide-experiment"><summary>Experimental extension: longer Burning</summary><p>${esc(build.experimental_extension.why)}</p><h4>Verify before trying it</h4><ul>${build.experimental_extension.requires.map(t=>`<li>${esc(t)}</li>`).join('')}</ul><p><a href="${safeURL(guides.equipment[build.experimental_extension.item_id].url)}" target="_blank" rel="noreferrer">Unquenchable Components source</a> · Fault; standard availability unverified.</p></details>` : ''}</section></div>
    <details class="guide-method"><summary>Sources, assumptions & guide limits</summary><p>Researched ${esc(guides.reviewed_at)}. Build combinations, ordering and next-ten-point allocations are editorial inferences from descriptions.</p><ul>${guides.boundaries.map(t=>`<li>${esc(t)}</li>`).join('')}</ul><ul class="guide-source-links">${guides.sources.map(s=>`<li><a href="${safeURL(s.url)}" target="_blank" rel="noreferrer">${esc(s.title)}</a></li>`).join('')}</ul></details><p class="guide-next">Other builds: ${others.map(other=>`<a href="#guides/${racer.id}/${other.id}">${esc(other.name)}</a>`).join(' · ')}</p></article></div>`;
}
