/**
 * Sidebar: hazard toggles, start picker, scenarios, legend, detail readout.
 * Renders imperatively from the store snapshot on every change.
 */

import { label, t } from '../i18n/index.js';
import { edgeName, nodeName } from '../core/graph.js';
import {
  resetHazards,
  setExitClosed,
  setStartNode,
  toggleEdge,
  toggleNode,
} from '../core/store.js';

/** @param {HTMLElement} root @param {import('../core/graph.js').Graph} graph */
export class Sidebar {
  constructor(root, graph) {
    this.root = root;
    this.graph = graph;
  }

  /** @param {any} state */
  update(state) {
    this.root.replaceChildren();

    /* The legend leads the list: it explains the map's colours, and the map
       sits in the adjacent column, so the key must be visible without
       scrolling a full-height sidebar. */
    this.root.append(
      this.legendSection(),
      this.startSection(state),
      this.routeSection(state),
      this.detailSection(state),
      this.hazardSection(state),
    );
  }

  /** Readable step-by-step route, so nobody has to decode raw node ids. */
  routeSection(state) {
    const wrap = section('panel.route');
    const route = state.route;
    if (!route?.nodeIds?.length) {
      wrap.append(p(t('panel.routeNone'), 'muted small'));
      return wrap;
    }

    const ol = document.createElement('ol');
    ol.className = 'route-list';
    for (const [i, id] of route.nodeIds.entries()) {
      const node = this.graph.nodesById.get(id);
      const li = document.createElement('li');
      li.className = `route-step step-${node?.type ?? 'room'}`;
      if (id === state.startNodeId) li.classList.add('is-start');
      if (node?.type === 'exit') li.classList.add('is-exit');

      const name = document.createElement('span');
      name.className = 'route-step-name';
      name.textContent = nodeName(this.graph, id);
      li.append(name);

      if (i < route.nodeIds.length - 1) {
        const leg = this.graph.adjacency.get(id)?.find((l) => l.to === route.nodeIds[i + 1]);
        const dist = document.createElement('span');
        dist.className = 'route-step-cost';
        dist.textContent = leg ? `${leg.cost} ${t('unit.m')}` : '';
        li.append(dist);
      }
      ol.append(li);
    }
    wrap.append(ol);
    return wrap;
  }

  /** @param {any} state */
  startSection(state) {
    const wrap = section('panel.start');
    const select = document.createElement('select');
    select.className = 'select';
    select.setAttribute('aria-label', t('panel.start'));
    for (const node of this.graph.building.nodes.filter((item) => item.type !== 'exit')) {
      const opt = document.createElement('option');
      opt.value = node.id;
      opt.textContent = `${label(node.labels) || node.id}`;
      opt.selected = node.id === state.startNodeId;
      opt.disabled = state.blockedNodes.has(node.id);
      select.append(opt);
    }
    select.addEventListener('change', () => setStartNode(select.value));
    wrap.append(select);
    return wrap;
  }

  /** @param {any} state */
  hazardSection(state) {
    const wrap = section('panel.hazards');

    const nodes = [...state.blockedNodes].map((id) =>
      chip({
        text: nodeName(this.graph, id),
        sub: id,
        onRemove: () => toggleNode(id),
      }),
    );
    const edges = [...state.blockedEdges].map((id) => {
      const edge = this.graph.edgesById.get(id);
      return chip({
        text: edgeName(this.graph, id),
        sub: edge ? `${edge.cost} ${t('unit.m')}` : id,
        onRemove: () => toggleEdge(id),
      });
    });
    const exits = [...state.closedExits].map((id) =>
      chip({
        text: nodeName(this.graph, id),
        sub: t('state.closed'),
        onRemove: () => setExitClosed(id, false),
      }),
    );

    wrap.append(
      group('panel.nodes', nodes, state.blockedNodes.size),
      group('panel.edges', edges, state.blockedEdges.size),
      group('panel.exits', exits, state.closedExits.size),
    );

    const clear = i18nButton('action.clearHazards', () => resetHazards());
    clear.classList.add('btn', 'btn-ghost', 'btn-block');
    clear.disabled = !state.blockedNodes.size && !state.blockedEdges.size && !state.closedExits.size;
    wrap.append(clear);
    return wrap;
  }

  /**
   * Inspector for whatever was last clicked on the map. Sits directly under
   * the route so the answer to "where do I go, and what is stopping me?" is
   * read in one place.
   * @param {any} state
   */
  detailSection(state) {
    const wrap = section('panel.pathControl');

    if (state.selectedEdgeId) {
      const edge = this.graph.edgesById.get(state.selectedEdgeId);
      if (!edge) {
        wrap.append(p(t('label.instruction'), 'muted small'));
        return wrap;
      }
      const title = heading(t('type.corridor'), 'tag tag-corridor');
      wrap.append(title, p(edgeName(this.graph, edge.id), 'detail-title'));
      const dl = document.createElement('dl');
      dl.className = 'detail-list';
      addRow(dl, 'label.from', nodeName(this.graph, edge.from));
      addRow(dl, 'label.to', nodeName(this.graph, edge.to));
      addRow(dl, 'label.cost', `${edge.cost} ${t('unit.m')}`);
      addRow(dl, 'label.id', edge.id);
      wrap.append(dl);
      wrap.append(
        actionButton(state.blockedEdges.has(edge.id) ? 'action.reopen' : 'action.block', () => toggleEdge(edge.id), {
          on: state.blockedEdges.has(edge.id),
        }),
      );
      return wrap;
    }

    if (!state.selectedNodeId) {
      wrap.append(p(t('label.instruction'), 'muted small'));
      return wrap;
    }

    const node = this.graph.nodesById.get(state.selectedNodeId);
    if (!node) {
      wrap.append(p(t('label.instruction'), 'muted small'));
      return wrap;
    }

    wrap.append(
      heading(t(`type.${node.type}`), `tag tag-${node.type}`),
      p(label(node.labels) || node.id, 'detail-title'),
    );

    const dl = document.createElement('dl');
    dl.className = 'detail-list';
    if (node.type !== 'exit') addRow(dl, 'label.capacity', `${node.capacity ?? '-'} ${t('unit.people')}`);
    if (node.type === 'exit') {
      const open = !state.closedExits.has(node.id);
      addRow(dl, 'label.state', t(open ? 'state.open' : 'state.closed'));
    } else {
      addRow(dl, 'label.state', t(state.blockedNodes.has(node.id) ? 'state.blocked' : 'state.clear'));
      if (node.id === state.startNodeId) addRow(dl, 'label.start', t('state.here'));
    }
    const neighbours = this.graph.adjacency.get(node.id) ?? [];
    addRow(
      dl,
      'label.connects',
      neighbours.length
        ? neighbours
            .map((l) => `${nodeName(this.graph, l.to)} (${l.cost}${t('unit.m')})`)
            .join(', ')
        : '-',
    );
    addRow(dl, 'label.id', node.id);
    wrap.append(dl);

    if (state.route?.nodeIds?.includes(node.id)) {
      wrap.append(p(t('label.onRoute'), 'flag flag-route'));
    }

    const isExit = node.type === 'exit';
    const isClosed = state.closedExits.has(node.id);
    const isBlocked = state.blockedNodes.has(node.id);
    wrap.append(
      actionButton(
        isExit ? (isClosed ? 'action.reopen' : 'action.close') : isBlocked ? 'action.reopen' : 'action.block',
        () => toggleNode(node.id),
        { on: isExit ? isClosed : isBlocked },
      ),
    );
    if (!isExit && node.id !== state.startNodeId) {
      const start = i18nButton('action.makeStart', () => setStartNode(node.id));
      start.classList.add('btn', 'btn-ghost', 'btn-block');
      start.disabled = isBlocked;
      wrap.append(start);
    }
    return wrap;
  }

  legendSection() {
    const wrap = section('panel.legend');
    /* Stable hook: the stylesheet lifts this card out of the sidebar column and
       parks it above the map on narrow screens. See the <=900px media query. */
    wrap.id = 'legend-card';
    const list = document.createElement('ul');
    list.className = 'legend';
    for (const [cls, key] of [
      ['room', 'legend.room'],
      ['junction', 'legend.junction'],
      ['exit', 'legend.exit'],
      ['start', 'legend.start'],
      ['blocked', 'legend.blocked'],
      ['closed', 'legend.closed'],
      ['route', 'legend.route'],
    ]) {
      const li = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = `legend-swatch swatch-${cls}`;
      const txt = document.createElement('span');
      txt.textContent = t(key);
      li.append(dot, txt);
      list.append(li);
    }
    wrap.append(list);
    return wrap;
  }
}

/* ---------- tiny DOM helpers ---------- */

/** @param {string} headingKey */
function section(headingKey) {
  const wrap = document.createElement('section');
  wrap.className = 'panel-section';
  const h = document.createElement('h2');
  h.textContent = t(headingKey);
  wrap.append(h);
  return wrap;
}

/**
 * @param {string} headingKey
 * @param {Node[]} chips
 * @param {number} count
 */
function group(headingKey, chips, count) {
  const g = document.createElement('div');
  g.className = 'chip-group';
  const h = document.createElement('h3');
  h.textContent = t(headingKey);
  const badge = document.createElement('span');
  badge.className = 'count';
  badge.textContent = String(count);
  h.append(badge);
  // Spread: append() stringifies an array instead of inserting the nodes.
  g.append(h, ...(chips.length ? chips : [empty(headingKey)]));
  return g;
}

/**
 * @param {{text: string, sub?: string, onRemove: () => void}} opts
 */
function chip({ text, sub, onRemove }) {
  const span = document.createElement('span');
  span.className = 'chip';
  const labelText = document.createElement('span');
  labelText.className = 'chip-text';
  labelText.textContent = text;
  span.append(labelText);
  if (sub) {
    const meta = document.createElement('span');
    meta.className = 'chip-sub';
    meta.textContent = sub;
    span.append(meta);
  }
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'chip-x';
  x.textContent = '\u00d7';
  x.setAttribute('aria-label', `${t('action.remove')} ${text}`);
  x.addEventListener('click', onRemove);
  span.append(x);
  return span;
}

/** @param {string} key */
function empty(key) {
  const el = document.createElement('p');
  el.className = 'muted small';
  el.textContent = t('panel.none');
  void key;
  return el;
}

/** @param {string} text @param {() => void} onClick Literal text, not a key. */
function button(text, onClick) {
  const b = document.createElement('button');
  b.className = 'btn';
  b.type = 'button';
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

/** @param {string} key @param {() => void} onClick Translated label. */
function i18nButton(key, onClick) {
  const b = button(t(key), onClick);
  b.dataset.i18n = key;
  return b;
}

/**
 * @param {string} key
 * @param {() => void} onClick
 * @param {{on: boolean}} opts
 */
function actionButton(key, onClick, { on }) {
  const b = i18nButton(key, onClick);
  b.classList.add('btn-block', on ? 'btn-danger-ghost' : 'btn-danger');
  return b;
}

/** @param {string} text @param {string} [cls] */
function p(text, cls) {
  const el = document.createElement('p');
  if (cls) el.className = cls;
  el.textContent = text;
  return el;
}

/** @param {string} text @param {string} cls */
function heading(text, cls) {
  const el = document.createElement('span');
  el.className = cls;
  el.textContent = text;
  return el;
}

/** @param {HTMLElement} dl @param {string} key @param {string} value */
function addRow(dl, key, value) {
  const dt = document.createElement('dt');
  dt.textContent = t(key);
  const dd = document.createElement('dd');
  dd.textContent = value;
  dl.append(dt, dd);
}
