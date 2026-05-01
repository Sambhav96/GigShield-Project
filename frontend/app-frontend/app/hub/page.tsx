"use client";

import { HubPageCrossfade } from "@/lib/motion/safeWrappers";
import { useEffect, useState } from "react";
import { fetchApi, riderPath, hubPath } from "@/lib/api/client";
import { HubMetricsResponse } from "@/lib/api/types";

export default function HubDashboard() {
  const [metrics, setMetrics] = useState<HubMetricsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [oracleMessage, setOracleMessage] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function load() {
      setIsLoading(true);
      setError(null);

      const res = await fetchApi<HubMetricsResponse>(hubPath("/hub/metrics"), { method: "GET" });
      if (!mounted) return;

      if (res.error || !res.data) {
        setError(res.error?.message || "Unable to load hub metrics");
        setMetrics({ active_riders: 0, open_incidents: 0, risk_quotient: 0, hub_name: "Hub Zone" });
      } else {
        setMetrics(res.data);
      }
      setIsLoading(false);
    }

    load();
    return () => {
      mounted = false;
    };
  }, []);

  const triggerOracle = () => {
    setOracleMessage("Risk oracle trigger is queued for internal rollout.");
    setTimeout(() => setOracleMessage(null), 2200);
  };

  return (
    <HubPageCrossfade>
      <div className="max-w-7xl mx-auto space-y-8">
        {isLoading && (
          <div className="fixed inset-0 z-[999] bg-[var(--color-hub-bg)] flex items-center justify-center">
            <span className="material-symbols-outlined animate-spin text-[var(--color-hub-secondary)] text-4xl">autorenew</span>
          </div>
        )}

        {error && (
          <div className="bg-[var(--color-hub-error)]/10 border border-[var(--color-hub-error)]/20 text-[var(--color-hub-error)] text-xs font-['DM_Sans'] rounded-lg px-4 py-3">
            {error}
          </div>
        )}

        {oracleMessage && (
          <div className="bg-[var(--color-hub-secondary)]/10 border border-[var(--color-hub-secondary)]/20 text-[var(--color-hub-secondary)] text-xs font-['DM_Sans'] rounded-lg px-4 py-3">
            {oracleMessage}
          </div>
        )}
        
        {/* Header Array */}
        <header className="flex justify-between items-end mb-12">
          <div>
            <h1 className="text-4xl font-['Syne'] font-black text-white tracking-tighter mb-2">Live Terminal</h1>
            <p className="text-[var(--color-hub-text)]/50 text-sm font-['DM_Sans']">System metrics and live fleet telemetry. {metrics?.hub_name || "Hub Zone"}</p>
          </div>
          <div className="flex gap-3">
            <button onClick={triggerOracle} className="bg-[var(--color-hub-secondary)] text-[#00210c] px-6 py-2.5 rounded-lg text-sm font-bold shadow-[0_0_20px_rgba(74,222,128,0.2)] active:scale-95 transition-transform">
              Action Risk Oracle
            </button>
          </div>
        </header>

        {/* Core KPIs - No-Line style */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-[var(--color-hub-surface-low)] rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <span className="text-[10px] font-['JetBrains_Mono'] text-[var(--color-hub-text)]/50 uppercase tracking-widest">Active Riders</span>
              <span className="material-symbols-outlined text-[var(--color-hub-secondary)] text-lg">two_wheeler</span>
            </div>
            <div className="flex items-end gap-3">
              <span className="text-4xl font-['Syne'] font-bold text-white">{Number(metrics?.active_riders || 0).toLocaleString("en-IN")}</span>
              <span className="text-sm font-medium text-[var(--color-hub-secondary)] mb-1 bg-[var(--color-hub-secondary)]/10 px-2 py-0.5 rounded">+12%</span>
            </div>
          </div>
          
          <div className="bg-[var(--color-hub-surface-low)] rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <span className="text-[10px] font-['JetBrains_Mono'] text-[var(--color-hub-text)]/50 uppercase tracking-widest">Open Incidents</span>
              <span className="material-symbols-outlined text-[var(--color-hub-error)] text-lg border border-[var(--color-hub-error)]/20 p-1 rounded">emergency</span>
            </div>
            <div className="flex items-end gap-3">
              <span className="text-4xl font-['Syne'] font-bold text-white">{Number(metrics?.open_incidents || 0).toLocaleString("en-IN")}</span>
              <span className="text-sm font-medium text-[var(--color-hub-error)] mb-1 bg-[var(--color-hub-error)]/10 px-2 py-0.5 rounded">3 Critical</span>
            </div>
          </div>

          <div className="bg-[var(--color-hub-surface-low)] rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <span className="text-[10px] font-['JetBrains_Mono'] text-[var(--color-hub-text)]/50 uppercase tracking-widest">Risk Quotient</span>
              <span className="material-symbols-outlined text-yellow-400 text-lg">public</span>
            </div>
            <div className="flex items-end gap-3">
              <span className="text-4xl font-['Syne'] font-bold text-white">{Number(metrics?.risk_quotient || 0).toFixed(2)}</span>
              <span className="text-sm font-medium text-yellow-400 mb-1">Band Moderate</span>
            </div>
          </div>
        </div>

        {/* System Health & Real-time Alerts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Subsystem Status */}
          <div className="bg-[var(--color-hub-surface-high)] border border-[var(--color-hub-surface-low)] rounded-3xl p-6 relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-32 h-32 bg-[var(--color-hub-secondary)]/10 blur-[40px] rounded-full pointer-events-none group-hover:bg-[var(--color-hub-secondary)]/20 transition-colors duration-700" />
            <div className="flex items-center justify-between mb-6 relative z-10">
              <h3 className="font-['Syne'] font-bold text-white text-lg">Subsystem Status</h3>
              <span className="text-[10px] font-['JetBrains_Mono'] text-[var(--color-hub-secondary)] bg-[var(--color-hub-secondary)]/10 px-2 py-1 rounded">ALL SYSTEMS NOMINAL</span>
            </div>
            
            <div className="space-y-4 relative z-10">
              {[
                { name: "Risk Oracle Sync", status: "Operational", ping: "12ms", color: "var(--color-hub-secondary)" },
                { name: "Payout Gateway", status: "Operational", ping: "45ms", color: "var(--color-hub-secondary)" },
                { name: "Fraud Detection Engine", status: "Degraded", ping: "120ms", color: "var(--color-hub-error)" },
                { name: "Telemetry Ingestion", status: "Operational", ping: "8ms", color: "var(--color-hub-secondary)" },
              ].map((sys, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 rounded-xl bg-[var(--color-hub-bg)]/50 border border-white/5 hover:border-white/10 transition-all hover:translate-x-1 cursor-default">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: sys.color }} />
                    <span className="font-['DM_Sans'] text-sm text-[var(--color-hub-text)]">{sys.name}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="font-['JetBrains_Mono'] text-xs" style={{ color: sys.color }}>{sys.status}</span>
                    <span className="font-['JetBrains_Mono'] text-[10px] text-[var(--color-hub-text)]/40 w-8 text-right">{sys.ping}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Environmental Anomalies */}
          <div className="bg-[var(--color-hub-surface-high)] border border-[var(--color-hub-surface-low)] rounded-3xl p-6 relative overflow-hidden group">
             <div className="absolute top-0 right-0 w-32 h-32 bg-yellow-500/10 blur-[40px] rounded-full pointer-events-none group-hover:bg-yellow-500/20 transition-colors duration-700" />
             <div className="flex items-center justify-between mb-6 relative z-10">
              <h3 className="font-['Syne'] font-bold text-white text-lg">Environmental Anomalies</h3>
              <span className="text-[10px] font-['JetBrains_Mono'] text-yellow-400 bg-yellow-400/10 px-2 py-1 rounded flex items-center gap-1">
                <span className="material-symbols-outlined text-[10px] animate-spin-slow">radar</span>
                MONITORING
              </span>
            </div>
            
            <div className="space-y-4 relative z-10">
              {[
                { icon: "water_drop", title: "Heavy Rain Probability", desc: "Northern sector showing 65% probability in next 2 hours", severity: "medium", time: "10m ago" },
                { icon: "air", title: "AQI Spike Detected", desc: "PM2.5 levels exceeding safe thresholds near Hub Center", severity: "high", time: "Just now" },
                { icon: "thermostat", title: "Temperature Nominal", desc: "No heatwave warnings active for the current shift", severity: "low", time: "1h ago" },
              ].map((anomaly, idx) => (
                <div key={idx} className="flex gap-4 p-3 rounded-xl bg-[var(--color-hub-bg)]/50 border border-white/5 items-start hover:border-white/10 transition-colors cursor-default">
                  <div className={`p-2 rounded-lg shrink-0 ${anomaly.severity === 'high' ? 'bg-[var(--color-hub-error)]/10 text-[var(--color-hub-error)]' : anomaly.severity === 'medium' ? 'bg-yellow-400/10 text-yellow-400' : 'bg-[var(--color-hub-secondary)]/10 text-[var(--color-hub-secondary)]'}`}>
                    <span className="material-symbols-outlined text-sm">{anomaly.icon}</span>
                  </div>
                  <div className="flex-1">
                    <div className="flex justify-between items-center mb-1">
                      <h4 className="font-['DM_Sans'] text-sm text-white">{anomaly.title}</h4>
                      <span className="font-['JetBrains_Mono'] text-[9px] text-[var(--color-hub-text)]/50">{anomaly.time}</span>
                    </div>
                    <p className="font-['DM_Sans'] text-xs text-[var(--color-hub-text)]/70 leading-relaxed">{anomaly.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>
    </HubPageCrossfade>
  );
}
