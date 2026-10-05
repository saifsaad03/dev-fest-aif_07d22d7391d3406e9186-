import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createGraph, edgeName, nodeName } from './graph.js';
import { parseBuilding } from './schema.js';
import { setLocale } from '../i18n/index.js';

const BUILDING_PATH = fileURLToPath(new URL('../../public/building.json', import.meta.url));
const building = parseBuilding(JSON.parse(readFileSync(BUILDING_PATH, 'utf8')));
const graph = createGraph(building);

describe('createGraph indexes', () => {
  it('indexes every node by id', () => {
    expect(graph.nodesById.size).toBe(building.nodes.length);
  });

  it('indexes every corridor by id', () => {
    expect(graph.edgesById.size).toBe(building.edges.length);
    for (const edge of building.edges) {
      expect(graph.edgesById.get(edge.id)).toBe(edge);
    }
  });

  it('keeps corridors undirected', () => {
    expect(graph.adjacency.get('room_101')[0]).toEqual({
      to: 'j_t1',
      cost: 4,
      edgeId: 'e_101_t1',
    });
  });
});

describe('nodeName', () => {
  it('uses the localised label', () => {
    setLocale('en');
    expect(nodeName(graph, 'room_101')).toBe('Room 101');
    expect(nodeName(graph, 'exit_a')).toBe('West Fire Exit');
  });

  it('switches with the locale', () => {
    setLocale('bn');
    expect(nodeName(graph, 'exit_a')).toBe('পশ্চিম অগ্নি-নির্গমন');
    setLocale('en');
  });

  it('falls back to the id for an unknown node', () => {
    expect(nodeName(graph, 'nope_999')).toBe('nope_999');
  });
});

describe('edgeName', () => {
  it('prefers the label supplied by building.json', () => {
    setLocale('en');
    expect(edgeName(graph, 'e_101_t1')).toBe('Room 101 doorway');
    expect(edgeName(graph, 'e_w_exit_a')).toBe('West Fire Exit passage');
  });

  it('localises corridor labels', () => {
    setLocale('bn');
    expect(edgeName(graph, 'e_101_t1')).toBe('কক্ষ ১০১-এর দরজা');
    setLocale('en');
  });

  it('names every corridor in the fixture', () => {
    for (const edge of building.edges) {
      expect(edgeName(graph, edge.id)).toBeTruthy();
      // No corridor may fall back to its raw id.
      expect(edgeName(graph, edge.id)).not.toBe(edge.id);
    }
  });

  it('derives a readable name when the data omits a label', () => {
    const bare = parseBuilding({
      bounds: { width: 100, height: 100 },
      initial_state: { start_node_id: 'a' },
      nodes: [
        { id: 'a', type: 'room', x: 0, y: 0, label: { en: 'Room A' } },
        { id: 'b', type: 'junction', x: 1, y: 0, label: { en: 'Junction B' } },
      ],
      edges: [{ id: 'ab', from: 'a', to: 'b', cost: 3 }],
    });
    expect(edgeName(createGraph(bare), 'ab')).toBe('Room A → Junction B');
  });

  it('falls back to the id for an unknown corridor', () => {
    expect(edgeName(graph, 'nope')).toBe('nope');
  });
});

describe('parseBuilding corridor labels', () => {
  it('normalises a plain string label into both locales', () => {
    const parsed = parseBuilding({
      bounds: { width: 100, height: 100 },
      initial_state: { start_node_id: 'a' },
      nodes: [
        { id: 'a', type: 'room', x: 0, y: 0 },
        { id: 'b', type: 'junction', x: 1, y: 0 },
      ],
      edges: [{ id: 'ab', from: 'a', to: 'b', cost: 1, label: 'Side hall' }],
    });
    expect(parsed.edges[0].labels).toEqual({ en: 'Side hall', bn: 'Side hall' });
  });

  it('leaves labels null when absent so the UI can derive one', () => {
    const parsed = parseBuilding({
      bounds: { width: 100, height: 100 },
      initial_state: { start_node_id: 'a' },
      nodes: [
        { id: 'a', type: 'room', x: 0, y: 0 },
        { id: 'b', type: 'junction', x: 1, y: 0 },
      ],
      edges: [{ id: 'ab', from: 'a', to: 'b', cost: 1 }],
    });
    expect(parsed.edges[0].labels).toBeNull();
  });
});