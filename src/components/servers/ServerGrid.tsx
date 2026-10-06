import { useApp } from '@/state/store';
import { ServerCard } from './ServerCard';
import { Panel } from '@/components/ui/primitives';
import { Server } from 'lucide-react';

export function ServerGrid({ compact = false }: { compact?: boolean }) {
  const snapshot = useApp((s) => s.snapshot);
  const selectedServerId = useApp((s) => s.selectedServerId);
  const selectServer = useApp((s) => s.selectServer);

  const total = snapshot.distribution.reduce((a, d) => a + d.count, 0) || 1;

  return (
    <Panel
      eyebrow="Server pool"
      title="Backend fleet"
      icon={<Server className="h-3.5 w-3.5" />}
      actions={
        <div className="flex items-center gap-2 font-mono text-[10.5px] text-slate-500">
          <span>
            <span className="text-neon-mint">{snapshot.metrics.healthyCount}</span> healthy
          </span>
          <span className="text-slate-700">·</span>
          <span>
            <span className="text-neon-amber">{snapshot.metrics.warningCount}</span> warning
          </span>
          <span className="text-slate-700">·</span>
          <span>
            <span className="text-neon-rose">{snapshot.metrics.downCount}</span> down
          </span>
        </div>
      }
      className="min-h-0"
      bodyClassName="overflow-y-auto"
    >
      <div
        className={
          compact
            ? 'grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3'
            : 'grid grid-cols-1 gap-2.5 lg:grid-cols-2 2xl:grid-cols-3'
        }
      >
        {snapshot.servers.map((server) => {
          const bucket = snapshot.distribution.find((d) => d.serverId === server.id);
          return (
            <ServerCard
              key={server.id}
              server={server}
              share={bucket ? bucket.count / total : 0}
              selected={selectedServerId === server.id}
              onSelect={() => selectServer(selectedServerId === server.id ? null : server.id)}
              compact={compact}
              version={snapshot.simTime}
            />
          );
        })}
      </div>
    </Panel>
  );
}
