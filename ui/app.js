import { filterItems } from './filter.js';
import { toggleItem } from './state.js';
import { wireNotice } from './notice.js';

let items = [
  { id: 'notes', name: 'Morning notes', detail: 'A blank page for a fresh idea', enabled: false },
  { id: 'sketch', name: 'Pocket sketch', detail: 'A tiny place to draw something', enabled: true },
  { id: 'reading', name: 'Reading list', detail: 'A few stories for a quiet hour', enabled: false },
];
const list = document.querySelector('#items');
const input = document.querySelector('#item-filter');

function render() {
  const visible = filterItems(items, input.value);
  list.replaceChildren(...visible.map((item) => {
    const row = document.createElement('li');
    row.className = 'item';
    row.dataset.itemId = item.id;
    const description = document.createElement('div');
    const title = document.createElement('h2');
    title.textContent = item.name;
    const detail = document.createElement('p');
    detail.textContent = item.detail;
    description.append(title, detail);
    const actions = document.createElement('div');
    actions.className = 'item-actions';
    const state = document.createElement('span');
    state.className = 'state';
    state.dataset.enabled = String(item.enabled);
    state.textContent = item.enabled ? 'Enabled' : 'Disabled';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.dataset.action = 'toggle';
    toggle.setAttribute('aria-label', `${item.enabled ? 'Disable' : 'Enable'} ${item.name}`);
    toggle.textContent = item.enabled ? 'Disable' : 'Enable';
    toggle.addEventListener('click', () => {
      items = items.map((candidate) => candidate.id === item.id ? toggleItem(candidate) : candidate);
      render();
      list.querySelector(`[data-item-id="${item.id}"] button`).focus();
    });
    actions.append(state, toggle);
    row.append(description, actions);
    return row;
  }));
  document.querySelector('#result-count').textContent = `${visible.length} ${visible.length === 1 ? 'item' : 'items'} shown`;
  document.querySelector('#empty-state').hidden = visible.length !== 0;
}

input.addEventListener('input', render);
document.querySelector('#reset-filter').addEventListener('click', () => {
  input.value = '';
  render();
  input.focus();
});
wireNotice(document.querySelector('[data-testid="notice"]'), document.querySelector('#dismiss-notice'), document.querySelector('#restore-notice'));
render();
