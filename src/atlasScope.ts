import type { Book } from './types';
import type { AtlasProjection } from './atlasModel';

/** Select scope after resolving time, and resolve a person's latest position before
 * filtering geography. Otherwise someone who left a city still appears in it. */
export function atlasScope(projection: AtlasProjection, mapId: string, descendants = true, onlyChapter = false, includeMentioned = false) {
  const mapIds = new Set<string>();
  if (!mapId) projection.maps.forEach(map => mapIds.add(map.id));
  else {
    mapIds.add(mapId);
    if (descendants) {
      let changed = true;
      while (changed) {
        changed = false;
        for (const map of projection.maps) if (map.parentMapId && mapIds.has(map.parentMapId) && !mapIds.has(map.id)) { mapIds.add(map.id); changed = true; }
      }
    }
  }
  const nodes = projection.nodes.filter(node => mapIds.has(node.mapId));
  const nodeIds = new Set(nodes.map(node => node.id));
  const latest = new Map<string, typeof projection.positions[number]>();
  const mentioned: typeof projection.positions = [];
  for (const position of projection.positions) {
    if (position.status === 'mentioned') { if (includeMentioned) mentioned.push(position); continue; }
    if (position.state === 'planned') continue;
    const before = latest.get(position.characterId);
    if (!before || position.sourceOrder >= before.sourceOrder) latest.set(position.characterId, position);
  }
  const positions = [...latest.values(), ...mentioned].filter(position => position.state !== 'stale' && nodeIds.has(position.nodeId) && (!onlyChapter || position.chapterId === projection.chapterId));
  const people = new Set(positions.map(position => position.characterId));
  // A known holder does not imply an item's location: include it only by an
  // explicit node, or show an unlocated item beside its local holder as unknown.
  const items = projection.items.filter(item => (item.nodeId ? nodeIds.has(item.nodeId) : people.has(item.ownerCharacterId)) && (!onlyChapter || item.chapterId === projection.chapterId));
  return { mapIds, nodes, nodeIds, positions, people, items };
}

export function scopePeople(book: Book, ids: Set<string>, query = '') {
  const term = query.trim().toLocaleLowerCase();
  return book.characters.filter(person => ids.has(person.id) && (!term || `${person.name} ${person.role}`.toLocaleLowerCase().includes(term)));
}
