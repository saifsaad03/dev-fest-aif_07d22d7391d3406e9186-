import { loadBuilding, ValidationError } from './core/schema.js';
import { createGraph } from './core/graph.js';
import { findRoute } from './algorithms/dijkstra.js';
import {
  clearSelection,
  getState,
  initState,
  selectEdge,
  selectNode,
  setRouteOutcome,
  subscribe,
} from './core/store.js';
import { MapRenderer } from './render/mapRenderer.js';
import { Sidebar } from './ui/sidebar.js';
import { StatusBar, applyDocumentLocale, wireHeader } from './ui/statusBar.js';
import { setLocale as setI18nLocale, t, label } from './i18n/index.js';

const DATA_URL = `${import.meta.env.BASE_URL}building.json`;

/** @param {string} message */
function fatal(message) {
  const banner = document.getElementById('status');
  banner.className = 'status status-error';
  banner.replaceChildren();
  const strong = document.createElement('strong');
  strong.textContent = t('status.error');
  const pre = document.createElement('pre');
  pre.className = 'error-detail';
  pre.textContent = message;
  banner.append(strong, pre);
}

async function main() {
  wireHeader();

  subscribe((state) => {
    setI18nLocale(state.locale);
    applyDocumentLocale(state.locale);
    const nameEl = document.getElementById('building-name');
    if (state.building) nameEl.textContent = label(state.building.meta.labels);
  });

  /** @type {import('./core/graph.js').Graph} */
  let graph;
  try {
    const building = await loadBuilding(DATA_URL);
    graph = createGraph(building);
    initState(building);
  } catch (err) {
    fatal(err instanceof ValidationError ? err.format() : String(err));
    console.error(err);
    return;
  }

  const renderer = new MapRenderer(document.getElementById('map'), graph, {
    onNodeSelect: selectNode,
    onEdgeSelect: selectEdge,
    onBackground: clearSelection,
  });
  const sidebar = new Sidebar(document.getElementById('sidebar'), graph);
  const statusBar = new StatusBar(document.getElementById('status'), graph);

  /**
   * Single derivation + paint path. Routing is cheap (a few hundred nodes) so
   * recomputing on every state change costs nothing and removes a whole class
   * of "stale route" bugs. The `route` reason is skipped to avoid repainting
   * twice, since setRouteOutcome notifies synchronously from inside paint().
   */
  const paint = () => {
    const state = getState();
    setRouteOutcome(
      findRoute({
        building: state.building,
        startNodeId: state.startNodeId,
        blockedNodes: state.blockedNodes,
        blockedEdges: state.blockedEdges,
        closedExits: state.closedExits,
      }),
    );

    // Read the settled state back so the map shows the fresh route this frame.
    const next = getState();
    renderer.update(next);
    sidebar.update(next);
    statusBar.update(next);
  };

  subscribe((_state, _prev, reason) => {
    if (reason === 'route') return;
    paint();
  });

  paint();
  wireKeyboard();
}

/** `r` resets hazards. Kept tiny on purpose. */
function wireKeyboard() {
  window.addEventListener('keydown', (ev) => {
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(ev.target?.tagName ?? '');
    if (typing) return;
    if ((ev.key === 'r' || ev.key === 'R') && !ev.metaKey && !ev.ctrlKey) {
      ev.preventDefault();
      document.getElementById('reset-btn')?.click();
    }
  });
}

main();
