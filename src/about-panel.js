/**
 * The About dialog: what this build is, who wrote it and where to find it.
 *
 * Everything here is static apart from the version numbers, which come from
 * the build (`__APP_VERSION__`, injected by Vite from package.json) and from
 * the preload bridge.
 */
import iconUrl from './assets/icon-256.png';

const $ = (id) => document.getElementById(id);

const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';

export const LINKS = {
  repo: 'https://github.com/jojonki/jmd',
  developer: 'https://github.com/jojonki',
  sponsor: 'https://github.com/sponsors/jojonki',
};

export function createAboutPanel({ openExternal, versions } = {}) {
  const overlay = $('about');
  const body = $('about-body');

  const open = (url) => openExternal?.(url) ?? window.open(url, '_blank', 'noopener');

  const runtime = [
    versions?.electron && `Electron ${versions.electron}`,
    versions?.chrome && `Chromium ${versions.chrome.split('.')[0]}`,
  ].filter(Boolean).join(' · ');

  body.innerHTML = `
    <div class="about-hero">
      <img class="about-icon" src="${iconUrl}" alt="" width="72" height="72" />
      <div class="about-id">
        <div class="about-name">jmd</div>
        <div class="about-tagline">A simple, lightweight markdown editor with live preview.</div>
        <div class="about-version">Version ${APP_VERSION}${runtime ? ` · ${runtime}` : ''}</div>
      </div>
    </div>

    <dl class="about-facts">
      <dt>Developer</dt>
      <dd><a class="about-link" href="${LINKS.developer}" data-url="${LINKS.developer}">@jojonki</a></dd>
      <dt>Repository</dt>
      <dd><a class="about-link" href="${LINKS.repo}" data-url="${LINKS.repo}">github.com/jojonki/jmd</a></dd>
      <dt>License</dt>
      <dd>MIT</dd>
    </dl>

    <div class="about-sponsor">
      <div class="field-label">Support jmd</div>
      <div class="field-hint">
        jmd is built and maintained in spare time. If it earns a place in your
        day, a sponsorship keeps the work going — thank you!
      </div>
      <button type="button" class="btn about-sponsor-btn" data-url="${LINKS.sponsor}">
        <span class="about-heart" aria-hidden="true">♥</span> Sponsor on GitHub
      </button>
    </div>`;

  // One handler for every link and button that leaves the app.
  body.addEventListener('click', (event) => {
    const target = event.target.closest('[data-url]');
    if (!target) return;
    event.preventDefault();
    open(target.dataset.url);
  });

  $('about-close').addEventListener('click', () => close());
  overlay.addEventListener('mousedown', (event) => {
    if (event.target === overlay) close();
  });
  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  });

  function openDialog() {
    overlay.hidden = false;
    $('about-close').focus();
  }

  function close() {
    overlay.hidden = true;
  }

  return {
    open: openDialog,
    close,
    toggle: () => (overlay.hidden ? openDialog() : close()),
    get isOpen() {
      return !overlay.hidden;
    },
    version: APP_VERSION,
  };
}
