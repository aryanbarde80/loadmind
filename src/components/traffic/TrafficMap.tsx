import { useEffect, useRef } from 'react';
import { engine } from '@/state/store';
import type { PacketEvent } from '@/types';

/**
 * Live traffic map.
 *
 * Rendered on a canvas rather than with DOM nodes: at 2,000 rps the DOM would
 * need thousands of animated elements per second, while the canvas handles the
 * same packet volume at 60fps with a few hundred draw calls.
 *
 * Layout:
 *   USERS ──▶ INTERNET ──▶ LOADMIND LB ──▶ SERVER POOL
 */

interface Particle {
  id: number;
  outcome: PacketEvent['outcome'];
  serverIndex: number;
  progress: number;
  speed: number;
  lane: number; // index of the client row it originates from
  offset: number; // vertical jitter
  size: number;
}

interface ServerBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Layout {
  width: number;
  height: number;
  clientX: number;
  clientRows: number[];
  internetX: number;
  lbX: number;
  lbY: number;
  lbW: number;
  lbH: number;
  serverX: number;
  serverW: number;
  boxes: ServerBox[];
}

const MAX_PARTICLES = 300;
const PACKET_LIFETIME = 1150; // ms

const COLORS = {
  success: '#22d3ee',
  error: '#fb5a7a',
  rejected: '#f59e0b',
  link: 'rgba(148,163,184,0.16)',
  linkActive: 'rgba(34,211,238,0.5)',
  text: '#94a3b8',
  textDim: '#64748b',
  textBright: '#e2e8f0',
};

export function TrafficMap({ onSelectServer }: { onSelectServer?: (id: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const layoutRef = useRef<Layout | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const lastPacketIdRef = useRef(0);
  const pulsesRef = useRef<{ x: number; y: number; t: number; color: string }[]>([]);
  const onSelectRef = useRef(onSelectServer);
  onSelectRef.current = onSelectServer;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let raf = 0;

    const computeLayout = (): Layout => {
      const servers = engine.servers;
      const count = Math.max(1, servers.length);
      const padding = 18;
      const serverW = Math.min(190, Math.max(120, width * 0.19));
      const serverX = width - padding - serverW;
      const lbW = Math.min(230, Math.max(150, width * 0.2));
      const lbX = serverX - lbW - Math.max(60, width * 0.11);
      const clientX = 46;
      const internetX = clientX + (lbX - clientX) * 0.52;

      const top = 46;
      const usable = height - top - 40;
      const rowH = Math.min(74, Math.max(38, usable / count - 8));
      const boxes: ServerBox[] = servers.map((server, i) => ({
        id: server.id,
        x: serverX,
        y: top + i * ((usable - rowH) / Math.max(1, count - 1) === 0 ? 0 : (usable - rowH) / Math.max(1, count - 1)) + i * 6,
        w: serverW,
        h: rowH,
      }));
      // Evenly distribute and centre the column.
      const totalH = count * rowH + (count - 1) * 8;
      const startY = top + Math.max(0, (usable - totalH) / 2);
      boxes.forEach((box, i) => {
        box.y = startY + i * (rowH + 8);
      });

      const clientRows: number[] = [];
      const rows = Math.min(6, Math.max(3, count + 1));
      for (let i = 0; i < rows; i++) clientRows.push(top + ((height - top - 40) * (i + 0.5)) / rows);

      return {
        width,
        height,
        clientX,
        clientRows,
        internetX,
        lbX,
        lbY: height / 2 - 52,
        lbW,
        lbH: 104,
        serverX,
        serverW,
        boxes,
      };
    };

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      width = parent.clientWidth;
      height = parent.clientHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      layoutRef.current = computeLayout();
    };

    const observer = new ResizeObserver(resize);
    if (canvas.parentElement) observer.observe(canvas.parentElement);
    resize();

    const spawn = (packet: PacketEvent) => {
      const layout = layoutRef.current;
      if (!layout) return;
      const servers = engine.servers;
      const serverIndex = packet.serverId ? servers.findIndex((s) => s.id === packet.serverId) : -1;
      const alive = particlesRef.current.length;
      // At very high rates, sample the stream so the canvas stays legible.
      if (alive > MAX_PARTICLES) return;
      particlesRef.current.push({
        id: packet.id,
        outcome: packet.outcome,
        serverIndex,
        progress: 0,
        speed: 1 / PACKET_LIFETIME,
        lane: Math.floor(Math.random() * layout.clientRows.length),
        offset: (Math.random() - 0.5) * 14,
        size: packet.outcome === 'success' ? 2.1 : 2.8,
      });
    };

    const pointOnPath = (p: Particle, t: number) => {
      const layout = layoutRef.current;
      if (!layout) return { x: 0, y: 0 };
      const startY = layout.clientRows[p.lane] ?? layout.height / 2;
      const box = p.serverIndex >= 0 ? layout.boxes[p.serverIndex] : undefined;
      const endY = box ? box.y + box.h / 2 : layout.height / 2;
      const endX = layout.serverX;
      const midY = layout.height / 2;

      if (t < 0.34) {
        const k = t / 0.34;
        return {
          x: layout.clientX + (layout.internetX - layout.clientX) * ease(k),
          y: startY + (midY - startY) * ease(k),
        };
      }
      if (t < 0.66) {
        const k = (t - 0.34) / 0.32;
        return {
          x: layout.internetX + (layout.lbX - layout.internetX) * k,
          y: midY,
        };
      }
      const k = (t - 0.66) / 0.34;
      return {
        x: layout.lbX + layout.lbW + (endX - (layout.lbX + layout.lbW)) * ease(k),
        y: midY + (endY - midY) * ease(k),
      };
    };

    const ease = (t: number) => t * t * (3 - 2 * t);

    let lastFrame = performance.now();
    const draw = (now: number) => {
      const dt = Math.min(64, now - lastFrame);
      lastFrame = now;
      const layout = layoutRef.current;
      if (!layout || width === 0) {
        raf = requestAnimationFrame(draw);
        return;
      }

      // 1. Pull new packets from the engine ---------------------------------
      const { packets, lastId } = engine.drainPackets(lastPacketIdRef.current);
      lastPacketIdRef.current = lastId;
      for (const packet of packets) spawn(packet);

      // 2. Background ---------------------------------------------------------
      ctx.clearRect(0, 0, width, height);
      drawGrid(ctx, width, height);

      // 3. Links --------------------------------------------------------------
      drawLinks(ctx, layout, now);

      // 4. Nodes --------------------------------------------------------------
      drawClients(ctx, layout, now);
      drawInternet(ctx, layout, now);
      drawLoadBalancer(ctx, layout, now);
      drawServers(ctx, layout, now);

      // 5. Particles ----------------------------------------------------------
      const particles = particlesRef.current;
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.progress += p.speed * dt;
        const t = p.progress;
        const pos = pointOnPath(p, t);
        const prev = pointOnPath(p, Math.max(0, t - p.speed * dt * 3));

        const color =
          p.outcome === 'success' ? COLORS.success : p.outcome === 'error' ? COLORS.error : COLORS.rejected;

        // Trail
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.28;
        ctx.lineWidth = p.size * 1.4;
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();

        // Head
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 8;
        ctx.shadowColor = color;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y + p.offset * 0.15, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        if (p.progress >= 1) {
          particles.splice(i, 1);
          if (p.serverIndex >= 0) {
            const box = layout.boxes[p.serverIndex];
            if (box) {
              pulsesRef.current.push({
                x: box.x - 2,
                y: box.y + box.h / 2,
                t: now,
                color,
              });
            }
          }
        }
      }

      // 6. Arrival pulses ------------------------------------------------------
      pulsesRef.current = pulsesRef.current.filter((pulse) => now - pulse.t < 520);
      for (const pulse of pulsesRef.current) {
        const age = (now - pulse.t) / 520;
        ctx.globalAlpha = (1 - age) * 0.7;
        ctx.strokeStyle = pulse.color;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(pulse.x, pulse.y, 4 + age * 16, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);

    const handleClick = (event: MouseEvent) => {
      const layout = layoutRef.current;
      if (!layout) return;
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const hit = layout.boxes.find((box) => x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h);
      if (hit && onSelectRef.current) onSelectRef.current(hit.id);
    };
    canvas.addEventListener('click', handleClick);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener('click', handleClick);
    };
  }, []);

  return (
    <div className="relative h-full w-full">
      <canvas ref={canvasRef} className="block h-full w-full cursor-pointer" />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Drawing helpers                                                             */
/* -------------------------------------------------------------------------- */

function drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.save();
  ctx.strokeStyle = 'rgba(148,163,184,0.045)';
  ctx.lineWidth = 1;
  const step = 34;
  for (let x = 0; x < width; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y < height; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawLinks(ctx: CanvasRenderingContext2D, layout: Layout, now: number) {
  const midY = layout.height / 2;
  ctx.save();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = COLORS.link;
  ctx.setLineDash([5, 7]);
  ctx.lineDashOffset = -((now / 26) % 1000);

  // clients → internet
  for (const row of layout.clientRows) {
    ctx.beginPath();
    ctx.moveTo(layout.clientX + 12, row);
    ctx.bezierCurveTo(
      layout.clientX + (layout.internetX - layout.clientX) * 0.5,
      row,
      layout.clientX + (layout.internetX - layout.clientX) * 0.5,
      midY,
      layout.internetX - 22,
      midY,
    );
    ctx.stroke();
  }

  // internet → LB
  ctx.beginPath();
  ctx.moveTo(layout.internetX + 22, midY);
  ctx.lineTo(layout.lbX, midY);
  ctx.stroke();

  // LB → servers
  for (const box of layout.boxes) {
    ctx.beginPath();
    ctx.moveTo(layout.lbX + layout.lbW, midY);
    ctx.bezierCurveTo(
      layout.lbX + layout.lbW + 40,
      midY,
      box.x - 40,
      box.y + box.h / 2,
      box.x - 2,
      box.y + box.h / 2,
    );
    ctx.stroke();
  }
  ctx.restore();
}

function drawClients(ctx: CanvasRenderingContext2D, layout: Layout, now: number) {
  ctx.save();
  ctx.font = '600 9px "JetBrains Mono", ui-monospace, monospace';
  ctx.fillStyle = COLORS.textDim;
  ctx.textAlign = 'center';
  ctx.fillText('USERS', layout.clientX, 26);

  layout.clientRows.forEach((row, i) => {
    const pulse = 0.5 + 0.5 * Math.sin(now / 420 + i);
    ctx.beginPath();
    ctx.arc(layout.clientX, row, 6, 0, Math.PI * 2);
    const grad = ctx.createRadialGradient(layout.clientX, row, 0, layout.clientX, row, 6);
    grad.addColorStop(0, `rgba(139,124,246,${0.55 + pulse * 0.35})`);
    grad.addColorStop(1, 'rgba(139,124,246,0.06)');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = `rgba(167,155,255,${0.4 + pulse * 0.4})`;
    ctx.lineWidth = 1;
    ctx.stroke();
  });
  ctx.restore();
}

function drawInternet(ctx: CanvasRenderingContext2D, layout: Layout, now: number) {
  const cx = layout.internetX;
  const cy = layout.height / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(now / 9000);
  ctx.strokeStyle = 'rgba(34,211,238,0.28)';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.ellipse(0, 0, 30, 12, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(0, 0, 30, 12, Math.PI / 3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(0, 0, 30, 12, -Math.PI / 3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.font = '600 9px "JetBrains Mono", ui-monospace, monospace';
  ctx.fillStyle = COLORS.textDim;
  ctx.textAlign = 'center';
  ctx.fillText('INTERNET', cx, cy + 30);
  ctx.restore();
}

function drawLoadBalancer(ctx: CanvasRenderingContext2D, layout: Layout, now: number) {
  const { lbX: x, lbY: y, lbW: w, lbH: h } = layout;
  const stats = engine.liteStats();
  const autopilot = stats.autopilot;
  const accent = autopilot ? '#8b7cf6' : '#22d3ee';

  ctx.save();
  // Glow
  const glow = ctx.createLinearGradient(x, y, x, y + h);
  glow.addColorStop(0, autopilot ? 'rgba(139,124,246,0.22)' : 'rgba(34,211,238,0.18)');
  glow.addColorStop(1, 'rgba(6,10,18,0.55)');
  roundRect(ctx, x, y, w, h, 14);
  ctx.fillStyle = glow;
  ctx.fill();

  ctx.shadowBlur = 24;
  ctx.shadowColor = autopilot ? 'rgba(139,124,246,0.45)' : 'rgba(34,211,238,0.4)';
  ctx.strokeStyle = autopilot ? 'rgba(139,124,246,0.6)' : 'rgba(34,211,238,0.55)';
  ctx.lineWidth = 1.2;
  roundRect(ctx, x, y, w, h, 14);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Title
  ctx.textAlign = 'center';
  ctx.font = '700 15px "Space Grotesk", Inter, sans-serif';
  ctx.fillStyle = '#f1f5f9';
  ctx.fillText('LOADMIND LB', x + w / 2, y + 26);

  // Algorithm
  ctx.font = '600 10.5px "JetBrains Mono", ui-monospace, monospace';
  ctx.fillStyle = accent;
  ctx.fillText(shorten(stats.algorithm.toUpperCase(), 22), x + w / 2, y + 45);

  // Throughput
  ctx.font = '700 20px "Space Grotesk", Inter, sans-serif';
  ctx.fillStyle = '#e2e8f0';
  ctx.fillText(`${stats.throughput.toFixed(0)}`, x + w / 2, y + 70);
  ctx.font = '500 9px "JetBrains Mono", ui-monospace, monospace';
  ctx.fillStyle = COLORS.textDim;
  ctx.fillText('REQ / SEC', x + w / 2, y + 82);

  // Autopilot indicator
  if (autopilot) {
    const pulse = 0.55 + 0.45 * Math.sin(now / 340);
    ctx.globalAlpha = pulse;
    roundRect(ctx, x + 12, y + h - 20, w - 24, 14, 7);
    ctx.fillStyle = 'rgba(139,124,246,0.18)';
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.font = '700 8.5px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillStyle = '#c3b9ff';
    ctx.fillText('AI AUTOPILOT ACTIVE', x + w / 2, y + h - 10);
  } else {
    ctx.font = '600 8.5px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillStyle = COLORS.textDim;
    ctx.fillText('MANUAL CONTROL', x + w / 2, y + h - 10);
  }

  ctx.restore();
}

function drawServers(ctx: CanvasRenderingContext2D, layout: Layout, now: number) {
  const servers = engine.servers;
  ctx.save();
  ctx.font = '600 9px "JetBrains Mono", ui-monospace, monospace';
  ctx.fillStyle = COLORS.textDim;
  ctx.textAlign = 'center';
  ctx.fillText('SERVER POOL', layout.serverX + layout.serverW / 2, 26);

  layout.boxes.forEach((box, index) => {
    const server = servers[index];
    if (!server) return;
    const statusColor =
      server.down ? '#fb5a7a' : server.status === 'warning' ? '#fbbf24' : '#34e5b0';

    roundRect(ctx, box.x, box.y, box.w, box.h, 10);
    ctx.fillStyle = server.down ? 'rgba(251,90,122,0.06)' : 'rgba(255,255,255,0.028)';
    ctx.fill();
    ctx.strokeStyle = server.down ? 'rgba(251,90,122,0.4)' : 'rgba(148,163,184,0.16)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Status light
    ctx.beginPath();
    ctx.arc(box.x + 14, box.y + 16, 3.4, 0, Math.PI * 2);
    ctx.fillStyle = statusColor;
    ctx.shadowBlur = 8;
    ctx.shadowColor = statusColor;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Name
    ctx.textAlign = 'left';
    ctx.font = '700 11px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillStyle = server.down ? '#94a3b8' : '#e2e8f0';
    ctx.fillText(server.name, box.x + 24, box.y + 20);

    // Weight chip
    ctx.textAlign = 'right';
    ctx.font = '600 8.5px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillStyle = COLORS.textDim;
    ctx.fillText(`w${server.weight}`, box.x + box.w - 10, box.y + 20);

    // CPU meter
    const meterY = box.y + 30;
    const meterW = box.w - 24;
    ctx.fillStyle = 'rgba(148,163,184,0.14)';
    roundRect(ctx, box.x + 12, meterY, meterW, 4, 2);
    ctx.fill();
    const cpuPct = Math.max(0, Math.min(1, server.cpu / 100));
    const cpuColor = server.cpu > 85 ? '#fb5a7a' : server.cpu > 65 ? '#fbbf24' : '#34e5b0';
    ctx.fillStyle = cpuColor;
    roundRect(ctx, box.x + 12, meterY, Math.max(2, meterW * cpuPct), 4, 2);
    ctx.fill();

    // Stats line
    ctx.textAlign = 'left';
    ctx.font = '500 9px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillStyle = COLORS.text;
    const line = server.down
      ? 'OFFLINE'
      : `${server.activeConnections} conn · ${server.ewmaLatencyMs.toFixed(0)}ms · ${server.rps.toFixed(0)} rps`;
    ctx.fillText(shorten(line, Math.floor(box.w / 5.2)), box.x + 12, box.y + box.h - 9);

    // Utilisation shimmer for saturated servers
    if (!server.down && server.utilization > 0.85) {
      ctx.globalAlpha = 0.25 + 0.25 * Math.sin(now / 200);
      roundRect(ctx, box.x, box.y, box.w, box.h, 10);
      ctx.strokeStyle = '#fb5a7a';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  });
  ctx.restore();
}

function shorten(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}
