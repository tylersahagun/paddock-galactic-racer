const stages = ['Stage 1', 'Stage 2', 'Stage 3', 'Stage 4', 'Stage 5', 'Final race'];
const fieldSize = 12;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => (
  {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]
));

const flag = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 21V4h16v12H4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M5 5h5v5H5zm5 5h5v5h-5zm5-5h4v5h-4z" fill="currentColor"/></svg>';

function rank(value) {
  if (value === '' || value == null) return 'blank';
  const position = Number(value);
  if (position >= 1 && position <= 3) return 'podium';
  if (position >= 4 && position <= 9) return 'middle';
  if (position >= 10 && position <= fieldSize) return 'rear';
  return 'blank';
}

function resultRow(driver, index, yourRow, joinedAt) {
  const isYou = index === yourRow;
  const cells = stages.map((stage, stageIndex) => {
    const value = driver?.positions?.[stageIndex] ?? '';
    const missed = isYou && stageIndex + 1 < joinedAt;
    const column = stageIndex === stages.length - 1 ? ' class="final-column"' : '';
    return `<td${column}><input type="text" inputmode="numeric" pattern="[1-9]|1[0-2]" maxlength="2"
      name="position-${index}-${stageIndex}" aria-label="Driver ${index + 1}, ${stage} position"
      class="result-position" data-row="${index}" data-stage="${stageIndex + 1}" data-rank="${rank(value)}"
      placeholder="–" value="${esc(value)}"${missed ? ' disabled' : ''}></td>`;
  }).join('');
  return `<tr data-driver-row="${index}"${isYou ? ' class="your-row"' : ''}>
    <th class="driver-column" scope="row">
      <div class="driver-cell"><span class="driver-number">${String(index + 1).padStart(2, '0')}</span>
      <input type="text" name="driver-${index}" aria-label="Driver ${index + 1} name" value="${esc(driver?.name)}" placeholder="Driver ${index + 1}" maxlength="48">
      <span class="you-label"${isYou ? '' : ' hidden'}>You</span></div>
    </th>${cells}</tr>`;
}

export function resultsHTML(tour, tours, defaultTourName) {
  const startForm = `<form id="results-start-tour" class="results-start-tour">
    <label>Tour name<input name="name" value="${esc(defaultTourName)}" maxlength="120" required></label>
    <button type="submit" class="button">Start tour</button>
  </form>`;
  const selectedTour = tour || tours[0];
  if (!selectedTour) return startForm;
  const {id, standings} = selectedTour;
  const yourRow = standings?.your_row ?? 0;
  const joinedAt = standings?.joined_at ?? 1;
  const rows = Array.from({length: fieldSize}, (_, i) => resultRow(standings?.drivers?.[i], i, yourRow, joinedAt)).join('');
  return `<form id="tour-results" class="results-form" aria-label="Tour standings">
    <div class="results-toolbar">
      <label>Tour<select id="results-tour" name="tour_id">${tours.map(t =>
        `<option value="${esc(t.id)}"${t.id === id ? ' selected' : ''}>${esc(t.name || 'Untitled tour')}</option>`).join('')}</select></label>
      <label>Your row<select name="your_row">${Array.from({length: fieldSize}, (_, i) =>
        `<option value="${i}"${i === yourRow ? ' selected' : ''}>Driver ${i + 1}</option>`).join('')}</select></label>
      <label>Joined at<select name="joined_at">${stages.map((stage, i) =>
        `<option value="${i + 1}"${i + 1 === joinedAt ? ' selected' : ''}>${stage}</option>`).join('')}</select></label>
      <label class="result-join-check"><input type="checkbox" name="joined_in_progress"${standings?.joined_in_progress ? ' checked' : ''}>Joined race in progress</label>
      <button class="button" type="submit">Save results</button>
    </div>
    <p id="results-help" class="results-help">Enter finishing positions from 1 to 12. Earlier stages stay blank for your row when you join late.</p>
    <div class="results-scroll" tabindex="0" role="region" aria-label="Standings grid" aria-describedby="results-help">
      <table class="results-grid">
        <caption class="screen-reader">Finishing positions by driver and race</caption>
        <thead><tr><th scope="col" class="driver-column">Driver</th>
          ${stages.slice(0, -1).map(stage => `<th scope="col">${stage}</th>`).join('')}
          <th scope="col" class="final-column"><span>${flag} Final race</span></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </form><details class="results-new-tour"><summary>New tour</summary>${startForm}</details>`;
}

export function updateResults(form) {
  const rowIndex = Number(form.elements.your_row.value);
  const joinedAt = Number(form.elements.joined_at.value);
  for (const row of form.querySelectorAll('[data-driver-row]')) {
    const isYou = Number(row.dataset.driverRow) === rowIndex;
    row.classList.toggle('your-row', isYou);
    row.querySelector('.you-label').hidden = !isYou;
  }
  for (const input of form.querySelectorAll('.result-position')) {
    input.setCustomValidity('');
    input.disabled = Number(input.dataset.row) === rowIndex && Number(input.dataset.stage) < joinedAt;
    input.dataset.rank = rank(input.value);
  }
}

export function readResults(form) {
  const data = new FormData(form);
  for (const cell of form.querySelectorAll('.result-position')) cell.setCustomValidity('');
  const seen = stages.map(() => new Set());
  const drivers = Array.from({length: fieldSize}, (_, row) => ({
    name: String(data.get(`driver-${row}`) || '').trim(),
    positions: stages.map((stage, column) => {
      const key = `position-${row}-${column}`;
      const raw = data.get(key);
      if (!raw) return null;
      const position = Number(raw);
      if (seen[column].has(position)) {
        form.elements[key].setCustomValidity(`${stage} already has a driver in position ${position}.`);
      }
      seen[column].add(position);
      return position;
    }),
  }));
  if (!form.reportValidity()) return null;
  return {
    your_row: Number(data.get('your_row')),
    joined_at: Number(data.get('joined_at')),
    joined_in_progress: data.has('joined_in_progress'),
    drivers,
  };
}

export function resultInput(target) {
  if (!target.classList.contains('result-position')) return;
  target.dataset.rank = rank(target.value);
  for (const field of target.form.querySelectorAll(`.result-position[data-stage="${target.dataset.stage}"]`)) {
    field.setCustomValidity('');
  }
}
