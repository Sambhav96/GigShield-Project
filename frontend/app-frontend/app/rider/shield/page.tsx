"use client";

import { RiderPageTransition } from "@/lib/motion/safeWrappers";
import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { fetchApi, riderPath } from "@/lib/api/client";
import { PolicyResponse, RiderProfileResponse } from "@/lib/api/types";
import { adaptPolicyResponse, PolicyDisplayData } from "@/lib/api/adapters";

const streakTotal = 6;

type ActionToast = {
  tone: "green" | "red";
  text: string;
} | null;

function normalizeErrorMessage(input: unknown, fallback: string): string {
  if (typeof input === "string") {
    const trimmed = input.trim();
    return trimmed || fallback;
  }

  if (Array.isArray(input)) {
    const messages = input
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          const obj = item as Record<string, unknown>;
          if (typeof obj.msg === "string" && obj.msg.trim()) return obj.msg.trim();
          if (typeof obj.message === "string" && obj.message.trim()) return obj.message.trim();
        }
        return "";
      })
      .filter(Boolean);

    if (messages.length > 0) {
      return messages.join(" | ");
    }
  }

  if (input && typeof input === "object") {
    const payload = input as Record<string, unknown>;

    if (typeof payload.detail === "string" && payload.detail.trim()) {
      return payload.detail.trim();
    }

    if (typeof payload.message === "string" && payload.message.trim()) {
      return payload.message.trim();
    }

    const entries = Object.entries(payload)
      .filter(([, v]) => v != null)
      .map(([k, v]) => `${k}: ${String(v)}`);

    if (entries.length > 0) {
      return entries.join(" | ");
    }
  }

  return fallback;
}

// ── Circular progress SVG ─────────────────────────────────────────────────────
function CircleProgress({ pct }: { pct: number }) {
  const r = 28;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" className="-rotate-90">
      <circle cx="36" cy="36" r={r} fill="none" stroke="#1e2633" strokeWidth="5" />
      <circle
        cx="36" cy="36" r={r} fill="none"
        stroke="#54c7fc" strokeWidth="5"
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
      />
      <text
        x="36" y="36"
        textAnchor="middle" dominantBaseline="middle"
        className="rotate-90"
        fill="white"
        fontSize="13"
        fontWeight="700"
        fontFamily="Space Grotesk, sans-serif"
        transform="rotate(90 36 36)"
      >
        {pct}%
      </text>
    </svg>
  );
}

export default function ShieldPage() {
  const [policy, setPolicy] = useState<PolicyDisplayData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<"pause" | "resume" | "cancel" | null>(null);
  const [actionToast, setActionToast] = useState<ActionToast>(null);
  const [effectiveIncome, setEffectiveIncome] = useState(0);
  const normalizedStatus = String(policy?.status || "").trim().toLowerCase();
  const upgradeHref = process.env.NEXT_PUBLIC_PRO_UPGRADE_URL || "/onboarding/rider?step=policy&plan=pro";

  const fetchPolicy = async () => {
    const res = await fetchApi<PolicyResponse>(riderPath("/policies/me"), { method: "GET" });
    if (res.error || !res.data) {
      setError(normalizeErrorMessage(res.error?.message, "Unable to load policy"));
      setPolicy(null);
      return;
    }
    setPolicy(adaptPolicyResponse(res.data));
    setError(null);
  };

  useEffect(() => {
    let mounted = true;
    async function load() {
      setIsLoading(true);
      const riderRes = await fetchApi<RiderProfileResponse>(riderPath("/riders/me"), { method: "GET" });
      if (!riderRes.error && riderRes.data) {
        setEffectiveIncome(Number(riderRes.data.effective_income || 0));
      }
      await fetchPolicy();
      if (mounted) setIsLoading(false);
    }
    load();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!actionToast) return;
    const timer = window.setTimeout(() => setActionToast(null), 2200);
    return () => window.clearTimeout(timer);
  }, [actionToast]);

  const tierLabel = useMemo(() => {
    const plan = policy?.plan?.toLowerCase();
    if (plan === "basic") return "BRONZE SHIELD";
    if (plan === "pro") return "GOLD SHIELD";
    return "SILVER SHIELD";
  }, [policy?.plan]);

  const coverageCap = useMemo(() => {
    if (!policy) return 0;
    return Math.round(policy.capMultiplier * effectiveIncome);
  }, [policy, effectiveIncome]);

  const streakWeeks = Math.max(0, Math.min(streakTotal, Number(policy?.discountWeeks || 0)));
  const streakRemaining = Math.max(0, streakTotal - streakWeeks);

  const triggers = useMemo(() => {
    const plan = policy?.plan?.toLowerCase();
    const isBasic = plan === "basic";
    const isStandard = plan === "standard";
    const isPro = plan === "pro";

    return [
      { id: "rain", icon: "rainy", label: "Rain", sub: "> 2mm/hr threshold", active: true },
      { id: "aqi", icon: "air", label: "AQI", sub: "> 300 hazardous", active: isStandard || isPro },
      { id: "flood", icon: "flood", label: "Flood", sub: "Unlock with Pro", active: isPro },
      { id: "heat", icon: "device_thermostat", label: "Heat", sub: "Unlock with Pro", active: isPro },
      { id: "bandh", icon: "groups", label: "Bandh", sub: "Unlock with Pro", active: isPro },
      { id: "platform", icon: "hub", label: "Platform", sub: "Unlock with Pro", active: isPro },
    ].map((t, idx) => {
      if (isBasic && idx > 0) return { ...t, active: false };
      return t;
    });
  }, [policy?.plan]);

  const runAction = async (action: "pause" | "resume" | "cancel") => {
    if (!policy?.id) return;
    if (actionLoading) return;

    if (action === "pause" && normalizedStatus !== "active") {
      setError("Only active policies can be paused.");
      setActionToast({ tone: "red", text: "Pause failed. Policy is not active." });
      return;
    }
    if (action === "resume" && normalizedStatus !== "paused") {
      setError("Only paused policies can be resumed.");
      setActionToast({ tone: "red", text: "Resume failed. Policy is not paused." });
      return;
    }
    if (action === "cancel" && normalizedStatus === "cancelled") {
      setError("Policy is already cancelled.");
      setActionToast({ tone: "red", text: "Policy is already cancelled." });
      return;
    }

    setActionLoading(action);
    setError(null);

    const body = action === "pause"
      ? { action, reason: "rider_initiated" }
      : { action };

    const res = await fetchApi<{ new_status?: string; status?: string }>(riderPath(`/policies/${policy.id}/status`), {
      method: "PATCH",
      body: JSON.stringify(body),
    });

    if (res.error) {
      const message = normalizeErrorMessage(res.error.message, "Unable to update policy status");
      setError(message);
      setActionToast({ tone: "red", text: message });
      setActionLoading(null);
      return;
    }

    const nextStatus = String(res.data?.new_status || res.data?.status || "").trim().toLowerCase();
    const fallbackStatus = action === "pause" ? "paused" : action === "resume" ? "active" : "cancelled";
    const resolvedStatus = nextStatus || fallbackStatus;
    setPolicy((prev) => (prev ? { ...prev, status: resolvedStatus } : prev));

    if (action !== "cancel") {
      await fetchPolicy();
    }

    if (action === "pause") {
      setActionToast({ tone: "green", text: "Policy paused successfully." });
    } else if (action === "resume") {
      setActionToast({ tone: "green", text: "Policy resumed successfully." });
    } else {
      setActionToast({ tone: "red", text: "Policy cancelled successfully." });
    }

    setActionLoading(null);
  };

  if (isLoading) {
    return (
      <RiderPageTransition>
        <div className="fixed inset-0 z-[999] bg-[var(--color-rider-bg)] flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <span className="material-symbols-outlined animate-spin text-[var(--color-rider-primary)] text-4xl">autorenew</span>
            <p className="text-white/30 text-xs font-['Manrope'] tracking-widest uppercase">Loading shield</p>
          </div>
        </div>
      </RiderPageTransition>
    );
  }

  return (
    <RiderPageTransition>
      <div className="space-y-6 pt-2 pb-4">
        {actionToast && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className={`rounded-xl border px-4 py-3 text-xs font-['Manrope'] font-bold ${
              actionToast.tone === "green"
                ? "bg-[#0f2d20] border-[#2f7d52] text-[#8dffb8]"
                : "bg-[#361414] border-[#8e2e2e] text-[#ff9f9f]"
            }`}
          >
            {actionToast.text}
          </motion.div>
        )}

        {error && (
          <motion.div className="bg-[var(--color-rider-error)]/20 border border-[var(--color-rider-error)] text-[var(--color-rider-error)] text-xs font-['Manrope'] font-medium px-4 py-3 rounded-xl flex items-center gap-2">
            <span className="material-symbols-outlined text-sm">error</span>
            {error}
          </motion.div>
        )}

        {/* ── ACTIVE PROTECTION header ─────────────────────────────── */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11px] font-bold tracking-[0.18em] text-white/40 uppercase font-['Manrope']">
            Active Protection
          </p>
          <a
            href={upgradeHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-full items-center justify-center gap-1 rounded-xl border border-[var(--color-rider-primary)]/40 px-3 py-2 text-[var(--color-rider-primary)] text-xs font-bold font-['Space_Grotesk'] sm:w-auto"
          >
            Upgrade to Pro
            <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>bolt</span>
          </a>
        </div>

        {/* ── Policy card ──────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="bg-[#0d1520] border border-[#1e2d3d] rounded-3xl p-6 relative overflow-hidden"
        >
          {/* subtle cyan glow top-left */}
          <div className="absolute -top-6 -left-6 w-32 h-32 bg-[var(--color-rider-primary)]/10 blur-[48px] rounded-full pointer-events-none" />

          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-[10px] font-bold tracking-[0.2em] text-[#4ade80] uppercase font-['Manrope'] mb-1">
                {tierLabel}
              </p>
              <h1 className="text-4xl font-['Space_Grotesk'] font-extrabold text-white leading-none">
                {policy?.plan_name || "Standard"}
              </h1>
            </div>
            <CircleProgress pct={Math.round(Number(policy?.coveragePct || 0))} />
          </div>

          {/* Active trigger pills */}
          <div className="flex gap-2 mb-5">
            {triggers.filter(t => t.active).slice(0, 2).map(t => (
              <span key={t.id} className="flex items-center gap-1.5 bg-[#1a2e1a] border border-[#2d5a2d] text-[#4ade80] text-[11px] font-bold px-3 py-1.5 rounded-full font-['Manrope']">
                <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>{t.icon}</span>
                {t.label} Active
              </span>
            ))}
          </div>

          {/* Coverage Cap row */}
          <div className="flex items-center justify-between border-t border-[#1e2d3d] pt-4">
            <div>
              <p className="text-[10px] font-bold tracking-widest text-white/30 uppercase font-['Manrope'] mb-1">Coverage Cap</p>
              <p className="text-3xl font-['Space_Grotesk'] font-extrabold text-white">
                ₹{coverageCap.toLocaleString("en-IN")}
              </p>
            </div>
            <span className="material-symbols-outlined text-white/20 text-3xl">touch_app</span>
          </div>
        </motion.div>

        {/* ── ACTIVE TRIGGERS header ────────────────────────────────── */}
        <p className="text-[11px] font-bold tracking-[0.18em] text-white/40 uppercase font-['Manrope']">
          Active Triggers
        </p>

        {/* ── Trigger grid ─────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.05 }}
          className="grid grid-cols-2 gap-3"
        >
          {triggers.map(t => (
            <div
              key={t.id}
              className={`rounded-2xl p-4 relative ${
                t.active
                  ? "bg-[#0d1f2e] border border-[#1e3a50]"
                  : "bg-[#0d1117] border border-[#1a1f28]"
              }`}
            >
              {/* Live dot for active triggers */}
              {t.active && (
                <span className="absolute top-3 right-3 w-2 h-2 rounded-full bg-[var(--color-rider-primary)] shadow-[0_0_6px_rgba(84,199,252,0.8)]" />
              )}

              <span
                className={`material-symbols-outlined text-3xl mb-2 block ${
                  t.active ? "text-[var(--color-rider-primary)]" : "text-white/20"
                }`}
                style={{ fontVariationSettings: t.active ? "'FILL' 1" : "'FILL' 0" }}
              >
                {t.icon}
              </span>

              <p className={`font-['Space_Grotesk'] font-bold text-base mb-0.5 ${t.active ? "text-white" : "text-white/30"}`}>
                {t.label}
              </p>

              {t.active ? (
                <p className="text-[11px] text-[var(--color-rider-primary)] font-['Manrope']">&gt; {t.sub.replace("> ", "")}</p>
              ) : (
                <p className="text-[11px] text-white/25 font-['Manrope'] flex items-center gap-1">
                  <span className="material-symbols-outlined text-[12px]">lock</span>
                  {t.sub}
                </p>
              )}
            </div>
          ))}
        </motion.div>

        {/* ── Streak card ──────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.1 }}
          className="bg-[#0d1520] border border-[#1e2d3d] rounded-2xl p-4"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#1a1206] border border-[#3d2d0a] flex items-center justify-center">
                <span className="material-symbols-outlined text-[#f97316] text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>local_fire_department</span>
              </div>
              <div>
                <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest font-['Manrope']">Streak</p>
                <p className="text-lg font-['Space_Grotesk'] font-bold text-white">{streakWeeks} Weeks</p>
              </div>
            </div>
            <p className="text-right text-[11px] text-[#4ade80] font-bold font-['Manrope'] leading-snug">
              {streakRemaining} more clean weeks<br />
              <span className="text-white/40 font-normal">= 10% off premium</span>
            </p>
          </div>

          {/* Progress dots */}
          <div className="flex gap-2">
            {Array.from({ length: streakTotal }).map((_, i) => (
              <div
                key={i}
                className={`h-1.5 flex-1 rounded-full transition-all ${
                  i < streakWeeks ? "bg-[#4ade80]" : "bg-white/10"
                }`}
              />
            ))}
          </div>
        </motion.div>

        {/* ── Pause / Resume / Cancel controls ─────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.15 }}
          className="bg-[#0d1117] border border-[#1a1f28] rounded-2xl p-4 relative"
        >
          <div className="grid grid-cols-3 gap-3 mt-1">
            {[
              { icon: "pause",             label: "Pause", action: "pause" as const, active: normalizedStatus === "active" },
              { icon: "play_arrow",        label: "Resume", action: "resume" as const, active: normalizedStatus === "paused" },
              { icon: "cancel",            label: "Cancel", action: "cancel" as const, active: normalizedStatus !== "cancelled" },
            ].map(btn => (
              <button
                key={btn.label}
                onClick={() => runAction(btn.action)}
                className={`flex flex-col items-center gap-2 py-3 rounded-xl transition-all active:scale-95 ${
                  btn.active
                    ? "bg-[#0d1a26] border border-[#1e3a50]"
                    : "bg-transparent border border-white/5 opacity-30"
                }`}
                disabled={!btn.active || actionLoading !== null}
              >
                <div className={`w-9 h-9 rounded-full border flex items-center justify-center ${
                  btn.label === "Cancel"
                    ? "border-white/20 bg-white/5"
                    : "border-white/20 bg-white/5"
                }`}>
                  {actionLoading === btn.action ? (
                    <span className="material-symbols-outlined animate-spin text-white text-lg">autorenew</span>
                  ) : (
                    <span className="material-symbols-outlined text-white text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>
                      {btn.icon}
                    </span>
                  )}
                </div>
                <span className={`text-xs font-bold font-['Space_Grotesk'] ${btn.active ? "text-white" : "text-white/30"}`}>
                  {btn.label}
                </span>
              </button>
            ))}
          </div>
        </motion.div>

      </div>
    </RiderPageTransition>
  );
}
