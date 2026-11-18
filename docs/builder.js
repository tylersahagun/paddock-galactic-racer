import {gameGlyph, gameScript, abilityGlyph, partGlyph, gameText} from './game-assets.js';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const copy=v=>JSON.parse(JSON.stringify(v));
const statNames=['Cornering','Afterburner','Resilience','Ramjet','Battery','Advanced handling'];
const vehicles=['','Speeder Bike','Landspeeder','Skim Speeder'];
const focusPatterns={aggression:/Aggression/i,ramjet:/Ramjet|Redlining/i,afterburner:/Afterburner|Fuel/i,abilities:/Ability|Abilities|Energy|reload/i,consistency:/Shield|Clean|Recovery|Consistency|preservation/i};
const matchesFocus=(b,focus)=>!focusPatterns[focus]||focusPatterns[focus].test([b.name,b.summary,...b.tags].join(' '));
const focuses=[['open','All directions'],['aggression','Aggressive / takedowns'],['ramjet','Ramjet'],['afterburner','Afterburner'],['abilities','Abilities / Energy'],['consistency','Control / consistency']];
let context, guides, catalog={}, saved=[], plan=null, failure='', dirty=false;
const store=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));}catch{}};
const read=key=>{try{return JSON.parse(localStorage.getItem(key)||'null');}catch{return null;}};
const racer=()=>guides.characters.find(r=>r.id===plan.racer_id)||guides.characters[0];
const equipment=()=>({...catalog,...Object.fromEntries((plan.custom_items||[]).map(i=>[i.id,{...i,effect:i.description,custom:true}]))});
const total=()=>Object.values(plan.stats).reduce((sum,n)=>sum+n,0);
// Keep the game's ten-pip row, with one pip per point and explicit overflow.
function statPips(points){
  return Array.from({length:10},(_,n)=>`<i class="${n<points?'filled':''}"></i>`).join('')+(points>10?`<small class="builder-stat-overflow">+${points-10} more</small>`:'');
}
const heading=(label,script)=>`<div class="game-panel-heading">${gameScript(script,118)}<h3>${esc(label)}</h3></div>`;
const selected=(a,b)=>a===b?' selected':'';
function blank(racerId='biddy-blas'){
  const r=guides.characters.find(r=>r.id===racerId)||guides.characters[0];
  return {name:'Untitled build',racer_id:r.id,vehicle:'',focus:'open',parts:[],abilities:[...r.starting_abilities],crash_abilities:[],stats:Object.fromEntries(statNames.map(s=>[s,0])),stat_basis:'planned_additions',notes:'',custom_items:[]};
}
function remember(){dirty=true;store('paddock.builder.draft',plan);}
function recoverable(){if(dirty)store('paddock.builder.recovery',plan);}
function statusHTML(){return dirty?'Unsaved draft':plan.id?`Saved · revision ${plan.revision}`:'New draft';}
function refresh(){context.render();}
function itemIcon(item,id,size=32){
  if(item.kind==='part')return partGlyph({...item,catalog_id:id},size).html;
  return abilityGlyph(id,size)||gameGlyph('Battery',size,'game-extracted-glyph');
}
function options(group){
  const kind={parts:'part',abilities:'ability',crash_abilities:'crash_ability'}[group];
  return Object.entries(equipment()).filter(([id,i])=>i.kind===kind&&!plan[group].includes(id)).sort((a,b)=>a[1].name.localeCompare(b[1].name)).map(([id,i])=>`<option value="${esc(id)}">${esc(i.name)}${i.custom?' · custom':''}</option>`).join('');
}
function rows(group){
  const items=equipment();
  return `<ul class="builder-items">${plan[group].map(id=>{
    const i=items[id]||{name:id,kind:'unknown',effect:'Description unavailable.'};
    return `<li><span class="builder-item-symbol ${i.kind==='part'?'part-symbol':'ability-symbol'}" aria-hidden="true">${itemIcon(i,id)}</span><div><h4>${esc(i.name)}</h4><p>${gameText(i.effect||i.source_excerpt||'Unreviewed custom description.')}</p>${i.custom?'<small>Custom · unranked</small>':''}</div><button type="button" class="builder-remove" data-action="builder-remove" data-group="${group}" data-id="${esc(id)}" aria-label="Remove ${esc(i.name)}"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15"/></svg></button></li>`;
  }).join('')||`<li class="builder-empty">${group==='parts'?'Choose a part to begin your build.':'Add a target from the list below.'}</li>`}</ul>`;
}
function addRow(group,label){return `<div class="builder-add"><label class="screen-reader" for="builder-add-${group}">${label}</label><select id="builder-add-${group}"><option value="">${label}</option>${options(group)}</select><button type="button" class="button secondary" data-action="builder-add" data-group="${group}">Add</button></div>`;}
function directions(){
  const filtered=racer().builds.filter(b=>matchesFocus(b,plan.focus));
  return {builds:filtered.length?filtered:racer().builds,matched:filtered.length>0};
}
function checks(){
  const ids=new Set([...plan.parts,...plan.abilities]);const notes=[];
  if(plan.racer_id==='biddy-blas'&&ids.has('ability.status_scrubber'))notes.push('Biddy: clearing your own Burning can interrupt Heat Recycler. Check what the cleanse removes.');
  if(plan.racer_id==='goli-o2-r0')notes.push('Goli: physical impacts can end Surging. Robust Surge protects from System Malfunction, not from impact-driven Surging loss.');
  if(ids.has('part.supercooled_attachments'))notes.push('Supercooled Attachments needs actual Cooled and available Energy. Faster reloads do not refill Energy.');
  if(ids.has('part.scrap_reloader')||ids.has('part.scrap_recycler_iii'))notes.push('Scrap rewards require credited takedowns. A hit, status effect or collision alone is not enough.');
  if(ids.has('part.kinetic_refueler_ii'))notes.push('Kinetic Refueler needs a vehicle collision; a ranged weapon hit alone is not its trigger.');
  return notes;
}
export async function initBuilder(settings){
  context=settings;guides=settings.guides;
  if(!guides){failure='Guide data is unavailable. Reload Paddock to retry.';return;}
  catalog=Object.fromEntries(settings.catalog.items.map(i=>[i.id,{...i,effect:i.source_excerpt}]));
  Object.assign(catalog,guides.equipment);
  const draft=read('paddock.builder.draft');
  plan=draft&&guides.characters.some(r=>r.id===draft.racer_id)&&['parts','abilities','crash_abilities','custom_items'].every(k=>Array.isArray(draft[k]))&&draft.stats&&typeof draft.stats==='object'?draft:blank();
  dirty=!!draft;
  try{saved=(await context.api('/api/builds')).builds;dirty=!!draft&&!saved.some(p=>p.id===draft.id&&JSON.stringify(p)===JSON.stringify(draft));failure='';}catch(e){failure=e.message;}
}
export const builderHash=()=>plan?.id?`#builder/${plan.id}`:'#builder';
export function setBuilderRoute(hash){
  const id=hash.split('/')[1];
  if(id&&id!==plan?.id){const found=saved.find(p=>p.id===id);if(found){recoverable();plan=copy(found);dirty=false;store('paddock.builder.draft',plan);}else failure='This saved build was not found. Your current draft is still available.';}
}
export function seedBuilder(racerId,buildId){
  const previousFocus=plan?.focus||'open';
  const r=guides.characters.find(r=>r.id===racerId),b=r?.builds.find(b=>b.id===buildId);
  if(!b)throw new Error('That guide is unavailable.');
  recoverable();plan={...blank(r.id),name:b.name,vehicle:plan?.vehicle||'',focus:b.focus==='aggression'?'aggression':matchesFocus(b,previousFocus)?previousFocus:'open',parts:b.parts.map(p=>p.item_id),abilities:[...new Set([...r.starting_abilities,...b.abilities.map(a=>a.item_id)])],stats:Object.fromEntries(statNames.map(s=>[s,b.stats.next_10_points[s]||0])),guide_ref:{racer_id:r.id,build_id:b.id}};remember();
}
export function builderHTML(){
  if(!plan||!guides)return '<section class="screen-panel"><h2>Build builder unavailable</h2><p>Reload Paddock to try again.</p></section>';
  const recommended=directions();
  const r=racer(), based=r.builds.find(b=>b.id===plan.guide_ref?.build_id), sum=total(), notes=checks();
  return `<div class="builder-workspace">
    ${failure?`<div class="builder-error" role="alert"><p>${esc(failure)}</p><button class="button secondary" data-action="builder-retry">Reload saved builds</button></div>`:''}
    <div class="builder-command"><label>Build name<input data-builder-field="name" id="builder-name" value="${esc(plan.name)}" maxlength="120" required></label><label>Saved builds<select id="builder-saved"><option value="">Open a saved build…</option>${saved.map(p=>`<option value="${esc(p.id)}"${selected(p.id,plan.id)}>${esc(p.name)}</option>`).join('')}</select></label><span class="builder-status" role="status">${statusHTML()}</span><div class="buttons"><button class="button secondary" data-action="builder-new">New build</button><button class="button" data-action="builder-save">${plan.id?'Save changes':'Save build'}</button></div></div>
    <div class="builder-board game-build-board">
      <section class="game-stats-panel builder-stats" aria-label="Planned stat points">${heading('Vehicle stats','stats')}<label class="builder-vehicle-label">Vehicle<select data-builder-field="vehicle">${vehicles.map(v=>`<option value="${v}"${selected(v,plan.vehicle)}>${v||'Choose a vehicle…'}</option>`).join('')}</select></label><p class="builder-budget"><strong id="builder-point-total">${sum}</strong> planned points</p><div class="builder-stat-list">${statNames.map(s=>`<label class="builder-stat">${gameGlyph(s,27,'game-extracted-glyph')}<span>${esc(s)}</span><input data-builder-stat="${s}" type="number" min="0" step="1" value="${plan.stats[s]||0}" aria-label="Planned ${s} points"><span class="builder-stat-track" data-stat-fill="${s}" aria-hidden="true">${statPips(plan.stats[s]||0)}</span></label>`).join('')}</div><p class="panel-caption">Planned additions, not current levels. Each pip is one planned point. Points above ten appear as +N more.</p></section>
      <div class="game-center-panels"><section class="game-style-panel" aria-label="Racer style">${heading('Racer style','style')}<label class="screen-reader" for="builder-racer">Racer</label><select id="builder-racer" class="builder-racer">${guides.characters.map(c=>`<option value="${c.id}"${selected(c.id,r.id)}>${esc(c.name)} · ${esc(c.style)}</option>`).join('')}</select><dl class="game-traits">${r.traits.map(t=>`<div><dt>${esc(t.name)}</dt><dd>${gameText(t.effect)}</dd></div>`).join('')}</dl>${r.kit_note?`<p class="guide-caution">${esc(r.kit_note)}</p>`:''}</section>
      <section class="game-abilities-panel" aria-label="Planned abilities">${heading('Abilities','abilities')}${rows('abilities')}${addRow('abilities','Choose an ability…')}<details class="builder-crash"><summary>Crash ability${plan.crash_abilities.length?` · ${plan.crash_abilities.length} selected`:''}</summary>${rows('crash_abilities')}${addRow('crash_abilities','Choose a crash ability…')}</details></section></div>
      <section class="game-parts-panel" aria-label="Planned parts">${heading('Parts','parts')}${rows('parts')}${addRow('parts','Choose a part…')}<button class="text-button builder-directions-link" data-action="builder-recommend">Browse build directions</button><p class="panel-caption">Your planned selections. Confirm available slots, exact tiers, and offers in game.</p></section>
    </div>
    <section class="builder-directions screen-panel"><div class="section-head"><div><h2>Build directions</h2><p>${recommended.matched?'Researched directions for your racer and playstyle.':'No dedicated match in the researched guides. Other directions for this racer are shown.'}</p></div><label>Playstyle<select id="builder-focus">${focuses.map(([id,label])=>`<option value="${id}"${selected(id,plan.focus||'open')}>${label}</option>`).join('')}</select></label>${based?`<span class="builder-origin">Based on ${esc(based.name)}</span>`:''}</div><div class="builder-direction-list ${recommended.builds.length===1?'single':''}">${recommended.builds.map(b=>`<article><div><h3>${esc(b.name)}</h3><p>${esc(b.summary)}</p></div><button class="button secondary" data-action="builder-seed" data-racer="${r.id}" data-build="${b.id}">Use direction</button><a href="#guides/${r.id}/${b.id}">Read guide</a></article>`).join('')}</div></section>
    <div class="builder-bottom"><section class="screen-panel"><h2>Build notes</h2><label class="screen-reader" for="builder-notes">Build notes</label><textarea id="builder-notes" data-builder-field="notes" maxlength="20000" placeholder="Track, execution, swaps to look for…">${esc(plan.notes)}</textarea>${notes.length?`<details class="builder-checks"><summary>Check these interactions · ${notes.length}</summary><ul>${notes.map(n=>`<li>${esc(n)}</li>`).join('')}</ul></details>`:''}</section><section class="builder-utilities screen-panel"><h2>Build tools</h2><div class="buttons"><button class="button secondary" data-action="builder-copy">Save as a copy</button><button class="button secondary" data-action="builder-export">Export builds</button><label class="button secondary file-label">Import builds<input id="builder-import" type="file" accept="application/json,.json"></label>${read('paddock.builder.recovery')?'<button class="text-button" data-action="builder-recover">Recover previous draft</button>':''}</div><details><summary>Add an unlisted item</summary><form id="builder-custom"><label>Name<input name="name" maxlength="120" required></label><label>Type<select name="kind"><option value="part">Part</option><option value="ability">Ability</option><option value="crash_ability">Crash ability</option></select></label><label>Description<textarea name="description" maxlength="4000" placeholder="Copy what you see in game"></textarea></label><p class="panel-caption">Custom items stay unranked.</p><button class="button secondary" type="submit">Add custom item</button></form></details></section></div>
    <details class="builder-method"><summary>Sources & planning limits</summary><p>This is a planned build, separate from actual tour equipment and results. Guide directions and point allocations are editorial synergy recommendations; performance, stacking and legal slots are not established. Saving creates a local revision. Tours and build plans have separate backup files.</p><p>Icons identify equipment categories and stats.</p></details>
  </div>`;
}
export function builderInput(target){
  if(!plan)return;
  if(target.dataset.builderField){plan[target.dataset.builderField]=target.value;remember();}
  if(target.dataset.builderStat){const n=Number(target.value);if(!Number.isInteger(n)||n<0||n>10000){target.setCustomValidity('Enter a nonnegative whole number, up to 10000.');return;}target.setCustomValidity('');plan.stats[target.dataset.builderStat]=n;remember();const sum=total();document.querySelector('#builder-point-total').textContent=sum;document.querySelectorAll('[data-stat-fill]').forEach(el=>{el.innerHTML=statPips(plan.stats[el.dataset.statFill]||0);});}
  const status=document.querySelector('.builder-status');if(status)status.textContent=statusHTML();
}
export async function builderChange(target){
  if(target.id==='builder-focus'){plan.focus=target.value;remember();refresh();}
  if(target.id==='builder-racer'){plan.racer_id=target.value;delete plan.guide_ref;remember();refresh();}
  if(target.id==='builder-saved'&&target.value){recoverable();const found=saved.find(p=>p.id===target.value);if(found){plan=copy(found);dirty=false;store('paddock.builder.draft',plan);history.replaceState(null,'',builderHash());refresh();}}
  if(target.id==='builder-import'){
    const file=target.files?.[0];if(!file)return;
    try{if(file.size>20*1024*1024)throw new Error('Build backup exceeds 20 MB.');const result=await context.api('/api/builds/import','POST',JSON.parse(await file.text()));saved=(await context.api('/api/builds')).builds;context.notify(`${result.imported} builds imported.`);refresh();}finally{target.value='';}
  }
}
export async function builderAction(button){
  const action=button.dataset.action;
  if(action==='builder-recommend'){document.querySelector('.builder-directions').scrollIntoView({behavior:'auto',block:'start'});document.querySelector('#builder-focus').focus({preventScroll:true});}
  if(action==='builder-add'){const group=button.dataset.group,id=document.querySelector('#builder-add-'+group).value;if(!id)throw new Error('Choose an item first.');if(!plan[group].includes(id))plan[group].push(id);remember();refresh();document.querySelector('#builder-add-'+group).focus();}
  if(action==='builder-remove'){plan[button.dataset.group]=plan[button.dataset.group].filter(id=>id!==button.dataset.id);remember();refresh();document.querySelector('#builder-add-'+button.dataset.group).focus();}
  if(action==='builder-seed'){seedBuilder(button.dataset.racer,button.dataset.build);history.replaceState(null,'','#builder');refresh();window.scrollTo({top:0});document.querySelector('#builder-name').focus({preventScroll:true});context.notify('Direction copied into an editable draft.');}
  if(action==='builder-new'){recoverable();plan=blank(plan.racer_id);remember();history.replaceState(null,'','#builder');refresh();document.querySelector('#builder-name').focus();}
  if(action==='builder-recover'){const previous=read('paddock.builder.recovery');if(previous){store('paddock.builder.recovery',plan);plan=previous;remember();refresh();}}
  if(action==='builder-save'||action==='builder-copy'){
    const form=document.querySelector('.builder-workspace');if([...form.querySelectorAll('#builder-name,[data-builder-stat]')].some(el=>!el.reportValidity()))return;
    button.disabled=true;
    const editingPlan=plan, fingerprint=JSON.stringify(plan);
    const value=copy(plan);if(action==='builder-copy'){delete value.id;delete value.revision;value.name=(value.name.slice(0,110)+' copy');}
    const result=await context.api(value.id?`/api/builds/${value.id}`:'/api/builds',value.id?'PUT':'POST',value);
    saved=saved.filter(p=>p.id!==result.id);saved.unshift(result);failure='';
    if(plan===editingPlan&&JSON.stringify(plan)===fingerprint){plan=result;dirty=false;}
    else if(plan===editingPlan&&action==='builder-save'){Object.assign(plan,{id:result.id,revision:result.revision,created_at:result.created_at,updated_at:result.updated_at});dirty=true;}
    store('paddock.builder.draft',plan);
    if(document.querySelector('.builder-workspace'))history.replaceState(null,'',builderHash());
    refresh();document.querySelector(`[data-action="${action==='builder-copy'?'builder-copy':'builder-save'}"]`)?.focus();context.notify(dirty?'Build saved. Your newer draft changes are still unsaved.':'Build saved in this browser.');
  }
  if(action==='builder-retry'){saved=(await context.api('/api/builds')).builds;failure='';refresh();}
  if(action==='builder-export'){const backup=await context.api('/api/builds/export');const url=URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=`paddock-builds-${new Date().toISOString().slice(0,10)}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);context.notify('Builds exported with revision history.');}
}
export function builderSubmit(form){
  if(form.id!=='builder-custom')return false;
  const fields=new FormData(form),name=String(fields.get('name')||'').trim();if(!name)throw new Error('Enter the custom item name.');
  const kind=fields.get('kind'),id='custom.'+crypto.randomUUID(),group={part:'parts',ability:'abilities',crash_ability:'crash_abilities'}[kind];
  plan.custom_items.push({id,name,kind,description:String(fields.get('description')||'')});plan[group].push(id);remember();refresh();return true;
}
