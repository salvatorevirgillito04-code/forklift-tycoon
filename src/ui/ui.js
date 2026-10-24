import { t, fmt } from '../i18n.js';
import { ICONS } from './icons.js';

export const $ = (sel, root = document) => root.querySelector(sel);

const modalRoot = () => $('#modal-root');

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function coinPill(coins) {
  return `<div class="coin-pill">${ICONS.coin}<span>${fmt(coins)}</span></div>`;
}

// Finestra modale; ritorna una funzione per chiuderla.
export function openModal(html, { onClose, className = '' } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="modal ${className}" role="dialog" aria-modal="true">
      <button class="modal-close" aria-label="${t('close')}">${ICONS.close}</button>
      ${html}
    </div>`;
  modalRoot().appendChild(wrap);
  const close = () => {
    wrap.remove();
    onClose?.();
  };
  wrap.querySelector('.modal-close').addEventListener('click', close);
  wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) close(); });
  return { el: wrap.querySelector('.modal'), close };
}

export function confirmDialog(text) {
  return new Promise((resolve) => {
    let answered = false;
    const { el, close } = openModal(`
      <p class="confirm-text">${esc(text)}</p>
      <div class="row-btns">
        <button class="pill-btn grey" data-no>${t('cancel')}</button>
        <button class="pill-btn green" data-yes>${t('confirm')}</button>
      </div>`, { onClose: () => { if (!answered) resolve(false); }, className: 'small' });
    el.querySelector('[data-yes]').addEventListener('click', () => { answered = true; close(); resolve(true); });
    el.querySelector('[data-no]').addEventListener('click', () => { answered = true; close(); resolve(false); });
  });
}

let toastTimer = null;
export function toast(text, kind = 'info') {
  let el = $('#ui-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'ui-toast';
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 2200);
}
