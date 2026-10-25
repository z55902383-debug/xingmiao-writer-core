import { useEffect, useId, useState } from 'react';
import { api } from './api';
import { tr } from './i18n';
import type { Book, TimelineSnapshot } from './types';
import type { AtlasProjection } from './atlasModel';
import { atlasScope, scopePeople } from './atlasScope';

export default function AtlasScopeView({ book, projection, mapId, descendants, onlyChapter, mode, query, onMap, onNode, onItem }: {
  book: Book; projection: AtlasProjection; mapId: string; descendants: boolean; onlyChapter: boolean;
  mode: 'overview' | 'people' | 'items'; query: string;
  onMap: (id: string) => void; onNode: (id: string) => void; onItem: (id: string) => void;
}) {
  const [snapshot, setSnapshot] = useState<TimelineSnapshot | null>(null);
  const [error, setError] = useState('');
  const [includeMentioned, setIncludeMentioned] = useState(false);
  const marker = useId().replace(/:/g, '') + '-scope-arrow';
  useEffect(() => {
    let active = true;
    setSnapshot(null); setError('');
    if (mode === 'people') void api<TimelineSnapshot>('timeline:preview', { bookId: book.id, chapterId: projection.chapterId }).then(value => { if (active) setSnapshot(value); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [book.id, book.timeline, book.chapters, projection.chapterId, mode]);
  const scope = atlasScope(projection, mapId, descendants, onlyChapter, includeMentioned);
  const term = query.trim().toLocaleLowerCase();
  const people = scopePeople(book, scope.people, query);
  const personIds = new Set(people.map(person => person.id));
  const relations = (snapshot?.relations || []).filter(row => personIds.has(row.characterId) && personIds.has(row.targetId));
  const maps = projection.maps.filter(map => !map.parentMapId || !projection.maps.some(parent => parent.id === map.parentMapId)).filter(map => !term || map.name.toLocaleLowerCase().includes(term));
  const items = scope.items.filter(item => !term || `${item.name} ${item.description}`.toLocaleLowerCase().includes(term));
  const itemStatus = (state:string)=>state==='planned'?tr('计划'):state==='stale'?tr('待复核'):state==='provisional'?tr('待确认'):'';
  const rows = mode === 'overview' ? maps.map(map => ({ id: map.id, title: map.name, subtitle: `${projection.maps.filter(child => child.parentMapId === map.id).length} ${tr('下级地图')}`, action: () => onMap(map.id) }))
    : mode === 'people' ? people.map(person => {
      const position = scope.positions.find(row => row.characterId === person.id);
      const node = projection.nodes.find(row => row.id === position?.nodeId);
      return { id: person.id, title: person.name, subtitle: `${node?.name || tr('未定位')} · ${position?.status === 'mentioned' ? tr('提及') : tr('最后位置记录')}`, action: () => { if (node) onNode(node.id); } };
    }) : items.map(item => ({ id: item.id, title: item.name, subtitle: `${itemStatus(item.state)} ${item.ownerCharacterId ? book.characters.find(person => person.id === item.ownerCharacterId)?.name || tr('未知') : tr('无明确归属')} · ${projection.nodes.find(node => node.id === item.nodeId)?.name || tr('未定位')}`, action: () => onItem(item.id) }));
  const centers = new Map(rows.map((row, index) => [row.id, { x: 170 + index % 3 * 330, y: 100 + Math.floor(index / 3) * 160 }]));
  return <div className="ka-scope-view" data-scope-view={mode}>
    <div className="ka-scope-caption"><strong>{mode === 'overview' ? tr('全书世界') : mode === 'people' ? tr('当前范围人物') : tr('当前范围物品')} · {rows.length}</strong>
      {mode === 'people' && <label><input type="checkbox" checked={includeMentioned} onChange={e => setIncludeMentioned(e.target.checked)} />{tr('包含提及人物')}</label>}
    </div>
    {mode === 'people' && <p className="ka-scope-note">{tr('只连接当前范围内双方均有位置记录的人物；位置为最后记录，不代表本章仍在场。')}</p>}
    {error && <p role="alert">{tr('关系读取失败，切换视图后可重试。')} {error}</p>}
    {mode === 'people' && !snapshot && !error && <p role="status">{tr('正在读取当前章节关系…')}</p>}
    {!rows.length ? <div className="ka-scope-empty"><strong>{tr('当前范围暂无对应资料')}</strong><p>{tr('可返回上一级、扩大范围，或在地点详情中补充人物位置与物品。')}</p></div> : <>
      <svg className="ka-scope-svg" viewBox={`0 0 1000 ${Math.max(300, Math.ceil(rows.length / 3) * 160 + 40)}`} role="group" aria-label={mode === 'overview' ? tr('世界地图入口') : mode === 'people' ? tr('范围人物关系图') : tr('范围物品归属图')}>
        <defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 10 5 0 10Z" fill="currentColor" /></marker></defs>
        {relations.map((relation, index) => {
          const from = centers.get(relation.characterId), to = centers.get(relation.targetId);
          if (!from || !to) return null;
          const label = relation.value.length > 18 ? relation.value.slice(0, 18) + '…' : relation.value;
          return <g className="ka-scope-relation" key={relation.id || index}><title>{relation.value}</title><path d={`M${from.x} ${from.y} Q${(from.x + to.x) / 2} ${Math.min(from.y, to.y) - 80 - index % 3 * 18} ${to.x} ${to.y}`} markerEnd={`url(#${marker})`} /><text x={(from.x + to.x) / 2} y={Math.min(from.y, to.y) - 44 - index % 3 * 9} textAnchor="middle">{label}</text></g>;
        })}
        {rows.map(row => { const point = centers.get(row.id)!; return <g className="ka-scope-entity" key={row.id} transform={`translate(${point.x} ${point.y})`} role="button" tabIndex={0} aria-label={row.title} onClick={row.action} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); row.action(); } }}><title>{row.title} · {row.subtitle}</title><rect x={-135} y={-38} width={270} height={86} rx={10} /><text textAnchor="middle" y={-4}>{row.title.length > 10 ? row.title.slice(0, 10) + '…' : row.title}</text><text className="ka-scope-subtitle" textAnchor="middle" y={23}>{row.subtitle.length > 14 ? row.subtitle.slice(0, 14) + '…' : row.subtitle}</text></g>; })}
      </svg>
      {mode === 'people' && relations.length > 0 && <details className="ka-scope-relations"><summary>{tr('查看完整关系说明')} · {relations.length}</summary>{relations.map((relation, i) => <p key={relation.id || i}>{book.characters.find(p => p.id === relation.characterId)?.name} → {book.characters.find(p => p.id === relation.targetId)?.name}：{relation.value}</p>)}</details>}
    </>}
  </div>;
}
