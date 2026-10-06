import { Play, Pause, RotateCcw, Zap, Save, Shuffle, Gauge } from 'lucide-react';
import { useApp } from '@/state/store';
import { Panel, Slider, Segmented, Toggle } from '@/components/ui/primitives';
import { PATTERN_META } from '@/simulation/trafficModel';
import { clsx } from '@/lib/clsx';
import type { TrafficPattern } from '@/types';

const PATTERNS: TrafficPattern[] = ['normal', 'steady', 'spike', 'wave', 'random', 'flash-crowd'];

export function TrafficSimulatorPanel() {
  const snapshot = useApp((s) => s.snapshot);
  const setConfig = useApp((s) => s.setConfig);
  const start = useApp((s) => s.start);
  const pause = useApp((s) => s.pause);
  const toggleRunning = useApp((s) => s.toggleRunning);
  const resetSimulation = useApp((s) => s.resetSimulation);
  const triggerBurst = useApp((s) => s.triggerBurst);
  const saveLiveRun = useApp((s) => s.saveLiveRun);

  const config = snapshot.config;
  const patternMeta = PATTERN_META[config.pattern];

  return (
    <Panel
      eyebrow="Traffic simulator"
      title="Traffic generator"
      icon={<Gauge className="h-3.5 w-3.5" />}
      actions={
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={toggleRunning}
            className={clsx('btn px-2.5 py-1 text-[12px]', snapshot.running ? '' : 'btn-primary')}
          >
            {snapshot.running ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {snapshot.running ? 'Pause' : 'Start'}
          </button>
          <button type="button" onClick={resetSimulation} className="btn btn-ghost px-2 py-1" title="Reset simulation">
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Run controls */}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn justify-center text-[12px]" onClick={() => (snapshot.running ? pause() : start())}>
            {snapshot.running ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {snapshot.running ? 'Pause simulation' : 'Start simulation'}
          </button>
          <button type="button" className="btn justify-center text-[12px]" onClick={saveLiveRun}>
            <Save className="h-3.5 w-3.5" /> Save run
          </button>
        </div>

        <Slider
          label="Requests / sec"
          value={config.baseRps}
          min={20}
          max={3000}
          step={10}
          onChange={(baseRps) => setConfig({ baseRps })}
          format={(v) => `${v} rps`}
        />

        <Slider
          label="Servers in pool"
          value={config.serverCount}
          min={2}
          max={12}
          step={1}
          onChange={(serverCount) => setConfig({ serverCount })}
          format={(v) => `${v} nodes`}
        />

        {/* Pattern */}
        <div>
          <div className="label">Traffic pattern</div>
          <div className="grid grid-cols-3 gap-1.5">
            {PATTERNS.map((pattern) => {
              const meta = PATTERN_META[pattern];
              const active = config.pattern === pattern;
              return (
                <button
                  key={pattern}
                  type="button"
                  onClick={() => setConfig({ pattern })}
                  className={clsx(
                    'rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition',
                    active
                      ? 'border-transparent text-void-950'
                      : 'border-white/[0.08] bg-white/[0.02] text-slate-400 hover:border-white/20 hover:text-slate-200',
                  )}
                  style={active ? { background: meta.color, boxShadow: `0 8px 24px -12px ${meta.color}` } : undefined}
                >
                  {meta.label}
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-[11px] leading-snug text-slate-500">{patternMeta.description}</p>
        </div>

        {/* Burst */}
        <div className="rounded-xl border border-white/[0.06] bg-black/25 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="eyebrow">Request burst</span>
            <button type="button" className="btn btn-primary px-2 py-1 text-[11px]" onClick={triggerBurst}>
              <Zap className="h-3 w-3" /> Inject burst
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Slider
              label="Multiplier"
              value={config.burstMultiplier}
              min={1.5}
              max={10}
              step={0.5}
              accent="amber"
              onChange={(burstMultiplier) => setConfig({ burstMultiplier })}
              format={(v) => `${v.toFixed(1)}×`}
            />
            <Slider
              label="Duration"
              value={config.burstDurationSec}
              min={1}
              max={20}
              step={1}
              accent="amber"
              onChange={(burstDurationSec) => setConfig({ burstDurationSec })}
              format={(v) => `${v}s`}
            />
          </div>
        </div>

        {/* Sim speed + options */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="label mb-1.5">Sim speed</div>
            <Segmented
              size="sm"
              value={String(config.speed)}
              onChange={(v) => setConfig({ speed: Number(v) })}
              options={[
                { value: '0.5', label: '0.5×' },
                { value: '1', label: '1×' },
                { value: '2', label: '2×' },
                { value: '4', label: '4×' },
              ]}
            />
          </div>
          <button
            type="button"
            className="btn btn-ghost px-2 py-1 text-[11px]"
            onClick={() => setConfig({ seed: Math.floor(Math.random() * 1e9) })}
            title="Reseed the RNG (restarts the run with new servers and traffic)"
          >
            <Shuffle className="h-3 w-3" /> Reseed
          </button>
        </div>

        <Toggle
          checked={config.retryOnFailure}
          onChange={(retryOnFailure) => setConfig({ retryOnFailure })}
          size="sm"
          label="Retry on upstream failure"
          description="Re-dispatch to the least-loaded live server when the chosen one is down."
        />

        <div className="grid grid-cols-3 gap-2 border-t border-white/[0.06] pt-3">
          <Readout
            label="Live rate"
            value={`${snapshot.metrics.arrivalRate.toFixed(0)}`}
            unit={`rps · ${(snapshot.trafficMultiplier || 1).toFixed(2)}×`}
          />
          <Readout label="In flight" value={String(snapshot.inFlight)} />
          <Readout label="Sim clock" value={`${snapshot.simTime.toFixed(0)}s`} />
        </div>
      </div>
    </Panel>
  );
}

function Readout({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-black/25 px-2.5 py-2">
      <div className="eyebrow">{label}</div>
      <div className="num mt-0.5 font-display text-[15px] font-semibold text-slate-100">
        {value}
        {unit && <span className="ml-1 text-[10px] font-normal text-slate-500">{unit}</span>}
      </div>
    </div>
  );
}
