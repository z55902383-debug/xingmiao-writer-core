import { tr } from "./i18n";
import { useEffect, useRef, useState } from "react";
import cytoscape, { type Core } from "cytoscape";
import type { Book, Character, TimelineEvent, TimelineSnapshot } from "./types";
import { Button } from "./ui";

export default function RelationshipGraph({
  book,
  snap,
  person,
  onPerson,
  onEdit,
  onCreate,
  onRelation,
  onEvent,
}: {
  book: Book;
  snap: TimelineSnapshot | null;
  person: string;
  onPerson: (id: string) => void;
  onEdit?: (c: Character) => void;
  onCreate?: () => void;
  onRelation: (from?: string, to?: string) => void;
  onEvent: (e: TimelineEvent) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    cy = useRef<Core | null>(null);
  const [selected, setSelected] = useState("");
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [plans, setPlans] = useState(false);
  const actions = useRef({ onEvent, linkFrom, onRelation, snap });
  actions.current = { onEvent, linkFrom, onRelation, snap };
  const relations = [
    ...(snap?.relations || []),
    ...(plans
      ? (snap?.events || []).filter(
          (e) => e.kind === "relation" && e.state === "planned",
        )
      : []),
  ];
  const people = book.characters.filter(c=>!c.introducedOrder || c.introducedOrder <= (snap?.cutoff ?? Number.MAX_SAFE_INTEGER)).filter(
    (c) =>
      !person ||
      c.id === person ||
      relations.some(
        (e) =>
          (e.characterId === person && e.targetId === c.id) ||
          (e.targetId === person && e.characterId === c.id),
      ),
  );
  const elements = [
    ...people.map((c) => ({
      data: {
        id: c.id,
        label: c.name,
        dead: (snap?.characters || []).some(
          (e) =>
            e.characterId === c.id &&
            e.attribute === "生存状态" &&
            /死亡|已故/.test(e.value),
        )
          ? 1
          : 0,
      },
    })),
    ...relations
      .filter(
        (e) =>
          people.some((c) => c.id === e.characterId) &&
          people.some((c) => c.id === e.targetId),
      )
      .map((e) => ({
        data: {
          id: e.id!,
          source: e.characterId,
          target: e.targetId,
          label: e.value.length > 18 ? e.value.slice(0, 18) + "…" : e.value,
          planned: e.state === "planned" ? 1 : 0,
        },
      })),
  ];
  const signature = JSON.stringify(elements);
  useEffect(() => {
    if (!host.current) return;
    const graph = cytoscape({
      container: host.current,
      elements: [],
      minZoom: 0.2,
      maxZoom: 3,
      wheelSensitivity: 0.25,
      style: [
        {
          selector: "node",
          style: {
            "background-color": "#a9ddc3",
            label: "data(label)",
            color: "#edf5ef",
            "font-size": 13,
            "text-valign": "bottom",
            "text-margin-y": 10,
            width: 48,
            height: 48,
            "border-width": 3,
            "border-color": "#365c49",
          },
        },
        {
          selector: "node[dead = 1]",
          style: { "background-color": "#927d83", "border-style": "dashed" },
        },
        {
          selector: "edge",
          style: {
            width: 2,
            "line-color": "#76ac91",
            "target-arrow-color": "#76ac91",
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
            label: "data(label)",
            color: "#d7e6dd",
            "font-size": 11,
            "text-background-color": "#19251f",
            "text-background-opacity": 1,
            "text-background-padding": "4px",
            "text-rotation": "autorotate",
          },
        },
        {
          selector: "edge[planned = 1]",
          style: {
            "line-style": "dashed",
            "line-color": "#d7b87b",
            "target-arrow-color": "#d7b87b",
            color: "#ead2a0",
          },
        },
        {
          selector: ":selected",
          style: {
            "border-color": "#f4dbac",
            "line-color": "#f4dbac",
            "target-arrow-color": "#f4dbac",
          },
        },
      ],
    });
    cy.current = graph;
    graph.on("dragfree", "node", () => {
      try {
        localStorage.setItem(
          "graph-layout:" + book.id,
          JSON.stringify(
            Object.fromEntries(
              graph.nodes().map((n) => [n.id(), n.position()]),
            ),
          ),
        );
      } catch {
        /* Layout is optional; story data remains in SQLite. */
      }
    });
    graph.on("tap", "node", (e) => {
      const id = e.target.id();
      setSelected(id);
      const a = actions.current;
      if (a.linkFrom !== null) {
        if (a.linkFrom && a.linkFrom !== id) {
          a.onRelation(a.linkFrom, id);
          setLinkFrom(null);
        } else setLinkFrom(id);
      }
    });
    graph.on("tap", "edge", (e) => {
      const event = actions.current.snap?.events.find(
        (event) => event.id === e.target.id(),
      );
      if (event) actions.current.onEvent(event);
    });
    const observer = new ResizeObserver(() => graph.resize());
    observer.observe(host.current);
    return () => {
      observer.disconnect();
      graph.destroy();
      cy.current = null;
    };
  }, []);
  useEffect(() => {
    const graph = cy.current;
    if (!graph) return;
    const positions = new Map<string, { x: number; y: number }>(
      graph.nodes().map((n) => [n.id(), n.position()]),
    );
    if (!positions.size) {
      try {
        const saved = JSON.parse(
          localStorage.getItem("graph-layout:" + book.id) || "{}",
        );
        Object.entries(saved).forEach(([id, p]) => {
          const pos = p as { x: number; y: number };
          if (Number.isFinite(pos?.x) && Number.isFinite(pos?.y))
            positions.set(id, pos);
        });
      } catch {}
    }
    graph.elements().remove();
    graph.add(elements);
    relations.forEach((e) => graph.getElementById(e.id!).scratch("event", e));
    graph.nodes().forEach((n) => {
      const p = positions.get(n.id());
      if (p) n.position(p);
    });
    if (
      !positions.size ||
      graph
        .nodes()
        .toArray()
        .some((n) => !positions.has(n.id()))
    ) {
      if (graph.nodes().length <= 4)
        graph.layout({ name: "circle", radius: 140, padding: 60 }).run();
      else
        graph
          .layout({
            name: "cose",
            animate: false,
            padding: 65,
            nodeRepulsion: () => 120000,
            idealEdgeLength: () => 160,
          })
          .run();
    } else graph.fit(undefined, 60);
    if (graph.zoom() > 1.3) {
      graph.zoom(1.3);
      graph.center();
    }
  }, [signature]);
  const chosen = book.characters.find((c) => c.id === selected);
  return (
    <div className="relationship-graph graph-workbench">
      <div className="graph-tools">
        <Button onClick={onCreate}>{tr("添加人物")}</Button>
        <Button onClick={() => onRelation(selected)}>{tr("添加关系")}</Button>
        <Button
          aria-pressed={linkFrom !== null}
          onClick={() => setLinkFrom(linkFrom === null ? "" : null)}
        >
          {linkFrom === null ? tr("点选连线") : tr("取消连线")}
        </Button>
        <Button
          onClick={() => {
            const g = cy.current;
            if (g) {
              g.fit(undefined, 60);
              if (g.zoom() > 1.3) {
                g.zoom(1.3);
                g.center();
              }
            }
          }}
        >{tr("适应画布")}</Button>
        <Button
          onClick={() =>
            cy.current?.layout({ name: "circle", padding: 70 }).run()
          }
        >{tr("环形排列")}</Button>
        <Button
          onClick={() =>
            cy.current
              ?.layout({
                name: "cose",
                animate: false,
                padding: 65,
                nodeRepulsion: () => 120000,
              })
              .run()
          }
        >{tr("自动整理")}</Button>
        <label>
          <input
            type="checkbox"
            checked={plans}
            onChange={(e) => setPlans(e.target.checked)}
          />{tr("显示计划关系")}</label>
      </div>
      <p className="graph-help">
        {linkFrom !== null
          ? linkFrom
            ? tr("再点击另一位人物，建立关系")
            : tr("依次点击两位人物，建立关系")
          : tr("拖动人物调整位置 · 滚轮缩放 · 点击人物查看档案 · 点击连线编辑关系")}
      </p>
      <div
        ref={host}
        className="cytoscape-canvas"
        role="img"
        aria-label={tr("可拖动缩放的人物关系图谱")}
      />
      {!people.length && (
        <div className="graph-empty">
          <b>{tr("从故事里的第一位人物开始")}</b>
          <p>{tr("添加人物，再把他们的关系连起来。")}</p>
          <Button onClick={onCreate}>{tr("添加人物")}</Button>
        </div>
      )}
      {chosen && (
        <div className="graph-selection">
          <b>{chosen.name}</b>
          <span>{chosen.role}</span>
          <Button onClick={() => onEdit?.(chosen)}>{tr("编辑人物档案")}</Button>
          <Button
            onClick={() => onPerson(person === chosen.id ? "" : chosen.id)}
          >{tr("聚焦关系")}</Button>
          <Button onClick={() => onRelation(chosen.id)}>{tr("为此人物添加关系")}</Button>
        </div>
      )}
      <details className="graph-accessible">
        <summary>{tr("人物与关系列表 ·")}{" "}{people.length}{" "}{tr("人 /")}{" "}{relations.length}{" "}{tr("条关系")}</summary>
        <div className="graph-person-list">
          {people.map((c) => (
            <Button
              key={c.id}
              onClick={() => {
                setSelected(c.id);
                cy.current?.center(cy.current.getElementById(c.id));
              }}
            >
              {c.name}
              <span className="node-status">
                {snap?.characters
                  .filter((e) => e.characterId === c.id)
                  .map((e) => e.value)
                  .join(" · ")}
              </span>
            </Button>
          ))}
        </div>
        {relations.map((e) => (
          <Button key={e.id} className="edge-label" onClick={() => onEvent(e)}>
            {book.characters.find((c) => c.id === e.characterId)?.name} →{" "}
            {book.characters.find((c) => c.id === e.targetId)?.name}：{e.value}
            {e.state === "planned" ? tr("（计划）") : ""}
          </Button>
        ))}
      </details>
    </div>
  );
}
