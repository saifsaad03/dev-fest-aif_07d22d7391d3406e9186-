/**
 * Status banner + header chrome. Owns the four UI states:
 *   loading | ok | no_route | start_blocked
 */

import { t } from '../i18n/index.js';
import { nodeName } from '../core/graph.js';
import { getState, resetHazards, setLocale, subscribe } from '../core/store.js';

/** @param {string} locale */
export function applyDocumentLocale(locale) {
  document.documentElement.lang = locale;
  document.documentElement.dataset.locale = locale;
  for (const node of document.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n);
  }
  for (const node of document.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of node.dataset.i18nAttr.split(',')) {
      const [attr, key] = pair.split(':').map((s) => s.trim());
      if (attr && key) node.setAttribute(attr, t(key));
    }
  }
}

export class StatusBar {
  /**
   * @param {HTMLElement} root
   * @param {import('../core/graph.js').Graph} graph
   */
  constructor(root, graph) {
    this.root = root;
    this.graph = graph;
  }

  /** @param {any} state */
  update(state) {
    const status = state.status ?? 'idle';
    this.root.className = `status status-${status}`;
    this.root.replaceChildren();

    const lead = document.createElement('div');
    lead.className = 'status-lead';

    const icon = document.createElement('span');
    icon.className = 'status-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent =
      status === 'ok' ? '\u2713' : status === 'no_route' || status === 'error' ? '\u2715' : '\u25cf';

    const text = document.createElement('div');
    const title = document.createElement('strong');
    title.className = 'status-title';
    title.textContent = t(`status.${status}`);
    const detail = document.createElement('span');
    detail.className = 'status-detail';
    text.append(title, detail);
    lead.append(icon, text);

    this.root.append(lead);

    if (status === 'ok' && state.route) {
      detail.textContent = t('status.ok.detail', {
        exit: nodeName(this.graph, state.route.exitId),
      });
      this.root.append(
        metric('label.metricExit', nodeName(this.graph, state.route.exitId)),
        metric('label.metricDistance', `${state.route.cost} ${t('unit.m')}`),
        metric('label.metricSteps', String(state.route.nodeIds.length - 1)),
      );
    } else if (status === 'no_route') {
      detail.textContent = t('status.no_route.detail');
    } else if (status === 'start_blocked') {
      detail.textContent = t('status.start_blocked.detail');
    } else if (status === 'unknown_start') {
      detail.textContent = t('status.unknown_start.detail');
    } else if (status === 'error') {
      detail.textContent = state.error ?? '';
    }
  }
}

/**
 * @param {string} labelKey
 * @param {string} value
 */
function metric(labelKey, value) {
  const box = document.createElement('div');
  box.className = 'metric';
  const v = document.createElement('span');
  v.className = 'metric-value';
  v.textContent = value;
  const l = document.createElement('span');
  l.className = 'metric-label';
  l.textContent = t(labelKey);
  box.append(v, l);
  return box;
}

export function wireHeader() {
  const langBtn = document.getElementById('lang-toggle');
  const resetBtn = document.getElementById('reset-btn');

  langBtn?.addEventListener('click', () => {
    setLocale(getState().locale === 'en' ? 'bn' : 'en');
  });
  resetBtn?.addEventListener('click', () => resetHazards());

  subscribe((state) => {
    if (langBtn) langBtn.textContent = t('action.lang');
    if (resetBtn) resetBtn.textContent = t('action.reset');
    resetBtn?.toggleAttribute('disabled', state.status === 'loading' || state.status === 'error');
  });
}