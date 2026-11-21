import { fetchIncidents, ack } from './api.js';

const REFRESH_MS = 2000;

const board = document.querySelector('[data-testid="board"]');
const list = document.querySelector('[data-testid="incident-list"]');
const loader = document.querySelector('[data-testid="loader"]');
const empty = document.querySelector('[data-testid="empty"]');
const status = document.querySelector('[data-testid="status"]');

// Rows are kept by incident id, so a refresh never rebuilds a row or loses its ack state.
const rows = new Map();
const acked = new Map();

const timeFormat = new Intl.DateTimeFormat(navigator.languages?.length ? navigator.languages : undefined, {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});
const localTime = (iso) => timeFormat.format(new Date(iso));

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text != null) node.textContent = text;
  return node;
}

function markAcked(row, reply) {
  const cell = row.querySelector('.act');
  cell.replaceChildren(el('span', { 'data-testid': 'acked', class: 'acked', title: reply.ackedAt }, `acked ${localTime(reply.ackedAt)}`));
  row.classList.add('is-acked');
}

function buildRow(i) {
  const row = el('li', { 'data-testid': 'incident-row', 'data-id': i.id, class: `row ${i.severity}` });
  row.append(
    el('span', { class: 'id' }, i.id),
    el('span', { class: 'sev' }, i.severity),
    el('span', { class: 'what' }, `${i.service} · ${i.region} · ${i.summary}`),
    el('time', { datetime: i.openedAt, title: i.openedAt }, localTime(i.openedAt)),
  );
  const cell = el('span', { class: 'act' });
  const button = el('button', { type: 'button', 'data-testid': 'ack' }, 'Ack');
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'Acking…';
    try {
      const reply = await ack(i.id);
      acked.set(i.id, reply);
      markAcked(row, reply);
    } catch (err) {
      console.error(err);
      button.disabled = false;
      button.textContent = 'Ack';
      showStatus(`Ack failed for ${i.id}. Try again.`);
    }
  });
  cell.append(button);
  row.append(cell);
  if (acked.has(i.id)) markAcked(row, acked.get(i.id));
  return row;
}

function render(incidents) {
  const ids = new Set(incidents.map((i) => i.id));
  for (const [id, row] of rows) {
    if (!ids.has(id)) {
      row.remove();
      rows.delete(id);
    }
  }
  // incidents come newest first; walk them in order so new ones land at the top (R1).
  let prev = null;
  for (const i of incidents) {
    let row = rows.get(i.id);
    if (!row) {
      row = buildRow(i);
      rows.set(i.id, row);
    }
    const want = prev ? prev.nextSibling : list.firstChild;
    if (row !== want) list.insertBefore(row, want);
    prev = row;
  }
  empty.hidden = incidents.length > 0;
  list.hidden = incidents.length === 0;
}

function showStatus(text) {
  status.textContent = text;
  status.hidden = !text;
}

async function refresh() {
  try {
    const page = await fetchIncidents();
    render(page.incidents);
    loader.hidden = true;
    board.setAttribute('aria-busy', 'false');
    showStatus('');
  } catch (err) {
    console.error(err);
    showStatus('Could not reach the incident API. Retrying…');
  } finally {
    setTimeout(refresh, REFRESH_MS);
  }
}

const sha = document.querySelector('meta[name="build"]')?.content ?? 'dev';
document.querySelector('[data-testid="build-sha"]').textContent = sha;

refresh();
