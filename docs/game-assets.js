export function gameText(value) {
  return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])).replace(/\b(Afterburner|Ramjet|Burning|Cooled|Surging|Overcharged|Shielded|Redlining|Concussed|Frozen|Disrupted|Energy|Speed|System Malfunction|Slipstreaming|Takedown|Perfect Landing)\b/g,'<mark>$1</mark>');
}
// Generic equipment and driving symbols drawn for the public companion.
const paths = {
  Cornering: 'M4 18h5a3 3 0 0 0 3-3v-4a3 3 0 0 1 3-3h5m-4-4 4 4-4 4',
  Afterburner: 'M4 7h7l5 5-5 5H4m9-10h2l5 5-5 5h-2',
  Resilience: 'M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z',
  Ramjet: 'M3 12h12m-5-5 5 5-5 5m8-11v12m3-10v8',
  Battery: 'M8 6V4h8v2m-10 0h12v14H6zm3 7h6m-3-3v6',
  'Advanced handling': 'M4 17c4 0 5-9 9-9h7m-4-4 4 4-4 4M4 12l2-2',
  Speed: 'M4 17a8 8 0 1 1 16 0M12 16l4-5',
  ability: 'M12 3v4m0 10v4M3 12h4m10 0h4M12 7l5 5-5 5-5-5z',
  part: 'M8 4h8l4 8-4 8H8l-4-8zm4 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  crash: 'M3 4l5 5m8 6 5 5m-1-16-5 5m-6 6-5 5m8-13v10m-5-5h10',
  style: 'M4 7h16M8 12h12m-8 5h8',
};

export function gameGlyph(name, size = 32, cls = '') {
  const path = paths[name];
  return path ? `<svg class="game-glyph ${cls}" aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>` : '';
}
export function gameScript() { return ''; }
export function abilityGlyph(id, size = 48) {
  return gameGlyph(id.startsWith('crash.') ? 'crash' : 'ability', size);
}
const partFocus = {
  Ramjet: ['ramjet','ramming jet','coolant','cooling','alarm','overheat','redlining'],
  Afterburner: ['fuel','refueler','afterburner','refueling','catalyst'],
  Battery: ['attachments','recycler','reloader','overcharged','surplus'],
  Resilience: ['plating','shield','protection','degausser','robust'],
  Speed: ['velocity'],
  'Advanced handling': ['landing','repulsor']
};
export function partGlyph(item, size = 42) {
  const name = item.name.toLowerCase();
  const focus = Object.entries(partFocus).find(([, words]) => words.some(word => name.includes(word)))?.[0] || 'part';
  return {html: gameGlyph(focus, size), exact: false};
}
