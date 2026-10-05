# Smart Escape
Live link https://emevacuation.netlify.app/
**Interactive Evacuation Route Simulator** — close a room, block a corridor or shut an exit, and watch the safest route to safety recalculate instantly.

A DevFest challenge project. Vanilla JavaScript + Vite, no UI framework.

---

## Features

- **Live rerouting** — every change to the building recomputes the route from your current start point.
- **Selectable graph** — rooms, junctions, exits *and* corridors are all inspectable, not just rooms.
- **Real corridor names** — all 23 corridors carry genuine bilingual labels (e.g. *"North-central connector (middle)"*), so the map reads like a real floor plan instead of `j_t1 → j_t2`.
- **English / বাংলা** — the entire UI, every map label and the route readout switch language instantly.
- **Readable route** — a step-by-step list of named places, not raw node ids.
- **No dead ends** — clear status messaging for no route, blocked start, and closed exits.
- **Responsive** — one layout for phones, tablets and desktops; the legend stays beside the map on desktop and above it on mobile.
- **Keyboard friendly** — press <kbd>R</kbd> to reset all hazards.

## Quick start

Requires **Node.js 18+**.

```bash
git clone https://github.com/saifsaad03/dev-fest-aif_07d22d7391d3406e9186-.git
cd dev-fest-aif_07d22d7391d3406e9186-
npm install
npm run dev
```



| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload on port 5173 |
| `npm run build` | Production bundle into `dist/` |
| `npm run preview` | Serve the built bundle locally |
| `npm test` | Run the test suite once (Vitest) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run lint` | Lint with ESLint 9 |

## How it works

The building is modelled as a weighted graph, and evacuation is a shortest-path problem over it.

- **Nodes** — `room`, `junction` and `exit`. The shipped floor plan has 20 nodes (6 rooms, 11 junctions, 3 exits).
- **Edges** — 23 corridors, each with a travel cost and a bilingual label.
- **Routing** — Dijkstra's algorithm from your start node to every reachable exit, then the cheapest exit wins.

### Tie-breaking contract

Two routes to the same place are ranked in a fixed, documented order:

1. **Minimum total cost.**
2. **Lexicographically smallest exit id** — plain `<` on the raw string (UTF-16 code-unit order, deliberately *not* locale-aware so results are identical on every machine).
3. **Lexicographically smallest node sequence** — element by element; the shorter array wins if one is a prefix of the other.

Because array comparison is prefix-preserving (`A < B` implies `A.concat(x) < B.concat(x)`), the total order is monotone under path extension and a settled node can never be improved — so this stays correct Dijkstra, not a heuristic.

### Why recompute on every change

Routing is cheap at this graph size, so the app recomputes the whole route on every state change and reads the settled result back before painting. That removes an entire class of "stale route" bugs for no measurable cost.

## Project structure

```
index.html               Entry point and app shell
src/
  main.js                Wiring: load → derive → paint
  core/
    schema.js            Validates building.json and throws a readable ValidationError
    graph.js             Builds adjacency, name/label lookups
    store.js             Observable state (start, blocked, closed, selection, locale)
  algorithms/
    dijkstra.js          findRoute() + bruteForceRoute() cross-check
    dijkstra.test.js     36 tests, including brute-force agreement
  render/
    mapRenderer.js       Interactive SVG map
  ui/
    sidebar.js           Control cards
    statusBar.js         Status line, metrics and header wiring
  i18n/                  Locale state and English/Bengali strings
public/
  building.json          The floor plan: nodes, edges, scenarios
  favicon.svg
```

## The floor plan data

Everything lives in [`public/building.json`](public/building.json) — swap this file to simulate a different building.

```jsonc
{
  "meta": { "id": "devfest-hq", "name": { "en": "…", "bn": "…" }, "level": "L2" },
  "bounds": { "width": 1200, "height": 760 },
  "initial_state": { "start_node_id": "room_102", "blocked_nodes": [], … },
  "nodes": [ /* { id, type, position, label } */ ],
  "edges": [ /* { id, from, to, cost, label } */ ],
  "scenarios": [ /* { id, label, state } */ ]
}
```

The file also carries four prepared **scenarios** — `baseline`, `close_north`, `corridor_cut` and `trap`. The scenario card is not shown in the current UI, but `applyScenario()` and the data are still there if you want to wire it back up.

## Accessibility

- Every control is a real focusable `<button>` or form element with a label.
- The SVG map has a translated `aria-label` and stays keyboard reachable.
- Touch targets are enlarged to 42px+ on coarse-pointer devices, and corridor hit areas are widened for fingers.
- All content is exposed in the accessibility tree, including cards that are visually repositioned on small screens.

## Testing

```bash
npm test
```

49 tests across two files. The Dijkstra suite includes an exhaustive brute-force cross-check that enumerates every simple path and asserts the heap-based implementation agrees — this is what guards the tie-breaking rules above.

## License

MIT © 2026 saif_saad — see [LICENSE](LICENSE).
