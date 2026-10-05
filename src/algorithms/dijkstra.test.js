import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { bruteForceRoute, compareNodeSequences, findRoute } from './dijkstra.js';
import { parseBuilding, ValidationError } from '../core/schema.js';

/**
 * The shipped fixture, read from disk. Reading the real file (instead of
 * inlining a copy) means these tests fail if building.json drifts - a second
 * inlined copy would happily keep passing while the app was broken.
 */
const BUILDING_PATH = fileURLToPath(new URL('../../public/building.json', import.meta.url));
const building = parseBuilding(JSON.parse(readFileSync(BUILDING_PATH, 'utf8')));

const run = (overrides = {}) =>
  findRoute({ building, startNodeId: building.initialState.startNodeId, ...overrides });

/**
 * Symmetric diamond where BOTH exits cost exactly 2, so the winner is decided
 * purely by the lexicographic exit-id rule:
 *   a -> b -> exit_a   (2)
 *   a -> c -> exit_b   (2)
 */
const DIAMOND = {
  bounds: { width: 100, height: 100 },
  initial_state: { start_node_id: 'a' },
  nodes: [
    { id: 'a', type: 'room', x: 0, y: 0 },
    { id: 'b', type: 'junction', x: 1, y: 0 },
    { id: 'c', type: 'junction', x: 2, y: 0 },
    { id: 'exit_a', type: 'exit', x: 3, y: 0 },
    { id: 'exit_b', type: 'exit', x: 4, y: 0 },
  ],
  edges: [
    { id: 'ab', from: 'a', to: 'b', cost: 1 },
    { id: 'b_exit_a', from: 'b', to: 'exit_a', cost: 1 },
    { id: 'ac', from: 'a', to: 'c', cost: 1 },
    { id: 'c_exit_b', from: 'c', to: 'exit_b', cost: 1 },
  ],
};

const runDiamond = (overrides = {}) =>
  findRoute({ building: DIAMOND, startNodeId: 'a', ...overrides });

describe('compareNodeSequences', () => {
  it('orders by the first differing element', () => {
    expect(compareNodeSequences(['a', 'z'], ['b', 'a'])).toBeLessThan(0);
    expect(compareNodeSequences(['b'], ['a', 'z'])).toBeGreaterThan(0);
  });

  it('treats a proper prefix as smaller', () => {
    expect(compareNodeSequences(['a'], ['a', 'b'])).toBeLessThan(0);
  });

  it('returns 0 for identical sequences', () => {
    expect(compareNodeSequences(['a', 'b'], ['a', 'b'])).toBe(0);
  });
});

describe('findRoute on the shipped building', () => {
  it('resolves the baseline scenario', () => {
    const result = run();
    expect(result.status).toBe('ok');
    // room_102 -> j_t2 -> j_c2 -> j_c1 -> j_w -> exit_a
    // ...-> j_c3 -> j_e -> exit_b also costs 33, so this is a genuine tie
    // resolved by the lexicographic exit-id rule.
    expect(result.route.cost).toBe(33);
    expect(result.route.nodeIds).toEqual(['room_102', 'j_t2', 'j_c2', 'j_c1', 'j_w', 'exit_a']);
    expect(result.route.exitId).toBe('exit_a');
  });

  it('has a genuine cost tie in the baseline, decided by exit id', () => {
    const result = run();
    const exitB = findRoute({
      building,
      startNodeId: building.initialState.startNodeId,
      closedExits: new Set(['exit_a']),
    });
    expect(result.route.cost).toBe(exitB.route.cost);
    expect(result.route.exitId).toBe('exit_a');
    expect(exitB.route.exitId).toBe('exit_b');
  });

  it('falls back to exit_c when both horizontal corridors are severed', () => {
    // exit_a is reachable only through j_w; exit_b only through j_e.
    const result = run({
      blockedEdges: new Set(['e_w_c1', 'e_w_exit_a', 'e_c3_e', 'e_e_exit_b']),
    });
    expect(result.status).toBe('ok');
    expect(result.route.exitId).toBe('exit_c');
    expect(result.route.cost).toBe(34);
  });

  it('reports no_route once every exit is shut', () => {
    const result = run({ closedExits: new Set(['exit_a', 'exit_b', 'exit_c']) });
    expect(result.status).toBe('no_route');
    expect(result.route).toBeNull();
  });

  it('reports start_blocked when the occupant is inside a blocked room', () => {
    const result = run({ blockedNodes: new Set(['room_102']) });
    expect(result.status).toBe('start_blocked');
    expect(result.route).toBeNull();
  });

  it('agrees with brute force on 200 randomised hazard sets', () => {
    const nodeIds = building.nodes.map((n) => n.id);
    const edgeIds = building.edges.map((e) => e.id);
    const exitIds = building.nodes.filter((n) => n.type === 'exit').map((n) => n.id);

    // Deterministic LCG so any failure is reproducible.
    let seed = 12345;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

    let compared = 0;
    for (let trial = 0; trial < 200; trial += 1) {
      const blockedNodes = new Set(nodeIds.filter(() => rand() < 0.15));
      const blockedEdges = new Set(edgeIds.filter(() => rand() < 0.15));
      const closedExits = new Set(exitIds.filter(() => rand() < 0.3));
      if (blockedNodes.has(building.initialState.startNodeId)) continue;

      const params = {
        building,
        startNodeId: building.initialState.startNodeId,
        blockedNodes,
        blockedEdges,
        closedExits,
      };
      const fast = findRoute(params);
      const slow = bruteForceRoute(params);
      compared += 1;

      if (!slow) {
        expect(fast.status).toBe('no_route');
        continue;
      }
      expect(fast.status).toBe('ok');
      expect(fast.route.cost).toBe(slow.cost);
      expect(fast.route.exitId).toBe(slow.exitId);
      expect(fast.route.nodeIds).toEqual(slow.nodeIds);
    }
    expect(compared).toBeGreaterThan(100);
  });
});

describe('findRoute tie-breaking', () => {
  it('breaks a cost tie on exit id, not discovery order', () => {
    const result = runDiamond();
    expect(result.route.cost).toBe(2);
    expect(result.route.exitId).toBe('exit_a');
  });

  it('breaks an exit-id tie on the node sequence', () => {
    // Two equal-cost routes to the SAME exit: smallest sequence must win.
    const tie = {
      bounds: { width: 10, height: 10 },
      initial_state: { start_node_id: 's' },
      nodes: [
        { id: 's', type: 'room', x: 0, y: 0 },
        { id: 'm', type: 'junction', x: 1, y: 0 },
        { id: 'exit_a', type: 'exit', x: 2, y: 0 },
      ],
      edges: [
        { id: 'sm', from: 's', to: 'm', cost: 2 },
        { id: 's_exit', from: 's', to: 'exit_a', cost: 2 },
      ],
    };
    const result = findRoute({ building: tie, startNodeId: 's' });
    // ['s','exit_a'] is a prefix of ['s','m','exit_a'] and compares smaller.
    expect(result.route.nodeIds).toEqual(['s', 'exit_a']);
  });

  it('picks the smaller intermediate node id when costs tie', () => {
    const tie = {
      bounds: { width: 10, height: 10 },
      initial_state: { start_node_id: 's' },
      nodes: [
        { id: 's', type: 'room', x: 0, y: 0 },
        { id: 'm_high', type: 'junction', x: 1, y: 0 },
        { id: 'm_low', type: 'junction', x: 2, y: 0 },
        { id: 'exit_a', type: 'exit', x: 3, y: 0 },
      ],
      edges: [
        { id: 's_high', from: 's', to: 'm_high', cost: 1 },
        { id: 's_low', from: 's', to: 'm_low', cost: 1 },
        { id: 'high_exit', from: 'm_high', to: 'exit_a', cost: 1 },
        { id: 'low_exit', from: 'm_low', to: 'exit_a', cost: 1 },
      ],
    };
    const result = findRoute({ building: tie, startNodeId: 's' });
    expect(result.route.cost).toBe(2);
    // 'm_high' < 'm_low' under plain code-unit comparison, despite the names.
    expect(result.route.nodeIds).toEqual(['s', 'm_high', 'exit_a']);
  });
});

describe('findRoute hazard handling', () => {
  it('reroutes around a blocked edge', () => {
    const result = runDiamond({ blockedEdges: new Set(['b_exit_a']) });
    expect(result.status).toBe('ok');
    expect(result.route.exitId).toBe('exit_b');
  });

  it('reroutes around a blocked node', () => {
    const result = runDiamond({ blockedNodes: new Set(['b']) });
    expect(result.status).toBe('ok');
    expect(result.route.nodeIds).toEqual(['a', 'c', 'exit_b']);
  });

  it('reroutes when the cheapest exit is closed', () => {
    expect(runDiamond({ closedExits: new Set(['exit_a']) }).route.exitId).toBe('exit_b');
    expect(runDiamond({ closedExits: new Set(['exit_b']) }).route.exitId).toBe('exit_a');
  });

  it('never routes through a closed exit', () => {
    const result = runDiamond({ closedExits: new Set(['exit_b']) });
    expect(result.route.nodeIds).not.toContain('exit_b');
  });

  it('reports no_route when every exit is cut off', () => {
    const result = runDiamond({ blockedEdges: new Set(['b_exit_a', 'c_exit_b']) });
    expect(result.status).toBe('no_route');
  });

  it('reports start_blocked when the start node is blocked', () => {
    const result = runDiamond({ blockedNodes: new Set(['a']) });
    expect(result.status).toBe('start_blocked');
    expect(result.route).toBeNull();
  });

  it('reports unknown_start for a missing node id', () => {
    const result = findRoute({ building: DIAMOND, startNodeId: 'nope' });
    expect(result.status).toBe('unknown_start');
  });

  it('treats the graph as undirected', () => {
    const line = {
      bounds: { width: 10, height: 10 },
      initial_state: { start_node_id: 'deep' },
      nodes: [
        { id: 'deep', type: 'room', x: 0, y: 0 },
        { id: 'exit_a', type: 'exit', x: 1, y: 0 },
      ],
      edges: [{ id: 'e', from: 'exit_a', to: 'deep', cost: 3 }],
    };
    const result = findRoute({ building: line, startNodeId: 'deep' });
    expect(result.route.nodeIds).toEqual(['deep', 'exit_a']);
  });

  it('handles a zero-cost corridor without looping', () => {
    const free = {
      bounds: { width: 10, height: 10 },
      initial_state: { start_node_id: 'a' },
      nodes: [
        { id: 'a', type: 'room', x: 0, y: 0 },
        { id: 'b', type: 'junction', x: 1, y: 0 },
        { id: 'exit_a', type: 'exit', x: 2, y: 0 },
      ],
      edges: [
        { id: 'ab', from: 'a', to: 'b', cost: 0 },
        { id: 'ba', from: 'b', to: 'exit_a', cost: 0 },
      ],
    };
    const result = findRoute({ building: free, startNodeId: 'a' });
    expect(result.status).toBe('ok');
    expect(result.route.cost).toBe(0);
  });
});

describe('parseBuilding', () => {
  const valid = {
    bounds: { width: 10, height: 10 },
    initial_state: { start_node_id: 'a' },
    nodes: [
      { id: 'a', type: 'room', x: 0, y: 0 },
      { id: 'exit_a', type: 'exit', x: 1, y: 1 },
    ],
    edges: [{ id: 'e', from: 'a', to: 'exit_a', cost: 2 }],
  };

  const parse = (obj) => parseBuilding(obj);

  /** Assert that parsing throws a ValidationError whose issue list matches. */
  const expectIssues = (obj, pattern) => {
    let thrown;
    try {
      parse(obj);
    } catch (err) {
      thrown = err;
    }
    expect(thrown, 'expected a ValidationError').toBeInstanceOf(ValidationError);
    expect(thrown.format()).toMatch(pattern);
  };

  it('accepts a minimal valid building', () => {
    const parsed = parse(valid);
    expect(parsed.nodes).toHaveLength(2);
    expect(parsed.initialState.startNodeId).toBe('a');
  });

  it('expands a plain-string label into both locales', () => {
    const parsed = parse({
      ...valid,
      nodes: [{ id: 'a', type: 'room', x: 0, y: 0, label: 'Lobby' }, valid.nodes[1]],
    });
    expect(parsed.nodes[0].labels).toEqual({ en: 'Lobby', bn: 'Lobby' });
  });

  it('defaults a missing node type to junction', () => {
    const parsed = parse({ ...valid, nodes: [{ id: 'a', x: 0, y: 0 }, valid.nodes[1]] });
    expect(parsed.nodes[0].type).toBe('junction');
  });

  it('rejects duplicate node ids', () => {
    expectIssues({ ...valid, nodes: [...valid.nodes, { id: 'a', type: 'room', x: 2, y: 2 }] }, /duplicate node id "a"/);
  });

  it('rejects an edge pointing at an unknown node', () => {
    expectIssues({ ...valid, edges: [{ id: 'e', from: 'a', to: 'ghost', cost: 1 }] }, /unknown node "ghost"/);
  });

  it('rejects a non-positive or non-integer cost', () => {
    expectIssues({ ...valid, edges: [{ id: 'e', from: 'a', to: 'exit_a', cost: -3 }] }, /cost must be a positive integer/);
    expectIssues({ ...valid, edges: [{ id: 'e', from: 'a', to: 'exit_a', cost: 1.5 }] }, /cost must be a positive integer/);
  });

  it('rejects a non-numeric coordinate', () => {
    expectIssues(
      { ...valid, nodes: [{ id: 'a', type: 'room', x: 'left', y: 0 }, valid.nodes[1]] },
      /x and y must be finite numbers/,
    );
  });

  it('accepts a building with no exits so routing can report no_route', () => {
    const noExit = {
      ...valid,
      nodes: [
        { id: 'a', type: 'room', x: 0, y: 0 },
        { id: 'b', type: 'junction', x: 1, y: 1 },
      ],
      edges: [{ id: 'ab', from: 'a', to: 'b', cost: 1 }],
    };
    expect(findRoute({ building: parse(noExit), startNodeId: 'a' }).status).toBe('no_route');
  });

  it('rejects a closed_exit that is not an exit', () => {
    expectIssues(
      { ...valid, initial_state: { ...valid.initial_state, closed_exits: ['a'] } },
      /"a" is not an exit/,
    );
  });

  it('rejects an unknown start node', () => {
    expectIssues(
      { ...valid, initial_state: { start_node_id: 'ghost' } },
      /unknown node "ghost"/,
    );
  });

  it('rejects a non-object root', () => {
    expectIssues([], /root must be a JSON object/);
  });

  it('synthesises edge ids when they are omitted', () => {
    const parsed = parse({ ...valid, edges: [{ from: 'a', to: 'exit_a', cost: 2 }] });
    expect(parsed.edges[0].id).toMatch(/^edge_/);
  });

  it('collects every issue in one pass instead of failing on the first', () => {
    const broken = {
      ...valid,
      edges: [
        { id: 'e1', from: 'a', to: 'ghost', cost: 1 },
        { id: 'e2', from: 'a', to: 'exit_a', cost: -1 },
      ],
    };
    let thrown;
    try {
      parse(broken);
    } catch (err) {
      thrown = err;
    }
    expect(thrown.issues.length).toBeGreaterThanOrEqual(2);
  });

  it('parses the shipped fixture without warnings', () => {
    expect(building.initialState.startNodeId).toBe('room_102');
    expect(building.nodes.filter((n) => n.type === 'exit')).toHaveLength(3);
    expect(building.scenarios.length).toBeGreaterThan(0);
  });

  it('ships scenarios whose hazards all resolve to known ids', () => {
    for (const scenario of building.scenarios) {
      for (const id of scenario.state.blockedNodes) {
        expect(building.nodes.some((n) => n.id === id), `${scenario.id}: node ${id}`).toBe(true);
      }
      for (const id of scenario.state.blockedEdges) {
        expect(building.edges.some((e) => e.id === id), `${scenario.id}: edge ${id}`).toBe(true);
      }
      for (const id of scenario.state.closedExits) {
        expect(building.nodes.some((n) => n.id === id && n.type === 'exit'), `${scenario.id}: exit ${id}`).toBe(true);
      }
    }
  });
});
