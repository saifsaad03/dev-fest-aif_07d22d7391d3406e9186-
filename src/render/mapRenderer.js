/**
 * SVG map renderer. Draws once, then patches attributes on each state change -
 * cheaper and less flickery than rebuilding the DOM.
 *
 * DOM contract (ids created on mount):
 *   svg#map > g#layers > g.edge-layer / g.route-layer / g.node-layer
 */

import { t } from '../i18n/index.js';
import { edgeName, nodeName } from '../core/graph.js';

const NS = 'http://www.w3.org/2000/svg';

/** @param {string} tag @param {Record<string,string>} attrs */
function el(tag, attrs = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

const EDGE_WIDTH = { room: 5, junction: 5, exit: 7 };

export class MapRenderer {
  /**
   * @param {SVGSVGElement} svg
   * @param {import('../core/graph.js').Graph} graph
   * @param {{onNodeSelect:(id:string)=>void, onEdgeSelect:(id:string)=>void, onBackground:()=>void}} handlers
   */
  constructor(svg, graph, handlers) {
    this.svg = svg;
    this.graph = graph;
    this.handlers = handlers;
    /** @type {Map<string, SVGGElement>} */
    this.nodeEls = new Map();
    /** @type {Map<string, SVGGElement>} */
    this.edgeEls = new Map();
    /** @type {Map<string, SVGLineElement>} */
    this.costEls = new Map();
    /** @type {SVGPathElement[]} */
    this.routeSegs = [];
    this.build();
  }

  build() {
    const { svg, graph } = this;
    const { width, height } = graph.building.bounds;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.replaceChildren();

    const layers = el('g', { id: 'layers' });
    this.edgeLayer = el('g', { id: 'edge-layer' });
    this.routeLayer = el('g', { id: 'route-layer' });
    this.nodeLayer = el('g', { id: 'node-layer' });
    layers.append(this.edgeLayer, this.routeLayer, this.nodeLayer);
    svg.append(layers);

    for (const edge of graph.building.edges) this.drawEdge(edge);
    for (const node of graph.building.nodes) this.drawNode(node);

    // Clicking empty floor clears the inspection panel.
    svg.addEventListener('click', () => this.handlers.onBackground());
  }

  /** @param {{id:string,from:string,to:string,cost:number}} edge */
  drawEdge(edge) {
    const a = this.graph.nodesById.get(edge.from);
    const b = this.graph.nodesById.get(edge.to);

    const width = Math.max(EDGE_WIDTH[a.type], EDGE_WIDTH[b.type]);
    const hit = el('line', {
      x1: a.x, y1: a.y, x2: b.x, y2: b.y,
      class: 'edge',
      'stroke-width': width + 12,
      'data-edge': edge.id,
      fill: 'none',
      tabindex: '0',
      role: 'button',
    });
    const line = el('line', {
      x1: a.x, y1: a.y, x2: b.x, y2: b.y,
      class: 'edge-line',
      'stroke-width': width,
      'data-edge': edge.id,
      fill: 'none',
    });

    hit.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.handlers.onEdgeSelect(edge.id);
    });
    hit.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        this.handlers.onEdgeSelect(edge.id);
      }
    });
    const title = el('title');
    title.textContent = `${edgeName(this.graph, edge.id)} \u00b7 ${edge.cost} ${t('unit.m')}`;
    hit.append(title);
    hit.setAttribute('aria-label', title.textContent);

    // Cost badge, nudged perpendicular to the segment so it never sits on it.
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const offset = 16;
    const cost = el('text', {
      x: (a.x + b.x) / 2 + (-dy / len) * offset,
      y: (a.y + b.y) / 2 + (dx / len) * offset,
      class: 'edge-cost',
      'text-anchor': 'middle',
      'dominant-baseline': 'middle',
      'data-edge': edge.id,
    });
    cost.textContent = String(edge.cost);

    this.edgeLayer.append(hit, line);
    this.nodeLayer.append(cost);
    this.edgeEls.set(edge.id, hit);
    this.costEls.set(edge.id, cost);
    void line;
  }

  /** @param {object} node */
  drawNode(node) {
    const g = el('g', {
      class: `node node-${node.type}`,
      'data-node': node.id,
      transform: `translate(${node.x} ${node.y})`,
      tabindex: '0',
      role: 'button',
    });

    const r = node.type === 'room' ? 26 : node.type === 'exit' ? 24 : 15;
    const shape =
      node.type === 'room'
        ? el('rect', { x: -r, y: -r, width: r * 2, height: r * 2, rx: 6, class: 'node-shape' })
        : el('circle', { r, class: 'node-shape' });

    const caption = el('text', { class: 'node-label', y: r + 15, 'text-anchor': 'middle' });
    const value = el('text', { class: 'node-value', y: 5, 'text-anchor': 'middle', 'dominant-baseline': 'middle' });

    const title = el('title');
    g.append(title, shape, value, caption);
    this.nodeLayer.append(g);
    this.nodeEls.set(node.id, g);

    g.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.handlers.onNodeSelect(node.id);
    });
    g.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        this.handlers.onNodeSelect(node.id);
      }
    });
  }

  /**
   * Patch the rendered map from the current store snapshot.
   * @param {any} state
   */
  update(state) {
    const routeEdgeIds = new Set(state.route?.edgeIds ?? []);
    const routeNodes = new Set(state.route?.nodeIds ?? []);
    const path = state.route?.nodeIds ?? [];

    for (const [id, g] of this.nodeEls) {
      const node = this.graph.nodesById.get(id);
      const blocked = state.blockedNodes.has(id);
      const closed = state.closedExits.has(id);
      const isStart = state.startNodeId === id;
      const onRoute = routeNodes.has(id);
      const selected = state.selectedNodeId === id;

      g.classList.toggle('is-blocked', blocked);
      g.classList.toggle('is-closed', closed);
      g.classList.toggle('is-start', isStart);
      g.classList.toggle('is-selected', selected);
      g.classList.toggle('is-on-route', onRoute);

      const name = nodeName(this.graph, id);
      const value = g.querySelector('.node-value');
      const text = g.querySelector('.node-label');
      text.textContent = name;
      value.textContent = isStart
        ? '\u25b2'
        : node.type === 'exit'
          ? '\u2197'
          : String(node.id).replace(/^[a-z]+_/, '');
      const state_ = blocked ? t('state.blocked') : closed ? t('state.closed') : t('state.clear');
      g.querySelector('title').textContent = `${name} \u00b7 ${state_}`;
      g.setAttribute('aria-label', `${name} (${t(`type.${node.type}`)}) \u00b7 ${state_}`);
    }

    for (const [id, g] of this.edgeEls) {
      const blocked = state.blockedEdges.has(id);
      const selected = state.selectedEdgeId === id;
      g.classList.toggle('is-blocked', blocked);
      g.classList.toggle('is-on-route', routeEdgeIds.has(id));
      g.classList.toggle('is-selected', selected);
      const cost = this.costEls.get(id);
      cost.classList.toggle('is-blocked', blocked);
      cost.classList.toggle('is-on-route', routeEdgeIds.has(id));
    }

    this.drawRoute(path);
  }

  /** @param {string[]} nodeIds */
  drawRoute(nodeIds) {
    this.routeLayer.replaceChildren();
    this.routeSegs = [];
    if (nodeIds.length < 2) return;

    for (let i = 0; i < nodeIds.length - 1; i += 1) {
      const a = this.graph.nodesById.get(nodeIds[i]);
      const b = this.graph.nodesById.get(nodeIds[i + 1]);
      this.routeLayer.append(
        el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'route-seg' }),
      );
    }
  }
}