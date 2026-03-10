import type { GraphEdge, GraphNode } from "./types.js";

type Neighbor = {
  nodeId: number;
  distance: number;
  accessible: boolean;
};

type PathResult = {
  distance: number;
  nodeIds: number[];
};

const buildAdjacencyList = (edges: GraphEdge[]): Map<number, Neighbor[]> => {
  const adjacency = new Map<number, Neighbor[]>();

  for (const edge of edges) {
    if (!adjacency.has(edge.fromNodeId)) {
      adjacency.set(edge.fromNodeId, []);
    }
    if (!adjacency.has(edge.toNodeId)) {
      adjacency.set(edge.toNodeId, []);
    }

    adjacency.get(edge.fromNodeId)?.push({
      nodeId: edge.toNodeId,
      distance: edge.distance,
      accessible: edge.accessible,
    });
    adjacency.get(edge.toNodeId)?.push({
      nodeId: edge.fromNodeId,
      distance: edge.distance,
      accessible: edge.accessible,
    });
  }

  return adjacency;
};

export const findShortestPath = (
  nodes: GraphNode[],
  edges: GraphEdge[],
  startNodeId: number,
  targetNodeId: number,
  accessibilityOnly = false,
): PathResult | null => {
  const nodeIds = new Set(nodes.map((node) => node.id));
  if (!nodeIds.has(startNodeId) || !nodeIds.has(targetNodeId)) {
    return null;
  }

  const adjacency = buildAdjacencyList(edges);
  const distances = new Map<number, number>();
  const previous = new Map<number, number | null>();
  const unvisited = new Set<number>(nodeIds);

  for (const nodeId of unvisited) {
    distances.set(nodeId, Number.POSITIVE_INFINITY);
    previous.set(nodeId, null);
  }
  distances.set(startNodeId, 0);

  while (unvisited.size > 0) {
    let currentNode: number | null = null;
    let currentDistance = Number.POSITIVE_INFINITY;

    for (const nodeId of unvisited) {
      const candidateDistance = distances.get(nodeId) ?? Number.POSITIVE_INFINITY;
      if (candidateDistance < currentDistance) {
        currentDistance = candidateDistance;
        currentNode = nodeId;
      }
    }

    if (currentNode === null || currentDistance === Number.POSITIVE_INFINITY) {
      break;
    }

    unvisited.delete(currentNode);

    if (currentNode === targetNodeId) {
      break;
    }

    const neighbors = adjacency.get(currentNode) ?? [];
    for (const neighbor of neighbors) {
      if (!unvisited.has(neighbor.nodeId)) {
        continue;
      }
      if (accessibilityOnly && !neighbor.accessible) {
        continue;
      }

      const alternative = currentDistance + neighbor.distance;
      if (alternative < (distances.get(neighbor.nodeId) ?? Number.POSITIVE_INFINITY)) {
        distances.set(neighbor.nodeId, alternative);
        previous.set(neighbor.nodeId, currentNode);
      }
    }
  }

  const distance = distances.get(targetNodeId) ?? Number.POSITIVE_INFINITY;
  if (distance === Number.POSITIVE_INFINITY) {
    return null;
  }

  const path: number[] = [];
  let current: number | null = targetNodeId;

  while (current !== null) {
    path.unshift(current);
    current = previous.get(current) ?? null;
  }

  if (path[0] !== startNodeId) {
    return null;
  }

  return {
    distance,
    nodeIds: path,
  };
};
