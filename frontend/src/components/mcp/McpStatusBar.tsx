import { useMcpStore } from '../../stores/mcpStore';

interface Props {
  onClick: () => void;
}

export default function McpStatusBar({ onClick }: Props) {
  const servers = useMcpStore((s) => s.servers);

  const connectedCount = servers.filter((s) => s.status === 'connected').length;
  const errorCount = servers.filter((s) => s.status === 'error').length;
  const total = servers.length;

  let statusColor = 'bg-zinc-400';
  if (total > 0) {
    if (connectedCount === total) {
      statusColor = 'bg-emerald-500';
    } else if (errorCount === total) {
      statusColor = 'bg-red-500';
    } else if (connectedCount > 0) {
      statusColor = 'bg-amber-500';
    }
  }

  return (
    <button
      onClick={onClick}
      className="px-3 py-2 border-t border-zinc-200 dark:border-zinc-800 flex items-center gap-2 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors duration-150 w-full"
    >
      <div className={`w-2 h-2 rounded-full ${statusColor}`} />
      <span>
        {connectedCount} MCP server{connectedCount !== 1 ? 's' : ''}
      </span>
    </button>
  );
}
