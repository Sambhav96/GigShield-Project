"use client";

import { AdminInstantLoad } from "@/lib/motion/safeWrappers";
import { useEffect, useState, useCallback } from "react";
import { fetchApi, adminPath } from "@/lib/api/client";
import { AdminDashboardResponse } from "@/lib/api/types";

// ── Sparkline mini chart ──────────────────────────────────────────────────────
function Sparkline({ values, color = "#00ff88", height = 32 }: { values: number[]; color?: string; height?: number }) {
  if (!values.length) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const w = 80; const h = height;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - min) / range) * h}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="opacity-60">
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={pts} />
      <circle cx={(values.length - 1) / (values.length - 1) * w} cy={h - ((values[values.length - 1] - min) / range) * h} r="2" fill={color} />
    </svg>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KPICard({ title, value, sub, trend, color = "primary", icon, sparkData }: {
  title: string; value: string; sub?: string; trend?: string; color?: string;
  icon: string; sparkData?: number[];
}) {
  const colors: Record<string, string> = {
    primary: "var(--color-admin-primary)", error: "var(--color-admin-error)",
    warning: "#f59e0b", success: "#10b981", purple: "#a78bfa",
  };
  const c = colors[color] || colors.primary;
  return (
    <div className="bg-[var(--color-admin-surface)] border border-[var(--color-admin-outline)]/20 p-5 flex flex-col gap-3 hover:border-[var(--color-admin-outline)]/40 transition-colors">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-['JetBrains_Mono'] text-[var(--color-admin-text)]/50 uppercase tracking-widest">{title}</span>
        <span className="material-symbols-outlined text-base" style={{ color: c }}>{icon}</span>
      </div>
      <div className="flex items-end justify-between">
        <div>
          <div className="text-2xl font-['Inter'] font-black text-white">{value}</div>
          {sub && <div className="text-[10px] font-['JetBrains_Mono'] mt-1" style={{ color: c }}>{sub}</div>}
          {trend && <div className="text-[10px] font-['JetBrains_Mono'] text-[var(--color-admin-text)]/40 mt-0.5">{trend}</div>}
        </div>
        {sparkData && <Sparkline values={sparkData} color={c} />}
      </div>
    </div>
  );
}



// ── Audit Log Row ─────────────────────────────────────────────────────────────
function AuditRow({ log }: { log: any }) {
  const actionColors: Record<string, string> = {
    kill_switch: "text-[var(--color-admin-error)]", god_mode_trigger: "text-yellow-400",
    ml_retrain: "text-[var(--color-admin-primary)]", experiment_change: "text-purple-400",
    approve: "text-[#10b981]", reject: "text-[var(--color-admin-error)]",
  };
  const color = actionColors[log.action] || "text-[var(--color-admin-text)]/50";
  const ts = log.performed_at ? new Date(log.performed_at).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" }) : "--";
  return (
    <div className="flex items-center gap-3 py-2 border-b border-[var(--color-admin-outline)]/10 text-[10px] font-['JetBrains_Mono'] last:border-0">
      <span className="text-[var(--color-admin-text)]/30 w-28 shrink-0">{ts}</span>
      <span className={`font-bold uppercase ${color}`}>{log.action || log.action_type}</span>
      <span className="text-[var(--color-admin-text)]/50 truncate">{log.entity_type || ""} {log.entity_id ? `· ${String(log.entity_id).slice(0,8)}` : ""}</span>
    </div>
  );
}



export default function AdminOverview() {
  const [dashboard, setDashboard] = useState<any | null>(null);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [killSwitchLoading, setKillSwitchLoading] = useState(false);
  const [godModeOpen, setGodModeOpen] = useState(false);
  const [godModeForm, setGodModeForm] = useState({ trigger_type: "rain", oracle_score: "0.85", hub_id: "", duration: "1.0" });
  const [godModeResult, setGodModeResult] = useState<any>(null);
  const [godModeLoading, setGodModeLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const load = useCallback(async () => {
    const dashRes = await fetchApi<any>(adminPath("/admin/dashboard"), { method: "GET" });
    if (dashRes.data) setDashboard(dashRes.data);
    if (dashRes.error) setError(dashRes.error.message);
    setIsLoading(false);
    setLastRefresh(new Date());

    const logsRes = await fetchApi<{ logs: any[] }>(adminPath("/admin/audit-logs?limit=10"), { method: "GET" });
    if (logsRes.data?.logs) setAuditLogs(logsRes.data.logs);
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load]);

  const toggleKillSwitch = async () => {
    const newVal = ks === "off" ? "full" : "off";
    if (!confirm(`Are you sure you want to turn the kill switch ${newVal.toUpperCase()}?\n\nThis will ${newVal === "full" ? "cancel all active triggers and stop the system." : "resume normal operations."}`)) return;
    
    setKillSwitchLoading(true);
    await fetchApi(adminPath("/admin/dashboard/kill-switch"), {
      method: "POST",
      body: JSON.stringify({ value: newVal, confirm: "CONFIRM", reason: "admin_action_toggle" }),
    });
    setKillSwitchLoading(false);
    load();
  };

  const fireGodMode = async () => {
    setGodModeLoading(true);
    setGodModeResult(null);
    const res = await fetchApi<any>(adminPath("/admin/god-mode/trigger"), {
      method: "POST",
      body: JSON.stringify({
        trigger_type: godModeForm.trigger_type,
        oracle_score: parseFloat(godModeForm.oracle_score),
        duration: parseFloat(godModeForm.duration),
        hub_id: godModeForm.hub_id || undefined,
      }),
    });
    setGodModeResult(res.data || { error: res.error?.message || 'Failed to connect to backend' });
    setGodModeLoading(false);
    setTimeout(load, 2000);
  };

  const setKillSwitch = async (value: string) => {
    if (!confirm(`Set kill switch to "${value}"?`)) return;
    setKillSwitchLoading(true);
    await fetchApi(adminPath("/admin/dashboard/kill-switch"), {
      method: "POST",
      body: JSON.stringify({ value, confirm: "CONFIRM", reason: "admin_action" }),
    });
    setKillSwitchLoading(false);
    load();
  };

  const kpis = dashboard?.kpis || {};
  const cb = dashboard?.circuit_breakers || {};
  const apiB = dashboard?.api_budget || {};
  const mlM = dashboard?.ml_model || {};
  const ks = dashboard?.kill_switch || "off";

  // Generate synthetic sparkline data for visual richness
  const mockSparkPayouts = [12, 18, 9, 24, 31, 19, 28, 35, 22, 40].map(v => v * ((kpis.payouts_today_inr || 1000) / 400));
  const mockSparkPolicies = [80, 82, 85, 88, 90, 87, 92, 94, 96, kpis.active_policies || 96];
  const mockSparkLR = [0.55, 0.60, 0.58, 0.62, 0.57, 0.59, 0.61, 0.58, 0.60, kpis.loss_ratio_7d || 0.60];

  return (
    <AdminInstantLoad>
      <div className="space-y-6 pb-8">
        {/* ── Header ── */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-['Inter'] font-black text-white tracking-tight">Mission Control</h1>
            <p className="text-[11px] font-['JetBrains_Mono'] text-[var(--color-admin-text)]/40 mt-0.5">
              {lastRefresh ? `Last sync: ${lastRefresh.toLocaleTimeString("en-IN")} · Auto-refresh 30s` : "Loading..."}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Kill Switch Toggle */}
            <button onClick={toggleKillSwitch} disabled={killSwitchLoading}
              className={`flex items-center gap-2 px-3 py-1.5 border text-[10px] font-['JetBrains_Mono'] font-bold uppercase transition-colors disabled:opacity-50 hover:bg-white/5 ${
              ks === "off" ? "border-[var(--color-admin-primary)]/30 text-[var(--color-admin-primary)]" :
              "border-[var(--color-admin-error)]/50 text-[var(--color-admin-error)] bg-[var(--color-admin-error)]/10 animate-pulse"
            }`}>
              <div className={`w-1.5 h-1.5 rounded-full ${ks === "off" ? "bg-[var(--color-admin-primary)]" : "bg-[var(--color-admin-error)]"}`} />
              KILL_SWITCH: {ks.toUpperCase()}
            </button>
            <button onClick={() => setGodModeOpen(!godModeOpen)}
              className="px-4 py-1.5 border border-yellow-500/40 bg-yellow-500/5 text-yellow-400 text-[10px] font-['JetBrains_Mono'] font-bold uppercase tracking-widest hover:bg-yellow-500/10 transition-colors">
              ⚡ GOD_MODE
            </button>
            <button onClick={load} className="px-3 py-1.5 border border-[var(--color-admin-outline)]/30 text-[var(--color-admin-text)]/50 text-[10px] font-['JetBrains_Mono'] hover:border-[var(--color-admin-outline)]/60 transition-colors">
              SYNC
            </button>
          </div>
        </div>

        {/* ── God Mode Panel ── */}
        {godModeOpen && (
          <div className="border border-yellow-500/30 bg-yellow-500/5 p-5 space-y-4">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-yellow-400">bolt</span>
              <h3 className="text-sm font-['JetBrains_Mono'] font-bold text-yellow-400 uppercase tracking-widest">God Mode — Force Synthetic Trigger</h3>
              <span className="text-[9px] font-['JetBrains_Mono'] text-yellow-500/60">For investor demos only. Marks trigger as is_synthetic=true.</span>
            </div>
            <div className="grid grid-cols-4 gap-3">
              <div>
                <label className="text-[9px] font-['JetBrains_Mono'] text-yellow-500/60 uppercase block mb-1">Trigger Type</label>
                <select value={godModeForm.trigger_type} onChange={e => setGodModeForm(f => ({ ...f, trigger_type: e.target.value }))}
                  className="w-full bg-[var(--color-admin-bg)] border border-yellow-500/30 px-3 py-2 text-xs font-['JetBrains_Mono'] text-white focus:outline-none focus:border-yellow-400">
                  {["rain","flood","heat","aqi","bandh","platform_down"].map(t => (
                    <option key={t} value={t}>{t.toUpperCase()}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[9px] font-['JetBrains_Mono'] text-yellow-500/60 uppercase block mb-1">Oracle Score (0.0–1.0)</label>
                <input value={godModeForm.oracle_score} onChange={e => setGodModeForm(f => ({ ...f, oracle_score: e.target.value }))}
                  type="number" step="0.05" min="0" max="1"
                  className="w-full bg-[var(--color-admin-bg)] border border-yellow-500/30 px-3 py-2 text-xs font-['JetBrains_Mono'] text-white focus:outline-none focus:border-yellow-400" />
              </div>
              <div>
                <label className="text-[9px] font-['JetBrains_Mono'] text-yellow-500/60 uppercase block mb-1">Duration (Hours)</label>
                <input value={godModeForm.duration} onChange={e => setGodModeForm(f => ({ ...f, duration: e.target.value }))}
                  type="number" step="0.5" min="0.5" max="24"
                  className="w-full bg-[var(--color-admin-bg)] border border-yellow-500/30 px-3 py-2 text-xs font-['JetBrains_Mono'] text-white focus:outline-none focus:border-yellow-400" />
              </div>
              <div>
                <label className="text-[9px] font-['JetBrains_Mono'] text-yellow-500/60 uppercase block mb-1">Hub ID (blank=auto)</label>
                <input value={godModeForm.hub_id} onChange={e => setGodModeForm(f => ({ ...f, hub_id: e.target.value }))}
                  placeholder="UUID or blank"
                  className="w-full bg-[var(--color-admin-bg)] border border-yellow-500/30 px-3 py-2 text-xs font-['JetBrains_Mono'] text-white focus:outline-none focus:border-yellow-400 placeholder:text-white/20" />
              </div>
            </div>
            <div className="flex items-center gap-4">
              <button onClick={fireGodMode} disabled={godModeLoading}
                className="px-6 py-2 bg-yellow-500/10 border border-yellow-500/40 text-yellow-400 text-xs font-['JetBrains_Mono'] font-bold uppercase hover:bg-yellow-500/20 disabled:opacity-50 transition-colors">
                {godModeLoading ? "FIRING..." : "🚀 FIRE TRIGGER + QUEUE CLAIMS"}
              </button>
              {godModeResult && (
                <div className={`text-[10px] font-['JetBrains_Mono'] ${(godModeResult.error || godModeResult.status === 'error') ? "text-[var(--color-admin-error)]" : "text-[var(--color-admin-primary)]"}`}>
                  {(godModeResult.error || godModeResult.status === 'error') ? `ERROR: ${godModeResult.error}` :
                    `✓ TRIGGER ${String(godModeResult.trigger_id || "").slice(0,8).toUpperCase()} FIRED · HUBS: ${godModeResult.hubs_triggered ?? 1} · CLAIMS_QUEUED: ${godModeResult.claims_queued ? "YES" : "NO"} · ${godModeResult.hub_name || "?"}`}
                </div>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="bg-[var(--color-admin-error)]/10 border border-[var(--color-admin-error)]/30 text-[var(--color-admin-error)] text-[10px] font-['JetBrains_Mono'] px-4 py-3">
            ERR: {error} — Backend may be offline. Showing cached data.
          </div>
        )}

        {/* ── KPI Row ── */}
        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-[var(--color-admin-surface)] border border-[var(--color-admin-outline)]/20 h-28 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
            <KPICard title="Active Policies" value={String(kpis.active_policies ?? "--")} sub="LIVE" icon="shield" color="primary" sparkData={mockSparkPolicies} />
            <KPICard title="Payouts Today" value={`₹${Number(kpis.payouts_today_inr ?? 0).toLocaleString("en-IN")}`} sub={`${kpis.payouts_today_count ?? 0} TXNs`} icon="payments" color="success" sparkData={mockSparkPayouts} />
            <KPICard title="Pending Claims" value={String(kpis.pending_claims ?? "--")} sub="NEEDS REVIEW" icon="pending_actions" color={Number(kpis.pending_claims) > 10 ? "error" : "warning"} />
            <KPICard title="Active Triggers" value={String(kpis.active_triggers ?? "--")} sub="LIVE EVENTS" icon="bolt" color={Number(kpis.active_triggers) > 0 ? "warning" : "primary"} />
            <KPICard title="Loss Ratio 7D" value={`${(Number(kpis.loss_ratio_7d ?? 0) * 100).toFixed(1)}%`} sub={Number(kpis.loss_ratio_7d) > 0.75 ? "⚠ HIGH" : "NOMINAL"} icon="analytics" color={Number(kpis.loss_ratio_7d) > 0.75 ? "error" : "primary"} sparkData={mockSparkLR} />
            <KPICard title="ML Model AUC" value={mlM.auc_roc ? `${mlM.auc_roc}` : "--"} sub={mlM.model_type ? "CALIBRATED_GBM" : "NOT TRAINED"} icon="psychology" color={!mlM.auc_roc ? "error" : mlM.auc_roc > 0.85 ? "success" : "primary"} />
          </div>
        )}

        {/* ── Main Grid ── */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

          {/* Audit Log */}
          <div className="bg-[var(--color-admin-surface)] border border-[var(--color-admin-outline)]/20 p-5 space-y-3">
            <div className="flex items-center justify-between border-b border-[var(--color-admin-outline)]/20 pb-3">
              <h3 className="text-[10px] font-['JetBrains_Mono'] font-bold uppercase tracking-widest text-[var(--color-admin-text)]/70">Audit Log</h3>
              <span className="text-[9px] font-['JetBrains_Mono'] text-[var(--color-admin-text)]/30">LAST 10 EVENTS</span>
            </div>
            <div className="overflow-y-auto max-h-64 custom-scrollbar">
              {auditLogs.length === 0 ? (
                <div className="text-[10px] font-['JetBrains_Mono'] text-[var(--color-admin-text)]/30 py-4 text-center">No audit events yet</div>
              ) : (
                auditLogs.map((l, i) => <AuditRow key={i} log={l} />)
              )}
            </div>
          </div>

          {/* ML Model Status */}
          <div className="bg-[var(--color-admin-surface)] border border-[var(--color-admin-outline)]/20 p-5 space-y-3">
              <div className="flex items-center justify-between border-b border-[var(--color-admin-outline)]/20 pb-3">
                <h3 className="text-[10px] font-['JetBrains_Mono'] font-bold uppercase tracking-widest text-[var(--color-admin-text)]/70">ML Model</h3>
                <MLTrainButton onTrained={load} />
              </div>
              {mlM.status === "not_trained" ? (
                <div className="text-[10px] font-['JetBrains_Mono'] text-[var(--color-admin-error)]">⚠ MODEL NOT TRAINED — pricing degraded</div>
              ) : (
                <div className="space-y-1.5 text-[10px] font-['JetBrains_Mono']">
                  {[
                    ["AUC-ROC", mlM.auc_roc, mlM.auc_roc > 0.85 ? "text-[var(--color-admin-primary)]" : "text-yellow-400"],
                    ["Brier Score", mlM.brier_score, "text-[var(--color-admin-text)]/60"],
                    ["F1", mlM.f1, "text-[var(--color-admin-text)]/60"],
                    ["CV AUC", mlM.cv_auc_mean ? `${mlM.cv_auc_mean}±${mlM.cv_auc_std}` : null, "text-[var(--color-admin-text)]/60"],
                    ["Type", mlM.model_type, "text-[var(--color-admin-text)]/40"],
                  ].filter(([,v]) => v != null).map(([k, v, cls]) => (
                    <div key={String(k)} className="flex justify-between">
                      <span className="text-[var(--color-admin-text)]/40 uppercase">{k}</span>
                      <span className={String(cls)}>{String(v)}</span>
                    </div>
                  ))}
                </div>
              )}
          </div>
        </div>

        {/* ── Liquidity Panel ── */}
        {dashboard?.liquidity && Object.keys(dashboard.liquidity).length > 0 && (
          <div className="bg-[var(--color-admin-surface)] border border-[var(--color-admin-outline)]/20 p-5">
            <h3 className="text-[10px] font-['JetBrains_Mono'] font-bold uppercase tracking-widest text-[var(--color-admin-text)]/70 border-b border-[var(--color-admin-outline)]/20 pb-3 mb-4">Liquidity Snapshot</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                ["Razorpay Balance", dashboard.liquidity.razorpay_balance, "payments"],
                ["Reserve Buffer", dashboard.liquidity.reserve_buffer, "savings"],
                ["Available Cash", dashboard.liquidity.available_cash, "account_balance"],
                ["Liquidity Ratio", dashboard.liquidity.liquidity_ratio, "trending_up"],
              ].map(([label, val, icon]) => (
                <div key={String(label)} className="space-y-1">
                  <div className="flex items-center gap-1.5 text-[9px] font-['JetBrains_Mono'] text-[var(--color-admin-text)]/40 uppercase">
                    <span className="material-symbols-outlined text-xs">{icon}</span>
                    {label}
                  </div>
                  <div className="text-lg font-['Inter'] font-bold text-white">
                    {typeof val === "number" && String(label) !== "Liquidity Ratio"
                      ? `₹${Number(val).toLocaleString("en-IN")}`
                      : val != null ? String(val) : "--"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </AdminInstantLoad>
  );
}

// ── Inline ML Train Button ────────────────────────────────────────────────────
function MLTrainButton({ onTrained }: { onTrained: () => void }) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const train = async () => {
    setLoading(true);
    const res = await fetchApi<any>(adminPath("/admin/ml/train"), {
      method: "POST",
      body: JSON.stringify({ sync: true }),
    });
    setLoading(false);
    if (!res.error) { setDone(true); onTrained(); setTimeout(() => setDone(false), 5000); }
  };

  return (
    <button onClick={train} disabled={loading}
      className={`text-[9px] font-['JetBrains_Mono'] uppercase px-2 py-1 border transition-colors disabled:opacity-50 ${
        done ? "border-[#10b981]/40 text-[#10b981]" : "border-[var(--color-admin-primary)]/30 text-[var(--color-admin-primary)] hover:border-[var(--color-admin-primary)]/60"
      }`}>
      {loading ? "TRAINING..." : done ? "✓ TRAINED" : "RETRAIN"}
    </button>
  );
}
