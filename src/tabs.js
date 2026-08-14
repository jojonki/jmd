/**
 * The tab strip. Purely presentational: it renders whatever list of documents
 * it is handed and reports intent (select / close / new / reorder) back to the
 * caller, which owns the actual tab model.
 */
export class TabBar {
  /**
   * @param {HTMLElement} strip container the tab elements live in
   * @param {{ onSelect: (id: number) => void, onClose: (id: number) => void,
   *           onNew: () => void, onReorder: (id: number, before: number|null) => void }} handlers
   */
  constructor(strip, handlers) {
    this.strip = strip;
    this.handlers = handlers;
    /** @type {Map<number, HTMLElement>} */
    this.elements = new Map();
    this.draggingId = null;

    strip.addEventListener('click', (event) => {
      const tab = event.target.closest?.('.tab');
      if (!tab) return;
      const id = Number(tab.dataset.id);
      if (event.target.closest('.tab-close')) handlers.onClose(id);
      else handlers.onSelect(id);
    });

    // Middle click closes, matching every other tabbed app.
    strip.addEventListener('auxclick', (event) => {
      if (event.button !== 1) return;
      const tab = event.target.closest?.('.tab');
      if (!tab) return;
      event.preventDefault();
      handlers.onClose(Number(tab.dataset.id));
    });

    strip.addEventListener('dragstart', (event) => {
      const tab = event.target.closest?.('.tab');
      if (!tab) return;
      this.draggingId = Number(tab.dataset.id);
      tab.classList.add('is-dragging');
      event.dataTransfer.effectAllowed = 'move';
      // Firefox/Chromium need *some* payload before a drag will start.
      event.dataTransfer.setData('text/plain', tab.dataset.id);
    });

    strip.addEventListener('dragover', (event) => {
      if (this.draggingId == null) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    });

    strip.addEventListener('drop', (event) => {
      if (this.draggingId == null) return;
      event.preventDefault();
      const over = event.target.closest?.('.tab');
      const id = this.draggingId;
      if (!over || Number(over.dataset.id) === id) return;
      const box = over.getBoundingClientRect();
      const after = event.clientX > box.left + box.width / 2;
      const target = Number(over.dataset.id);
      handlers.onReorder(id, after ? nextIdAfter(this.strip, target) : target);
    });

    strip.addEventListener('dragend', () => {
      this.draggingId = null;
      for (const el of this.elements.values()) el.classList.remove('is-dragging');
    });
  }

  /**
   * @param {Array<{ id: number, name: string, path: string|null, dirty: boolean }>} tabs
   * @param {number|null} activeId
   */
  render(tabs, activeId) {
    const seen = new Set();
    tabs.forEach((tab, index) => {
      seen.add(tab.id);
      let el = this.elements.get(tab.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'tab';
        el.setAttribute('role', 'tab');
        el.draggable = true;
        el.dataset.id = String(tab.id);
        el.innerHTML =
          '<span class="tab-dot" aria-hidden="true">●</span>' +
          '<span class="tab-name"></span>' +
          '<button class="tab-close" type="button" tabindex="-1" aria-label="Close tab">×</button>';
        this.elements.set(tab.id, el);
      }
      const name = el.querySelector('.tab-name');
      if (name.textContent !== tab.name) name.textContent = tab.name;
      const title = tab.path ?? tab.name;
      if (el.title !== title) el.title = title;
      el.classList.toggle('is-dirty', tab.dirty);
      el.classList.toggle('is-active', tab.id === activeId);
      el.setAttribute('aria-selected', String(tab.id === activeId));
      // Reinsert only when the order actually changed.
      if (this.strip.children[index] !== el) {
        this.strip.insertBefore(el, this.strip.children[index] ?? null);
      }
    });

    for (const [id, el] of this.elements) {
      if (seen.has(id)) continue;
      el.remove();
      this.elements.delete(id);
    }
    // One document alone needs no strip.
    this.strip.parentElement?.classList.toggle('is-single', tabs.length <= 1);
  }

  /** Bring the active tab into view after a keyboard switch. */
  scrollIntoView(id) {
    this.elements.get(id)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

function nextIdAfter(strip, id) {
  const el = strip.querySelector(`.tab[data-id="${id}"]`);
  const next = el?.nextElementSibling;
  return next ? Number(next.dataset.id) : null;
}
