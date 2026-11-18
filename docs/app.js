import {api} from './browser-api.js';
import {resultsHTML, updateResults, readResults, resultInput} from './results.js';
import {initBuilder,builderHTML,builderInput,builderChange,builderAction,builderSubmit,seedBuilder,setBuilderRoute,builderHash} from './builder.js';
import {gameGlyph,abilityGlyph,partGlyph,gameText} from './game-assets.js';
import {loadGuides, guidesHTML, selectGuideRoute, guideHash, setGuideQuery, toggleCompact, guideData} from './guides.js';
const $ = (s, root = document) => root.querySelector(s);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone = value => JSON.parse(JSON.stringify(value));
const number = value => value === '' || value == null ? null : Number(value);
function creditsAfterChoice(balance, price) {
  if (balance == null) {
    if (price === 0) return null;
    throw new Error('Record your current credits before choosing a paid offer.');
  }
  if (price > balance) throw new Error('This option costs more than your recorded credits. Update your balance first.');
  return balance-price;
}
const today = () => new Date().toLocaleDateString('en-US', {month:'short',day:'numeric'});
const date = value => new Date(value).toLocaleString('en-US', {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
const fields = ['Cornering','Afterburner','Resilience','Ramjet','Battery','Advanced handling'];
let data, tours = [], tour = null, view = 'builder', offers = [], analysis = null, search = '', filter = 'all', busy = false, customTarget = null;
let toastTimer, libraryPage=0, standingsTourId, renderedResults;
let watchlist = null, watchlistError = '';
let assistantGeneration = 0, assistantInFlight = false, watchlistKey = '', assistantDeferred = false;
const isActiveTour = () => Boolean(tour && tour.status !== 'completed');
function resetAssistant() { assistantGeneration += 1; watchlist = null; watchlistError = ''; watchlistKey = ''; }


function showError(error, target = $('#error')) { target.hidden = false; target.textContent = error.message || String(error); }
function clearError() { $('#error').hidden = true; $('#results-error').hidden = true; }
function toast(message) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').classList.add('visible'); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 3500); }
const button = (text, action, cls = '', extra = '') => `<button type="button" class="button ${cls}" data-action="${action}" ${extra}>${text}</button>`;
const selected = (a,b) => a === b ? ' selected' : '';
const item = id => data.items.find(i => i.id === id) || tour?.build?.custom_items?.find(i => i.id === id) || {id, name:id, kind:'unknown'};
const installed = () => tour?.build?.installed || [];
const optionsHTML = (items, blank = 'Choose an item…') => `<option value="">${blank}</option>` + items.map(i => `<option value="${esc(i.id)}">${esc(i.name)}</option>`).join('');
const equipItems = () => data.items.filter(i => ['part','ability','crash_ability','trait'].includes(i.kind)).concat(tour?.build?.custom_items || []);
function currentTour(t) { if (tour?.id !== t.id) resetAssistant(); tour = t; tour.build ||= {credits:0, installed:[], caps:{}, constraints_observed:false, observations:{}, custom_items:[]}; tour.events ||= []; tour.races ||= []; offers = clone(t.draft_offers || []); analysis = t.draft_analysis ? clone(t.draft_analysis) : null; localStorage.setItem('paddock.active', t.id); }
async function save(message = '', redraw = true) {
  watchlist = null; watchlistKey = ''; updateAssistantFragments();
  tour.draft_offers = clone(offers); tour.draft_analysis = analysis ? clone(analysis) : null;
  const saved = await api(`/api/tours/${tour.id}`, 'PUT', tour);
  tour = saved; tours = tours.filter(t => t.id !== saved.id); tours.unshift(saved);
  if (message) toast(message);
  if (redraw) render();
  else refreshAssistant();
}
function nav(next) { view = next; clearError(); history.replaceState(null, '', next === 'guides' ? guideHash() : next === 'builder' ? builderHash() : `#${next}`); render(); window.scrollTo({top:0}); }
function renderResults() {
  const section = $('#results');
  section.hidden = view !== 'builder';
  if (section.hidden) return;
  const selectedTour = tours.find(t => t.id === standingsTourId) || tour;
  const markup = resultsHTML(selectedTour, tours, `${today()} · Standard tour`);
  // Build edits can redraw the editor while the standings form has unsaved entries.
  if (markup !== renderedResults) {
    $('#results-content').innerHTML = markup;
    renderedResults = markup;
  }
}
function focusResults() {
  $('#results-title').focus({preventScroll:true});
  $('#results').scrollIntoView({block:'start'});
}
function render() {
  document.body.classList.toggle('guide-view', view === 'guides');
  document.body.dataset.view=view;
  document.querySelectorAll('button[data-view]').forEach(b => { b.classList.toggle('active', b.dataset.view === view); b.setAttribute('aria-current', b.dataset.view === view ? 'page' : 'false'); });
  const headings = {builder:['Build','Choose your racer. Make the build yours.'],guides:['Build guides','13 racers. Three distinct directions each.'],tour:['Tour','Your current run, from the first choice to the finish.'],library:['Parts & abilities','Find the pieces that make your build work.'],history:['Tour history','Your runs, decisions, and race-entry builds.'],research:['Research','The sources behind the recommendations.']};
  $('#page-title').textContent = headings[view][0]; $('#page-description').textContent = headings[view][1];
  $('#header-actions').innerHTML = view === 'tour' && tour ? button('New tour','new-tour','secondary') : '';
  $('#content').innerHTML = view === 'builder' ? builderHTML() : view === 'guides' ? guidesHTML() : view === 'tour' ? (tour ? liveHTML() : startHTML()) : view === 'library' ? libraryHTML() : view === 'history' ? historyHTML() : researchHTML();
  $('#coverage').textContent = ['guides','builder'].includes(view) ? '13 racers · 39 researched directions' : view==='library' ? `${referenceEntries().length} reference entries` : view==='history' ? `${tours.length} saved tour${tours.length===1?'':'s'}` : view==='tour' ? (tour?'Actual tour record':'Fresh tour setup') : 'Source claims · editorial recommendations';
  renderResults();
  if (view === 'tour' && tour) queueMicrotask(refreshAssistant);
}
function foundationHTML() {
  return `<div class="suggestion full"><strong>A starting point, not a tier list</strong><p>Ramjet Rider connects Vent to cooling payoffs. Tech Expert starts an ability-focused path. Pick a foundation you can execute, then confirm the kit in your game.</p><div class="buttons">${data.starting_kits.map(k => button(esc(k.racer_style),'suggest-kit','secondary small',`data-kit="${esc(k.id)}"`)).join('')}</div></div>`;
}
function startHTML() {
  const racers=(guideData()?.characters||[]).map(r=>r.name);
  return `<div class="intro"><form id="start-tour" class="start-form"><h2>Tour setup</h2><p>Start a fresh run. Record what is actually in your game.</p><div class="form-grid"><label class="full">Tour name<input name="name" value="${esc(today())} · Standard tour" maxlength="120" required></label><label>Racer<input name="racer" id="new-racer" list="racers" placeholder="Choose or enter a racer"><datalist id="racers">${racers.map(r=>`<option value="${esc(r)}">`).join('')}</datalist></label><label>Vehicle<select name="vehicle"><option value="">Not recorded yet</option><option>Speeder Bike</option><option>Landspeeder</option><option>Skim Speeder</option></select></label><label class="full">Current credits<input name="credits" type="number" min="0" step="1" placeholder="Unknown · record from game"></label></div><details class="details-block tour-advanced"><summary>Starting kit, stage & observed limits</summary><div class="form-grid"><label>Current stage<input name="stage" type="number" min="1" max="30" value="1" required></label><label>Stages remaining<input name="remaining" type="number" min="0" max="30" placeholder="Unknown"></label><label class="full">Build intention<select name="focus"><option value="synergy">Open to strong synergies</option><option value="ramjet">Cooling / Ramjet</option><option value="tech">Abilities / Energy</option><option value="afterburner">Afterburner</option><option value="consistency">Consistency</option></select></label><label class="full">Starting kit<select name="kit" id="new-kit"><option value="">Enter equipment manually</option>${data.starting_kits.map(k=>`<option value="${esc(k.id)}">${esc(k.label||k.racer_style)} · check in game</option>`).join('')}</select></label>${foundationHTML()}<label class="full">Game version<input name="version" placeholder="Optional"></label></div><h3 style="margin-top:22px">Observed equipment limits</h3><p class="note" style="margin-top:8px">Leave these unknown until checked in standard multiplayer.</p><div class="caps" style="margin-top:12px"><label>Parts<input name="parts" type="number" min="0" max="20" placeholder="Unknown"></label><label>Abilities<input name="abilities" type="number" min="0" max="20" placeholder="Unknown"></label><label>Crash abilities<input name="crash_abilities" type="number" min="0" max="20" placeholder="Unknown"></label></div><label class="check" style="margin-top:16px"><input name="observed" type="checkbox"><span>I checked these limits in game.</span></label></details><div class="buttons" style="margin-top:22px"><button class="button" type="submit">Start fresh tour</button></div></form><aside class="intro-aside"><h2>Ready at the grid</h2><div class="guide-list"><section><h3>A fresh build</h3><p>Previous tours stay in history. Equipment starts empty unless you choose a reference kit that matches your game.</p></section><section><h3>Record the run</h3><p>Compare actual offers, save your build before racing, then record the result.</p></section></div></aside></div>`;
}
function liveHTML() {
  const b = tour.build; const names = installed().map(id => item(id));
  return `<section class="context-strip"><div><h2>${esc(tour.name)}</h2><div class="context-meta"><span>${esc(tour.racer || 'Racer not recorded')}</span><span>${esc(tour.vehicle || 'Vehicle not recorded')}</span><span>Stage ${esc(tour.stage || 1)}</span><span>${esc(b.credits ?? 'Unknown')} credits</span><span>${esc(tour.status || 'active')}</span></div></div><div class="buttons">${button('Results','open-results','secondary small',`data-id="${esc(tour.id)}"`)}${button(tour.pending_race ? 'Race build saved' : 'Save race-entry build','lock-race',tour.pending_race ? 'secondary' : '',tour.pending_race ? 'disabled' : '')}${tour.status !== 'completed' ? button('End tour','end-tour','secondary small') : ''}</div></section>
  <details class="tour-assistant"><summary>Look for next</summary>${assistantHTML()}</details>
  <div class="tour-layout"><aside class="panel build-panel"><div class="section-head"><div><h2>Your current build</h2><p>${names.filter(i => i.kind === 'part').length} parts · ${names.filter(i => i.kind === 'ability').length} abilities</p></div></div>
  <ul class="equipment">${names.map(i => `<li><span class="tour-equipment-icon" aria-hidden="true">${referenceIcon(i)}</span><div><span class="name">${esc(i.name)}</span><span class="type">${esc(i.kind.replaceAll('_',' '))}${i.tier ? ` · Tier ${esc(i.tier)}` : ''}</span></div><button class="icon-button" data-action="remove-item" data-id="${esc(i.id)}" aria-label="Remove ${esc(i.name)}"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15"/></svg></button></li>`).join('') || '<li class="empty-line">Add the equipment currently fitted in your game.</li>'}</ul>
  <form id="add-equipment" class="add-line"><label class="screen-reader" for="equipment-select">Equipment to add</label><select id="equipment-select" name="item" required>${optionsHTML(equipItems().filter(i => i.kind !== 'stat' && !installed().includes(i.id)))}</select><button class="button secondary small" type="submit">Add</button></form><button class="text-button" data-action="custom-equipment" style="margin-top:12px">Missing item? Enter it manually</button>
  ${customTarget === 'equipment' ? customHTML() : ''}
  <details class="details-block"><summary>Credits, stage & equipment limits</summary><form id="edit-context" class="form-grid"><label>Credits<input name="credits" type="number" min="0" step="1" value="${esc(b.credits ?? '')}" required></label><label>Stage<input name="stage" type="number" min="1" max="30" value="${esc(tour.stage || 1)}" required></label><label>Stages remaining<input name="remaining" type="number" min="0" max="30" value="${esc(b.remaining_stages ?? '')}" placeholder="Unknown"></label><label>Intention · notes<select name="focus">${['synergy','ramjet','tech','afterburner','consistency'].map(f => `<option value="${f}"${selected(f,b.focus)}>${esc(f === 'synergy' ? 'Open synergies' : f)}</option>`).join('')}</select></label><div class="caps full">${['parts','abilities','crash_abilities'].map(k => `<label>${k === 'crash_abilities' ? 'Crash' : k}<input name="${k}" type="number" min="0" max="20" value="${esc(b.caps?.[k] ?? '')}" placeholder="Unknown"></label>`).join('')}</div><label class="check full"><input type="checkbox" name="observed" ${b.constraints_observed ? 'checked' : ''}><span>Limits checked in standard multiplayer.</span></label><div class="full"><button class="button secondary small" type="submit">Save context</button></div></form></details>
  <details class="details-block"><summary>Stat levels</summary><form id="edit-stats"><div class="stat-grid">${fields.map((f,i) => `<label>${f}<input name="stat${i}" type="number" min="0" max="20" value="${esc(b.stats?.[f] ?? '')}" placeholder="Unknown"></label>`).join('')}</div><p class="note" style="margin-top:12px">Record observed levels. Physical gains and nonlinear steps are not assumed.</p><div class="buttons"><button class="button secondary small" type="submit">Save stat levels</button></div></form></details>
  <details class="details-block"><summary>Conditions for this decision</summary><form id="edit-observations" class="form-grid">${[['status.cooled','Cooled'],['status.frozen','Frozen'],['status.overcharged','Overcharged'],['status.shielded','Shielded'],['action.afterburner_active','Using Afterburner']].map(([key,label]) => `<label>${label}<select name="${key}"><option value="">Unknown</option><option value="true"${selected(b.observations?.[key],true)}>Observed active</option><option value="false"${selected(b.observations?.[key],false)}>Observed inactive</option></select></label>`).join('')}<label>Current Energy<input name="resource.energy" type="number" min="0" value="${esc(b.observations?.['resource.energy'] ?? '')}" placeholder="Unknown"></label><p class="note full">Transient conditions are cleared after recording a race. Installed abilities alone do not guarantee an active status.</p><div class="full"><button class="button secondary small" type="submit">Save observations</button></div></form></details>
  </aside><div class="choice-workspace"><section class="offer-section"><h2>What are your options?</h2><p>Add the offers shown in your game, including the actual price and any replacement.</p><form id="add-offer" class="offer-editor"><label>Part or ability<select name="item" required>${optionsHTML(equipItems().filter(i => ['part','ability','crash_ability','stat'].includes(i.kind)))}</select></label><label>Credit cost<input name="price" type="number" min="0" step="1" placeholder="Unknown"></label><label class="wide">Replaces <span class="small">only if the game offers this</span><select name="replaces">${optionsHTML(names.filter(i => ['part','ability','crash_ability'].includes(i.kind)),'Nothing · uses an open slot')}</select></label><label class="check wide"><input name="free" type="checkbox"><span>This is a free reward.</span></label><div class="buttons"><button class="button secondary" type="submit">Add option</button><button class="text-button" type="button" data-action="custom-offer">Enter a missing item or stat reward</button></div></form>${customTarget === 'offer' ? customHTML() : ''}
  ${offers.length ? `<div class="comparison-head"><div><h3>${offers.length} option${offers.length === 1 ? '' : 's'} to compare</h3><p class="note">Fit grades describe supported connections, not measured speed.</p></div>${button('Compare choices','compare')}</div>${offerRows()}` : '<div class="empty-options"><h3>Your next decision starts here</h3><p>Add two or more choices to compare their requirements and how they connect to your build.</p></div>'}</section>
  ${tour.pending_race ? `<div class="race-entry" style="margin-top:26px"><strong>Race-entry build saved · Stage ${esc(tour.pending_race.stage)}</strong><p>${tour.pending_race.entry_build.installed.map(id => esc(item(id).name)).join(' · ') || 'No equipment recorded'}. Later edits do not change this snapshot.</p></div>` : ''}
  <details class="details-block result-form" ${tour.pending_race ? 'open' : ''}><summary>Record a race result</summary><form id="record-race" class="form-grid"><label class="full">Track<input name="track" value="${esc(tour.track || '')}" placeholder="Track raced" required></label><label>Finish position<input name="position" type="number" min="1" max="30" required></label><label>Starting field<input name="field" type="number" min="1" max="30" required></label><label>Time · seconds<input name="time" type="number" min="0" step="0.001" placeholder="Optional"></label><label>Conditions<input name="conditions" placeholder="Weather, mines…"></label><label>Crashes<input name="crashes" type="number" min="0" step="1" placeholder="Unknown"></label><label>Overheats<input name="overheats" type="number" min="0" step="1" placeholder="Unknown"></label><label class="full">What did you notice?<textarea name="notes" placeholder="Pace, handling, a combination that worked…"></textarea></label>${!tour.pending_race ? '<p class="note warning full">No pre-race snapshot is locked. This result will mark the current build as recorded after racing.</p>' : ''}<div class="full"><button class="button secondary" type="submit">Save result & advance stage</button></div></form></details>
  ${timelineHTML(tour)}
  </div></div>`;
}
function customHTML() { return `<form id="custom-item" class="panel stack" style="margin-top:16px"><h3>Record an item outside the reference set</h3><label>Name<input name="name" required maxlength="160"></label><label>Type<select name="kind"><option value="part">Part</option><option value="ability">Ability</option><option value="crash_ability">Crash ability</option>${customTarget === 'offer' ? '<option value="stat">Stat reward</option>' : '<option value="trait">Starting trait</option>'}</select></label><label>Exact description<textarea name="description" required placeholder="Copy what the game says"></textarea></label><p class="note">It can be recorded, but its effects stay unknown until extracted and reviewed. It will not receive an invented grade.</p><div class="buttons"><button class="button secondary small" type="submit">Save item</button>${button('Cancel','cancel-custom','quiet small')}</div></form>`; }
function liveChainHTML(advice) {
  const checks = advice.prerequisite_checks || [];
  if (!checks.length) return '';
  return checks.slice(0,2).map(check => {
    const names = (check.possible_sources || []).slice(0,2).map(id => item(id).name);
    const condition = check.state.replace(/^(status|resource|action)\./,'').replaceAll('_',' ');
    const state = check.observed === 'satisfied' ? 'Observed now' : check.observed === 'unsatisfied' ? 'Not satisfied now' : 'Not observed';
    return `<div class="live-chain" role="group" aria-label="Source, prerequisite and payoff"><div class="chain-step"><strong>${esc(names.join(' / ') || (check.observed === 'satisfied' ? 'Your observation' : 'Source not recorded'))}</strong><small>${names.length ? 'Possible source · timing conditional' : 'No source assumed'}</small></div><span class="chain-arrow" aria-label="may enable">→</span><div class="chain-step ${check.observed === 'satisfied' ? 'observed' : ''}"><strong>${esc(condition)}</strong><small>${state}</small></div><span class="chain-arrow" aria-label="enables conditionally">→</span><div class="chain-step"><strong>${esc(advice.name)}</strong><small>Conditional payoff</small></div></div>`;
  }).join('');
}
function offerRows() {
  const order = analysis?.ranking || offers.map(o => o.item_id);
  return order.map(id => {
    const o = offers.find(o => o.item_id === id); if (!o) return '';
    const i = item(id); const a = analysis?.options.find(a => a.item_id === id); const fit = a?.fit || 'Not compared';
    return `<article class="offer-row ${fit === 'strong' ? 'top-choice' : ''}"><div class="offer-title"><div><h3>${esc(i.name)}</h3><span class="kind">${esc(i.kind.replaceAll('_',' '))}${o.replaces ? ` · replaces ${esc(item(o.replaces).name)}` : ''}</span></div><span class="price">${o.price === null ? 'Cost unknown' : o.price === 0 ? 'Free reward' : `${esc(o.price)} cr`}</span></div><p class="offer-reason">${esc(a?.reasons?.[0] || 'Ready to compare against your current build.')}</p>${a ? liveChainHTML(a) : ''}${a ? `<details class="offer-details"><summary>Reasoning, next pieces & sources</summary><ul>${[...(a.reasons || []).slice(1),...(a.unknowns || []).map(u => `Unknown: ${u}`),...(a.replacement_losses || []).map(x => typeof x === 'string' ? x : JSON.stringify(x))].map(x => `<li>${esc(x)}</li>`).join('')}</ul>${a.builds_into?.length ? `<h4>Could build toward</h4>${a.builds_into.map(c => `<p class="note">${esc(typeof c === 'string' ? c : c.name || c.id || JSON.stringify(c))}</p>${typeof c === 'object' && c.missing?.length ? `<p class="note">Next pieces to look for: ${c.missing.map(id => esc(item(id).name)).join(' · ')}. Future offers are unknown.</p>` : '<p class="note">Components recorded; timing, legality and runtime behavior still matter.</p>'}`).join('')}` : ''}<div class="sources">${(a.sources || []).map(sourceHTML).join('')}</div></details>` : ''}<div class="offer-actions"><span class="fit ${esc(fit)}">${esc(fit === 'strong' ? 'Strong fit' : fit === 'conditional' ? 'Conditional fit' : fit === 'weak' ? 'Weak connection' : fit === 'unknown' ? 'Not enough data to compare' : fit)}</span><div class="buttons">${button('Remove','remove-offer','quiet small',`data-id="${esc(id)}"`)}${button('Choose this','choose-offer','secondary small',`data-id="${esc(id)}" ${a?.fit === 'blocked' ? 'disabled' : ''}`)}</div></div></article>`;
  }).join('') + (analysis ? `<div class="uncertainty">${esc(analysis.label)} · Source-supported connections can still depend on unknown timing, costs, and stacking. Grades are provisional.${analysis.options.some(o => o.fit === 'unknown') ? ' Unknown options are unranked and grouped last.' : ''}</div>` : '');
}
function safeURL(value) { try { const u = new URL(value); return ['http:','https:'].includes(u.protocol) ? esc(u.href) : '#'; } catch { return '#'; } }
function timelineHTML(t) {
  const events = [...(t.events || []).map(e => ({...e,event_type:'decision'})),...(t.races || []).map(e => ({...e,event_type:'race'}))].sort((a,b) => new Date(b.at)-new Date(a.at));
  return `<section style="margin-top:32px"><h2>Tour progression</h2><div class="timeline">${events.length ? events.map(e => e.event_type === 'race' ? `<article class="timeline-item"><h3>${esc(e.track)} · ${esc(e.position)} / ${esc(e.field_size)}</h3><p>Stage ${esc(e.stage)}${e.time_seconds != null ? ` · ${esc(e.time_seconds)}s` : ''}${e.notes ? ` · ${esc(e.notes)}` : ''}</p><details class="offer-details"><summary>Build at race entry</summary><p class="note">${(e.entry_build?.installed || []).map(id => esc(item(id).name)).join(' · ') || 'No equipment recorded'}</p><p class="note">${esc(e.snapshot_timing)}${e.crashes != null ? ` · ${esc(e.crashes)} crashes` : ''}${e.overheats != null ? ` · ${esc(e.overheats)} overheats` : ''}</p></details><small>${date(e.at)}</small></article>` : `<article class="timeline-item"><h3>${esc(e.choice_name || e.type || 'Build updated')}</h3><p>Stage ${esc(e.stage || '—')}${e.note ? ` · ${esc(e.note)}` : ''}</p>${e.options ? `<details class="offer-details"><summary>Decision record</summary><p class="note">Offered: ${e.options.map(o => esc(item(o.item_id).name)).join(' · ')}</p><p class="note">Advisor: ${esc(e.advice?.label || 'Choice recorded without comparison')}</p></details>` : ''}<small>${date(e.at)}</small></article>`).join('') : '<p class="empty-line">Your first saved choice or race result will start this timeline.</p>'}</div></section>`;
}
function referenceEntries(){
  const entries=new Map(data.items.map(i=>[i.id,i]));
  for(const [id,i] of Object.entries(guideData()?.equipment||{}))entries.set(id,{...entries.get(id),...i,id,source_excerpt:i.effect});
  return [...entries.values()];
}
function referenceIcon(i){
  if(i.kind==='part')return partGlyph({...i,catalog_id:i.id},32).html;
  if(i.kind==='ability')return abilityGlyph(i.id,35);
  return i.id==='status.overcharged'?gameGlyph('overcharged',30,'game-extracted-glyph'):'';
}
function libraryHTML() {
  const entries=referenceEntries().filter(i=>(filter==='all'||i.kind===filter)&&`${i.name} ${i.source_excerpt||''}`.toLowerCase().includes(search.toLowerCase()));
  const pageSize=12,pages=Math.max(1,Math.ceil(entries.length/pageSize));libraryPage=Math.min(libraryPage,pages-1);
  const visible=entries.slice(libraryPage*pageSize,(libraryPage+1)*pageSize);
  return `<div class="library-toolbar"><label class="screen-reader" for="library-search">Search reference entries</label><input id="library-search" type="search" placeholder="Search parts, abilities, or an effect…" value="${esc(search)}"><label class="screen-reader" for="library-filter">Entry type</label><select id="library-filter">${[['all','All entries'],['part','Parts'],['ability','Abilities'],['crash_ability','Crash abilities'],['trait','Traits'],['status','Statuses']].map(([v,n])=>`<option value="${v}"${selected(v,filter)}>${n}</option>`).join('')}</select><span class="note">${entries.length} entries</span></div><ul class="library-list">${visible.map(i=>`<li class="library-item"><div class="reference-icon" aria-hidden="true">${referenceIcon(i)}</div><div class="item-head"><h3>${esc(i.name)}</h3><span class="kind">${esc(i.kind.replaceAll('_',' '))}${i.tier?` · ${esc(i.tier)}`:''}</span></div><p>${gameText(i.source_excerpt||'Description not yet reviewed.')}</p><details><summary>Source & availability</summary><p>${i.availability==='observed_in_user_tour'||i.availability?.standard_multiplayer==='observed_in_user_tour'?'Observed in a prior Xbox tour. Confirm the current offer and tier.':'Published description. Confirm availability, tier and legal slots in your tour.'}</p>${i.url?`<a href="${safeURL(i.url)}" target="_blank" rel="noreferrer">Read source</a>`:data.sources.find(s=>s.id===i.source_id)?sourceHTML(data.sources.find(s=>s.id===i.source_id)):i.source_name?`<p>Local Xbox capture: ${esc(i.source_name)}</p>`:'<p>Source retained in the focused research catalog.</p>'}</details></li>`).join('')||'<li class="empty-line">No matching items. Try another name or effect.</li>'}</ul><nav class="catalog-paging" aria-label="Reference pages"><button class="button" data-action="library-page" data-delta="-1" ${libraryPage===0?'disabled':''}>Previous</button><span>Page ${libraryPage+1} of ${pages}</span><button class="button" data-action="library-page" data-delta="1" ${libraryPage+1>=pages?'disabled':''}>Next</button></nav><p class="catalog-caption">Icons identify equipment categories and stats.</p>`;
}
function historyHTML() {
  const races = tours.flatMap(t => t.races || []);
  return `${races.length ? `<div class="research-intro"><h2>${races.length} recorded race${races.length === 1 ? '' : 's'} across ${tours.length} tour${tours.length === 1 ? '' : 's'}</h2><p>These are observations, not controlled build comparisons. Track, opponents, and driving all affect the result.</p></div>` : ''}<div class="history-list">${tours.length ? tours.map(t => `<article class="history-row"><div><h2>${esc(t.name || 'Untitled tour')}</h2><p>${esc(t.racer || 'Racer unknown')} · ${(t.races || []).length} race results · ${esc(t.status || 'active')}</p><small>Updated ${date(t.updated_at)} · Revision ${esc(t.revision)}</small></div><div class="buttons">${button('Open tour','open-tour','secondary',`data-id="${esc(t.id)}"`)}${button('Results','open-results','secondary',`data-id="${esc(t.id)}"`)}</div></article>`).join('') : `<div class="empty-history"><h2>Every run has a story.</h2><p>Start a tour, save the build before racing, and record the result. Your decisions and equipment changes will stay connected to the race they led into.</p>${button('Start a tour','new-tour')}</div>`}</div>`;
}
function researchHTML() {
  return `<div class="research-layout"><section class="research-intro"><h2>Recommendations, with their limits</h2><p>Build directions connect source-described effects with each racer’s multiplayer traits. The combinations and stat points are editorial recommendations.</p><p>The tour advisor grades supported synergy fit. It does not predict a finishing position or establish the fastest possible legal build.</p><p>Missing effects remain unknown. A good result can inform your notes without proving that a build caused the win.</p></section><section class="screen-panel"><h2>Confirm in game</h2><table class="data-table"><tbody><tr><td>Current offers</td><td>Availability, exact tier, and actual price.</td></tr><tr><td>Legal slots</td><td>Observed equipment limits and replacement choices.</td></tr><tr><td>Runtime behavior</td><td>Status timing, refresh rules, and stacking.</td></tr><tr><td>Current conditions</td><td>Active statuses and available Energy, rather than equipped items alone.</td></tr></tbody></table></section></div><section class="research-sources screen-panel"><h2>Source references</h2><details><summary>Browse ${data.sources.length} retained sources</summary><ul class="source-list">${data.sources.map(s=>`<li>${sourceHTML(s)}<p>${esc(s.trust||s.scope||s.kind||'Source claim; not directly tested on Xbox.')}</p></li>`).join('')}</ul></details><details><summary>Local data & backups</summary><p>Tour history and build plans are saved in this browser. Export a backup to move them to another device. Build plans have their own export in Build tools; tour backups preserve actual run revisions.</p><div class="buttons">${button('Export tour history','export','secondary')}<label class="button secondary file-label">Import tours<input type="file" class="import-secondary" accept="application/json,.json"></label></div></details></section>`;
}

function assistantHTML() {
  return `<section class="assistant-workspace" aria-label="Prepared advice"><section class="watchlist-section" aria-labelledby="watchlist-heading"><div class="section-head"><div><h2 id="watchlist-heading">Look for next</h2><p>Prepared for this build, before the next menu.</p></div></div><div id="watchlist-content">${watchlistHTML()}</div></section></section>`;
}
function watchlistHTML() {
  if (!isActiveTour()) return '<p class="empty-line">This tour is complete. Start a fresh tour for a new build and watchlist.</p>';
  if (watchlistError) return `<p class="note warning">${esc(watchlistError)}</p><p class="note">Manual comparisons remain available below.</p>`;
  if (!watchlist) return '<p class="empty-line">Preparing advice from your recorded build…</p>';
  const entries = watchlist.entries || [];
  return `${entries.length ? `<ol class="watchlist">${entries.map(entry => `<li><div class="watchlist-title"><h3>${esc(entry.name)}</h3><span class="fit ${esc(entry.fit)}">${esc(entry.fit === 'strong' ? 'Strong connection' : 'Conditional')}</span></div><p>${esc(entry.reason)}</p>${entry.prerequisites?.length ? `<p class="watchlist-condition"><strong>Take when:</strong> ${entry.prerequisites.map(esc).join(' ')}</p>` : ''}${entry.replacement_name ? `<p class="note">Consider replacing ${esc(entry.replacement_name)}; confirm that replacement is offered.</p>` : ''}<details class="offer-details"><summary>Tradeoffs & evidence</summary>${entry.tradeoffs?.length ? `<ul>${entry.tradeoffs.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : '<p class="note">Check the actual offer, price, and available slot before choosing.</p>'}<div class="sources">${(entry.sources || []).map(sourceHTML).join('')}</div></details></li>`).join('')}</ol>` : '<p class="empty-line">Record your starting equipment or accept a build capture to prepare specific targets. An empty build does not establish a strategy.</p>'}<p class="assistant-boundary">Future offers, prices, and availability are unknown. These are provisional connections, not instructions to buy every listed item.</p>${watchlist.unknown_items?.length ? `<p class="note warning">Unreviewed equipment: ${watchlist.unknown_items.map(i => esc(i.name)).join(' · ')}. Its effects are not ranked.</p>` : ''}${watchlist.limitations?.length ? `<details class="offer-details"><summary>Advice limits</summary><ul>${watchlist.limitations.map(t => `<li>${esc(t)}</li>`).join('')}</ul></details>` : ''}`;
}
function sourceHTML(source) {
  const label = esc(source.title || source.source_name || source.id || 'Source description');
  return source.url ? `<a href="${safeURL(source.url)}" target="_blank" rel="noreferrer">${label}</a>` : `<span>${label} · local evidence</span>`;
}
function updateAssistantFragments(force = false) {
  if (view !== 'tour' || !tour) return;
  assistantDeferred = false;
  for (const [id,html] of [['watchlist-content',watchlistHTML()]]) {
    const target = document.getElementById(id); if (!target) continue;
    if (!force && target.contains(document.activeElement)) { assistantDeferred = true; continue; }
    if (target.innerHTML !== html) target.innerHTML = html;
  }
}
async function refreshAssistant() {
  if (!isActiveTour() || view !== 'tour' || assistantInFlight) return;
  const {id, revision} = tour;
  const generation = assistantGeneration;
  const key = JSON.stringify([id, revision, tour.build]);
  if (watchlistKey === key) return;
  assistantInFlight = true;
  watchlistError = '';
  const stillCurrent = () => tour?.id === id && tour.revision === revision && assistantGeneration === generation;
  try {
    const result = await api('/api/watchlist', 'POST', {tour_id:id, revision});
    if (stillCurrent()) watchlist = result;
  } catch (error) {
    if (stillCurrent()) watchlistError = `Watchlist unavailable: ${error.message}`;
  } finally {
    assistantInFlight = false;
    if (stillCurrent()) watchlistKey = key;
    else queueMicrotask(refreshAssistant);
    updateAssistantFragments();
  }
}

document.addEventListener('click', async event => {
  const navButton = event.target.closest('button[data-view]'); if (navButton) return nav(navButton.dataset.view);
  const b = event.target.closest('[data-action]'); if (!b || b.disabled) return;
  if (busy) return toast('Finishing the current save…'); clearError(); busy = true;
  try {
    const action = b.dataset.action;
    if(action.startsWith('builder-')){try{await builderAction(b);}finally{b.disabled=false;}return;}
    if(action==='guide-use'){seedBuilder(b.dataset.racer,b.dataset.build);nav('builder');return;}
    if(action==='library-page'){libraryPage=Math.max(0,libraryPage+Number(b.dataset.delta));render();return;}
    if (action === 'guide-compact') { toggleCompact(); render(); $('[data-action="guide-compact"]').focus(); }
    if (action === 'retry-guides') { b.disabled = true; b.textContent = 'Loading guides…'; await loadGuides(); render(); }
    if (action === 'new-tour') { resetAssistant(); tour = null; offers = []; analysis = null; localStorage.setItem('paddock.active','new'); customTarget = null; nav('tour'); }
    if (action === 'suggest-kit') { const kit = data.starting_kits.find(k => k.id === b.dataset.kit); $('#new-racer').value = kit.racer_name || ''; $('#new-kit').value = kit.id; }
    if (action === 'remove-item') { tour.build.installed = installed().filter(id => id !== b.dataset.id); analysis = null; await save('Build updated.'); }
    if (action === 'custom-equipment' || action === 'custom-offer') { customTarget = action === 'custom-offer' ? 'offer' : 'equipment'; render(); }
    if (action === 'cancel-custom') { customTarget = null; render(); }
    if (action === 'remove-offer') { offers = offers.filter(o => o.item_id !== b.dataset.id); analysis = null; await save(); }
    if (action === 'compare') { b.disabled = true; b.textContent = 'Comparing…'; analysis = await api('/api/analyze','POST',{state:tour.build,options:offers}); await save(); }
    if (action === 'choose-offer') {
      const option = offers.find(o => o.item_id === b.dataset.id); const i = item(option.item_id);
      if (option.price == null) throw new Error('Record the actual price or mark a free reward before choosing. Remove and re-add this option with its price.');
      const remainingCredits = creditsAfterChoice(tour.build.credits, option.price);
      if (!analysis) analysis = await api('/api/analyze','POST',{state:tour.build,options:offers});
      const grade = analysis.options.find(a => a.item_id === option.item_id);
      if (grade?.eligibility === 'blocked') throw new Error(grade.reasons.join(' '));
      const before = clone(tour.build);
      if (i.kind !== 'stat') tour.build.installed = installed().filter(id => id !== option.replaces).concat(option.item_id);
      tour.build.credits = remainingCredits;
      tour.events.push({id:crypto.randomUUID(),at:new Date().toISOString(),stage:tour.stage,type:'choice',choice_name:i.name,choice:clone(option),options:clone(offers),advice:clone(analysis),build_before:before,build_after:clone(tour.build)});
      offers = []; analysis = null;
      await save(i.kind === 'stat' ? 'Reward recorded. Update your observed stat level in the build editor.' : `${i.name} recorded in your build.`);
    }
    if (action === 'lock-race') { tour.pending_race = {stage:tour.stage,entry_build:clone(tour.build),at:new Date().toISOString()}; await save('Race-entry build saved.'); }
    if (action === 'end-tour') { tour.status = 'completed'; await save('Tour marked complete. History is preserved.'); }
    if (action === 'open-results') {
      if (b.dataset.id) standingsTourId = b.dataset.id;
      if (view !== 'builder') { view = 'builder'; render(); }
      history.replaceState(null, '', '#results');
      focusResults();
    }
    if (action === 'open-tour') { currentTour(await api(`/api/tours/${b.dataset.id}`)); view = 'tour'; render(); }
    if (action === 'export') await exportBackup();
  } catch(error) { showError(error); render(); } finally { busy = false; }
});
document.addEventListener('submit', async event => {
  const form = event.target; event.preventDefault(); if (busy) return; busy = true; clearError(); const f = new FormData(form);
  try {
    if (form.id === 'builder-custom') { builderSubmit(form); return; }
    if (form.id === 'tour-results') {
      const standings = readResults(form);
      if (!standings) return;
      const selected = tours.find(t => t.id === f.get('tour_id'));
      const saved = await api(`/api/tours/${selected.id}`, 'PUT', {...selected, standings});
      tours = tours.map(t => t.id === saved.id ? saved : t);
      if (tour?.id === saved.id) currentTour(saved);
      standingsTourId = saved.id;
      if (view === 'builder' && form.isConnected) {
        const scrollLeft = form.querySelector('.results-scroll').scrollLeft;
        renderResults();
        $('.results-scroll').scrollLeft = scrollLeft;
        $('#tour-results button[type="submit"]').focus({preventScroll:true});
      }
      toast('Results saved in this browser.');
    }
    if (form.id === 'start-tour' || form.id === 'results-start-tour') {
      const name = f.get('name').trim();
      if (!name) throw new Error('Enter a tour name.');
      const kit = data.starting_kits.find(k => k.id === f.get('kit'));
      const build = {credits:number(f.get('credits')),installed:kit ? [...kit.abilities,...kit.traits] : [],caps:Object.fromEntries(['parts','abilities','crash_abilities'].map(k => [k,number(f.get(k))])),constraints_observed:f.has('observed'),observations:{},stats:{},custom_items:[],remaining_stages:number(f.get('remaining')),focus:f.get('focus') || 'synergy'};
      currentTour(await api('/api/tours','POST',{name,racer:(f.get('racer') || '').trim(),vehicle:f.get('vehicle') || '',game_version:(f.get('version') || '').trim() || null,status:'active',stage:number(f.get('stage')) ?? 1,build,events:[],races:[],starting_kit_source:kit?.source_id || null}));
      tours.unshift(tour);
      standingsTourId = tour.id;
      if (form.id === 'results-start-tour' && view === 'builder') {
        renderResults();
        focusResults();
      } else {
        render();
      }
      toast('Fresh tour started.');
    }
    if (form.id === 'add-equipment') { const id = f.get('item'); if (!installed().includes(id)) tour.build.installed.push(id); analysis = null; await save('Equipment added.'); }
    if (form.id === 'add-offer') { const id = f.get('item'); if (offers.some(o => o.item_id === id)) throw new Error('This item is already an option. Remove it first to change the price or replacement.'); const replaces = f.get('replaces') || null; offers.push({item_id:id,price:f.has('free') ? 0 : number(f.get('price')),replaces,replacement_confirmed:Boolean(replaces),offered_in_game:true}); analysis = null; await save(); }
    if (form.id === 'custom-item') {
      const i = {id:`custom.${crypto.randomUUID()}`,name:f.get('name').trim(),kind:f.get('kind'),description:f.get('description').trim()};
      tour.build.custom_items ||= []; tour.build.custom_items.push(i);
      if (customTarget === 'equipment') tour.build.installed.push(i.id);
      customTarget = null; await save('Manual item saved. Its mechanics remain unreviewed.');
    }
    if (form.id === 'edit-context') { tour.build.credits = number(f.get('credits')); tour.stage = number(f.get('stage')); tour.build.remaining_stages = number(f.get('remaining')); tour.build.focus = f.get('focus'); tour.build.caps = Object.fromEntries(['parts','abilities','crash_abilities'].map(k => [k,number(f.get(k))])); tour.build.constraints_observed = f.has('observed'); analysis = null; await save('Tour context saved.'); }
    if (form.id === 'edit-stats') { tour.build.stats = Object.fromEntries(fields.map((key,i) => [key,number(f.get(`stat${i}`))])); await save('Observed stat levels saved.'); }
    if (form.id === 'edit-observations') { tour.build.observations = {}; for (const [key,value] of f.entries()) if (value !== '') tour.build.observations[key] = key.startsWith('resource.') ? number(value) : value === 'true'; analysis = null; await save('Decision observations saved.'); }
    if (form.id === 'record-race') {
      if (number(f.get('position')) > number(f.get('field'))) throw new Error('Finish position cannot exceed the starting field.');
      const pending = tour.pending_race;
      const race = {id:crypto.randomUUID(),at:new Date().toISOString(),stage:pending?.stage || tour.stage,track:f.get('track').trim(),conditions:f.get('conditions').trim(),position:number(f.get('position')),field_size:number(f.get('field')),time_seconds:number(f.get('time')),crashes:number(f.get('crashes')),overheats:number(f.get('overheats')),notes:f.get('notes').trim(),entry_build:pending ? clone(pending.entry_build) : clone(tour.build),snapshot_timing:pending ? 'saved before racing' : 'recorded after racing'};
      tour.races.push(race); tour.track = race.track; delete tour.pending_race; tour.stage += 1;
      if (tour.build.remaining_stages != null) tour.build.remaining_stages = Math.max(0,tour.build.remaining_stages-1);
      tour.build.observations = {}; delete tour.build.observed_events; offers = []; analysis = null;
      await save('Result saved. Transient conditions reset to unknown for the next decision.');
    }
  } catch(error) {
    showError(error, form.closest('#results') ? $('#results-error') : $('#error'));
  } finally { busy = false; }
});
document.addEventListener('input', event => {
  builderInput(event.target);
  resultInput(event.target);
  if (event.target.id === 'guide-search') { const position = event.target.selectionStart; setGuideQuery(event.target.value); render(); const input = $('#guide-search'); input.focus(); if (position !== null) input.setSelectionRange(position,position); }
  if (event.target.id === 'library-search') { const input = event.target; const position = input.selectionStart; search = input.value; libraryPage=0; render(); const next = $('#library-search'); next.focus(); next.setSelectionRange(position,position); }
});
document.addEventListener('change', event => {
  const target = event.target;
  if (target.id === 'results-tour') {
    standingsTourId = target.value;
    clearError();
    renderResults();
    $('#results-tour').focus();
    return;
  }
  if (target.form?.id === 'tour-results') {
    if (target.name === 'your_row' || target.name === 'joined_at') updateResults(target.form);
    return;
  }
  builderChange(target).catch(showError);
  if (target.id === 'guide-character') location.hash = `#guides/${target.value}`;
  if (target.id === 'library-filter') { filter = target.value; libraryPage = 0; render(); }
  if (target.id === 'import' || target.classList.contains('import-secondary')) importBackup(target);
});
async function exportBackup() {
  const backup = await api('/api/export'); const blob = new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `paddock-backup-${new Date().toISOString().slice(0,10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000); toast('Backup exported with saved revisions.');
}
async function importBackup(input) {
  const file = input.files?.[0]; if (!file) return; clearError();
  try { if (file.size > 20*1024*1024) throw new Error('This backup exceeds the 20 MB import limit.'); const result = await api('/api/import','POST',JSON.parse(await file.text())); tours = (await api('/api/tours')).tours; toast(`${result.imported} tours imported. Existing history was not overwritten.`); view = 'history'; render(); } catch(error) { showError(error); } finally { input.value = ''; }
}
$('#export').addEventListener('click', () => exportBackup().catch(showError));
document.addEventListener('focusout', () => { if (assistantDeferred) setTimeout(() => updateAssistantFragments(),0); });
function routeHash() {
  if(location.hash.startsWith('#builder')){setBuilderRoute(location.hash);view='builder';}
  else if (location.hash.startsWith('#guides')) { selectGuideRoute(location.hash); view = 'guides'; }
  else if (location.hash === '#results') view = 'builder';
  else if (['#tour','#library','#history','#research'].includes(location.hash)) view = location.hash.slice(1);
}
function renderRoute() {
  routeHash();
  clearError();
  render();
  if (location.hash === '#results') focusResults();
  else window.scrollTo({top:0});
}
window.addEventListener('hashchange', () => { if (!['#workspace','#guide-stat-title'].includes(location.hash)) renderRoute(); });
try {
  [data,{tours}] = await Promise.all([api('/api/catalog'),api('/api/tours'),loadGuides()]);
  await initBuilder({catalog:data,guides:guideData(),api,render,notify:toast});
  const savedActive = localStorage.getItem('paddock.active');
  const active = savedActive === 'new' ? null : tours.find(t => t.id === savedActive) || tours.find(t => t.status === 'active');
  if (active) currentTour(active);
  renderRoute();
} catch(error) { $('#content').innerHTML = '<div class="empty-history"><h2>Paddock could not load.</h2><p>Reload this page to try again.</p></div>'; showError(error); }
