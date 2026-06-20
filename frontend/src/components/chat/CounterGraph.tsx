import { useMemo, useState } from 'react';
import { GraphCanvas, darkTheme, lightTheme } from 'reagraph';
import type { GraphNode as ReagraphNode, GraphEdge as ReagraphEdge } from 'reagraph';
import type { CounterReport, ClaimVerdict } from '../../types';

// Claims are nodes (colored by their own-truth verdict); inference edges are the
// directed moves between them (colored/dashed by whether the evidence licenses the
// move). Rendered as a force-directed graph — see the layout note below for why not
// a top-down tree.
const VERDICT_FILL: Record<ClaimVerdict, string> = {
  contradicted: '#ef4444', // red-500
  weakened: '#f59e0b',     // amber-500
  stands: '#10b981',       // emerald-500
};
const UNVERIFIABLE_FILL = '#a1a1aa'; // zinc-400
const LICENSED_FILL = '#10b981';
const UNWARRANTED_FILL = '#f59e0b';

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function isDark(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
}

export default function CounterGraph({ report }: { report: CounterReport }) {
  const [selected, setSelected] = useState<number | null>(null);

  const { nodes, edges } = useMemo(() => {
    const nodes: ReagraphNode[] = report.counterClaims.map((c, i) => ({
      id: String(i),
      label: `${i + 1}. ${truncate(c.claim, 30)}`,
      fill: c.unverifiable ? UNVERIFIABLE_FILL : VERDICT_FILL[c.verdict],
      data: { index: i },
    }));
    const edges: ReagraphEdge[] = (report.edges ?? []).map((e, i) => ({
      id: `edge-${i}`,
      source: String(e.from),
      target: String(e.to),
      label: e.move,
      fill: e.licensed ? LICENSED_FILL : UNWARRANTED_FILL,
      dashed: !e.licensed,
    }));
    return { nodes, edges };
  }, [report]);

  const selectedClaim = selected !== null ? report.counterClaims[selected] : null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-zinc-500">
        <LegendDot color={VERDICT_FILL.stands} label="stands" />
        <LegendDot color={VERDICT_FILL.weakened} label="weakened" />
        <LegendDot color={VERDICT_FILL.contradicted} label="contradicted" />
        <LegendDot color={UNVERIFIABLE_FILL} label="unverifiable" />
        <span className="text-zinc-300 dark:text-zinc-600">|</span>
        <LegendLine color={LICENSED_FILL} label="licensed" />
        <LegendLine color={UNWARRANTED_FILL} label="unwarranted" dashed />
      </div>

      <div
        className="rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden relative bg-white dark:bg-zinc-900"
        style={{ height: 380, width: '100%' }}
      >
        <div style={{ position: 'absolute', inset: 0 }}>
          {/* reagraph's hierarchical/tree layouts use d3-hierarchy.stratify(), which
              throws on convergent DAGs (any node with >1 parent — e.g. several claims
              feeding one recommendation), rendering an empty scene. forceDirected2d
              handles arbitrary graphs; arrows preserve direction, drag lets you untangle. */}
          <GraphCanvas
            nodes={nodes}
            edges={edges}
            layoutType="forceDirected2d"
            edgeArrowPosition="end"
            labelType="all"
            draggable
            theme={isDark() ? darkTheme : lightTheme}
            onNodeClick={(n) => setSelected((n.data as { index?: number })?.index ?? null)}
            onCanvasClick={() => setSelected(null)}
          />
        </div>
      </div>

      {selectedClaim && (
        <div className="text-[11px] bg-zinc-100 dark:bg-zinc-800 rounded px-2 py-1.5">
          <span className="font-semibold text-zinc-400 mr-1">[{(selected ?? 0) + 1}]</span>
          {selectedClaim.claim}
          {selectedClaim.rationale && (
            <div className="text-zinc-500 dark:text-zinc-400 mt-0.5">{selectedClaim.rationale}</div>
          )}
        </div>
      )}
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function LegendLine({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="flex items-center gap-1">
      <span className="inline-block w-3" style={{ borderTop: `2px ${dashed ? 'dashed' : 'solid'} ${color}` }} />
      {label}
    </span>
  );
}
