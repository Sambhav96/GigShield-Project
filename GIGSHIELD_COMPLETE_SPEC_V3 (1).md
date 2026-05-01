# GigShield — Production Engineering Specification v3.0

> **Version:** 3.0 — Complete Production Build  
> **Audience:** Backend, Frontend, Data Engineering, DevOps, ML Engineers  
> **Status:** Implementation-ready. Every variable defined. Every formula bounded. Every edge case handled.  
> **Supersedes:** Feature Doc v2.0

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Core Entities & Data Models](#2-core-entities--data-models)
3. [Signal Pipeline — All Inputs](#3-signal-pipeline--all-inputs)
4. [Risk Scoring Engine](#4-risk-scoring-engine)
5. [Pricing Engine](#5-pricing-engine)
6. [Discount Engine](#6-discount-engine)
7. [Trigger Engine — All 6 Triggers](#7-trigger-engine--all-6-triggers)
8. [Plan Engine — 3 Plans](#8-plan-engine--3-plans)
9. [Payout Engine](#9-payout-engine)
10. [Fraud & Trust Engine](#10-fraud--trust-engine)
11. [Policy Lifecycle Management](#11-policy-lifecycle-management)
12. [Loss Ratio & Solvency Engine](#12-loss-ratio--solvency-engine)
13. [Liquidity Engine](#13-liquidity-engine)
14. [Observability, Metrics & Alerting](#14-observability-metrics--alerting)
15. [Admin Panel — All Tabs](#15-admin-panel--all-tabs)
16. [Notification System](#16-notification-system)
17. [Onboarding & UX Flows](#17-onboarding--ux-flows)
18. [Race Condition & Idempotency Protection](#18-race-condition--idempotency-protection)
19. [Circuit Breaker & API Resilience](#19-circuit-breaker--api-resilience)
20. [Reconciliation & Disaster Recovery](#20-reconciliation--disaster-recovery)
21. [Geospatial Fraud Clustering](#21-geospatial-fraud-clustering)
22. [ML Model Specifications](#22-ml-model-specifications)
23. [A/B Experimentation Framework](#23-ab-experimentation-framework)
24. [Legal & Compliance Layer](#24-legal--compliance-layer)
25. [Data Retention Strategy](#25-data-retention-strategy)
26. [System Architecture & Services](#26-system-architecture--services)
27. [Edge Cases & Guard Rails](#27-edge-cases--guard-rails)
28. [Background Jobs & Cron Schedule](#28-background-jobs--cron-schedule)
29. [API Contract Reference](#29-api-contract-reference)
30. [End-to-End Data Flow](#30-end-to-end-data-flow)
31. [Full Formula Sheet](#31-full-formula-sheet)
32. [Pseudocode for Critical Functions](#32-pseudocode-for-critical-functions)
33. [Known Tradeoffs](#33-known-tradeoffs)
34. [Master AI Build Prompt](#34-master-ai-build-prompt)

---

## 1. System Overview

GigShield is a **parametric income protection platform** purpose-built for Q-Commerce delivery riders (Zepto, Blinkit, Swiggy Instamart). It monitors real-world environmental and platform signals. When a pre-defined threshold is crossed in a rider's zone, a claim is automatically scored and a UPI payout is processed — with zero rider action required.

### 1.1 Core Principles

| Principle | Definition |
|---|---|
| **Parametric** | Payouts triggered by objective data, never by rider-submitted loss claims |
| **Income-relative** | All payouts calculated against each rider's verified daily income |
| **Zero-touch** | Full claim and payout cycle is automatic; rider acts only for VOV evidence |
| **Weekly cycle** | Premium debited every Monday 00:01 IST; cap window Mon 00:00 – Sun 23:59 IST |
| **Single time authority** | All timestamps from PostgreSQL `NOW()` only — never local server time |
| **Idempotent money ops** | Every payout and debit has a `UNIQUE` idempotency key — double-spend impossible |

### 1.2 Six Trigger Types

| ID | Trigger | Threshold | Primary API | Secondary API |
|---|---|---|---|---|
| `rain` | Heavy rain | >35 mm/hr sustained 45+ min (adaptive per hub) | OpenWeatherMap One Call 3.0 / IMD | Google Earth Engine (Sentinel-2 NDWI) |
| `flood` | Zone flooding | NDMA advisory + NDWI > 0.3 | NDMA Disaster API | Earth Engine water detection |
| `heat` | Heatwave | Wet bulb temp > 32°C | Weatherstack (wet bulb computed) | OWM temp+humidity (fallback compute) |
| `aqi` | Air quality | AQI > 200 (standard) or > 450 (hazardous) | WAQI API / CPCB | Phone air sensors (if available) |
| `bandh` | Civic strike | Road speed < 15% of 30-day baseline | HERE Maps Traffic (free) + Google Routes (confirmation) | BeautifulSoup NLP scraper (Twitter/X + news) |
| `platform_down` | App outage | Uptime < 95% for 30+ min (6 consecutive 5-min checks) | Direct HTTP health check | PWA peer "Report Outage" consensus |

### 1.3 Service Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        API GATEWAY                           │
│            Next.js PWA  ←→  FastAPI Router                   │
└───────────────────────┬──────────────────────────────────────┘
                        │
         ┌──────────────┴────────────────────────────────────┐
         │                  CORE SERVICES                    │
         │  oracle-service      fraud-service                │
         │  payout-service      telemetry-service            │
         │  policy-service      ml-service                   │
         │  vov-service         notification-service         │
         │  liquidity-service   reconciliation-service       │
         └────────────────────────────────────────────────────┘
                        │
         ┌──────────────┴────────────────────────────────────┐
         │                 INFRASTRUCTURE                    │
         │  Supabase PostgreSQL (primary DB + auth + RLS)    │
         │  Redis (queue + cache + circuit breaker state)    │
         │  Celery (async tasks: YOLOv8, reconciliation)     │
         │  Supabase Storage (VOV video, TTL-managed)        │
         │  pg_cron (Monday debit, hourly jobs — DB time)    │
         └────────────────────────────────────────────────────┘
```

### 1.4 SLA Definitions

| Flow | Target | Max |
|---|---|---|
| Auto-clear payout (FS < 0.40) | 60 seconds | 3 minutes |
| Soft-flag provisional (70%) | 90 seconds | 5 minutes |
| Soft-flag remainder (30%) | 2 hours | 4 hours |
| Hard-flag admin review | 4 hours | 8 hours |
| Dispute resolution | 72 hours | 96 hours |
| VOV EXIF check | < 5 seconds | 30 seconds |
| YOLOv8 inference | < 30 seconds | 2 minutes |
| Oracle evaluation loop | 15 minutes | 30 minutes |
| Monday debit window | 00:01–00:30 IST | 02:00 IST |

---

## 2. Core Entities & Data Models

### 2.1 Complete Schema

```sql
-- ============================================================
-- RIDERS
-- ============================================================
CREATE TABLE riders (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    TEXT NOT NULL,
  phone                   TEXT UNIQUE NOT NULL,
  aadhaar_hash            TEXT,            -- SHA-256, never raw
  pan_hash                TEXT,            -- SHA-256, never raw
  platform                TEXT NOT NULL,   -- 'zepto'|'blinkit'|'instamart'
  city                    TEXT NOT NULL,
  hub_id                  UUID REFERENCES hubs(id),
  declared_income         NUMERIC(8,2) NOT NULL,
  effective_income        NUMERIC(8,2) NOT NULL,  -- used in ALL formulas
  telemetry_inferred_income NUMERIC(8,2),         -- from ml-service weekly
  income_verified_at      TIMESTAMPTZ,
  tier                    TEXT DEFAULT 'B' CHECK (tier IN ('A','B')),
  risk_score              INTEGER DEFAULT 50 CHECK (risk_score BETWEEN 0 AND 100),
  risk_profile            TEXT DEFAULT 'medium' CHECK (risk_profile IN ('low','medium','high')),
  device_fingerprint      TEXT,            -- canvas+WebGL hash
  bank_account_hash       TEXT,            -- hashed UPI/bank ID
  phone_verified          BOOLEAN DEFAULT false,
  enrollment_ip_prefix    TEXT,            -- /24 subnet hash for fraud clustering
  syndicate_suspect_group_id UUID,         -- set if fraud cluster detected
  experiment_group_id     TEXT DEFAULT 'control',
  created_at              TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- HUBS (DARK STORES)
-- ============================================================
CREATE TABLE hubs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  platform            TEXT NOT NULL,
  city                TEXT NOT NULL,
  latitude            NUMERIC(10,7) NOT NULL,
  longitude           NUMERIC(10,7) NOT NULL,
  h3_index_res9       TEXT NOT NULL,       -- ~170m cells (Tier-1 cities)
  h3_index_res8       TEXT NOT NULL,       -- ~460m cells (Tier-2 cities)
  radius_km           NUMERIC(4,2) DEFAULT 2.0,
  capacity            INTEGER DEFAULT 100, -- for λ occupancy surge
  city_multiplier     NUMERIC(4,3) NOT NULL,
  drainage_index      NUMERIC(4,3) DEFAULT 0.5,  -- 0=poor, 1=excellent
  rain_threshold_mm   NUMERIC(5,2) DEFAULT 35.0, -- adaptive per hub
  api_key             TEXT,                -- hashed, for B2B hub API
  geom                GEOGRAPHY(POINT, 4326),
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- POLICIES
-- ============================================================
CREATE TABLE policies (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id                UUID REFERENCES riders(id) NOT NULL,
  hub_id                  UUID REFERENCES hubs(id) NOT NULL,
  plan                    TEXT NOT NULL CHECK (plan IN ('basic','standard','pro')),
  status                  TEXT DEFAULT 'active'
    CHECK (status IN ('active','paused','lapsed','cancelled')),
  coverage_pct            NUMERIC(4,3) NOT NULL,   -- 0.50 | 0.65-0.75 | 0.88-0.92
  plan_cap_multiplier     INTEGER NOT NULL CHECK (plan_cap_multiplier IN (3,5,7)),
  weekly_premium          NUMERIC(8,2) NOT NULL,   -- P_final computed at enrollment
  discount_weeks          INTEGER DEFAULT 0 CHECK (discount_weeks BETWEEN 0 AND 4),
  pause_count_qtr         INTEGER DEFAULT 0 CHECK (pause_count_qtr <= 2),
  weekly_payout_used      NUMERIC(8,2) DEFAULT 0,
  week_start_date         DATE NOT NULL,
  razorpay_mandate_id     TEXT,
  razorpay_fund_account_id TEXT,
  experiment_group_id     TEXT,
  activated_at            TIMESTAMPTZ DEFAULT NOW(),
  cancelled_at            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- POLICY PAUSES
-- ============================================================
CREATE TABLE policy_pauses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id   UUID REFERENCES policies(id) NOT NULL,
  start_date  DATE NOT NULL,
  end_date    DATE,
  reason      TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TELEMETRY PINGS
-- ============================================================
CREATE TABLE telemetry_pings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id        UUID REFERENCES riders(id) NOT NULL,
  latitude        NUMERIC(10,7) NOT NULL,
  longitude       NUMERIC(10,7) NOT NULL,
  h3_index_res9   TEXT NOT NULL,
  speed_kmh       NUMERIC(6,2),
  accuracy_m      NUMERIC(6,2),
  network_type    TEXT,                  -- '5G'|'4G'|'EDGE'|'offline'
  is_bundle       BOOLEAN DEFAULT false, -- offline bundle submission
  bundle_hash     TEXT,                  -- SHA-256 for integrity
  platform_status TEXT,                  -- 'available'|'on_delivery'|'offline'
  session_active  BOOLEAN DEFAULT false, -- app in foreground
  recorded_at     TIMESTAMPTZ NOT NULL,  -- device timestamp (UTC)
  synced_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- SHIFT STATES
-- ============================================================
CREATE TABLE shift_states (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id    UUID REFERENCES riders(id) NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('active','idle','offline')),
  started_at  TIMESTAMPTZ NOT NULL,
  ended_at    TIMESTAMPTZ,
  inferred_by TEXT NOT NULL CHECK (inferred_by IN ('gps','platform_api','app_session'))
);

-- ============================================================
-- TRIGGER EVENTS
-- ============================================================
CREATE TABLE trigger_events (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_type            TEXT NOT NULL CHECK (trigger_type IN
    ('rain','flood','heat','aqi','bandh','platform_down')),
  h3_index                TEXT NOT NULL,
  hub_id                  UUID REFERENCES hubs(id),
  oracle_score            NUMERIC(4,3),
  satellite_score         NUMERIC(4,3),
  weather_score           NUMERIC(4,3),
  traffic_score           NUMERIC(4,3),
  peer_score              NUMERIC(4,3),
  consensus_score         NUMERIC(4,3),
  accel_score             NUMERIC(4,3),
  weight_config           JSONB,           -- which weight model used
  raw_api_data            JSONB,           -- stored for backtesting
  status                  TEXT DEFAULT 'detected'
    CHECK (status IN ('detected','active','resolving','resolved','cancelled')),
  cold_start_mode         BOOLEAN DEFAULT false,
  is_synthetic            BOOLEAN DEFAULT false,  -- God Mode forced
  cooldown_active         BOOLEAN DEFAULT false,
  cooldown_payout_factor  NUMERIC(4,3) DEFAULT 1.0,
  correlation_factor      NUMERIC(4,3) DEFAULT 1.0,
  city_trigger_count      INTEGER DEFAULT 1,
  vov_zone_certified      BOOLEAN DEFAULT false,
  vov_cert_score          NUMERIC(4,3),
  triggered_at            TIMESTAMPTZ DEFAULT NOW(),
  resolved_at             TIMESTAMPTZ
);

-- ============================================================
-- CLAIMS
-- ============================================================
CREATE TABLE claims (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id                    UUID REFERENCES riders(id) NOT NULL,
  policy_id                   UUID REFERENCES policies(id) NOT NULL,
  trigger_id                  UUID REFERENCES trigger_events(id) NOT NULL,
  idempotency_key             TEXT UNIQUE NOT NULL,
  status                      TEXT DEFAULT 'initiated'
    CHECK (status IN ('initiated','evaluating','auto_cleared','soft_flagged',
      'hard_flagged','manual_review','manual_approved','manual_rejected',
      'manual_adjusted','cap_exhausted','disputed','paid','rejected')),
  fraud_score                 NUMERIC(4,3),
  oracle_confidence           NUMERIC(4,3),
  presence_confidence         NUMERIC(4,3),
  intent_factor1_gps          BOOLEAN,
  intent_factor2_session      BOOLEAN,
  intent_factor3_platform     BOOLEAN,
  intent_platform_unavailable BOOLEAN DEFAULT false,
  event_payout                NUMERIC(8,2),
  actual_payout               NUMERIC(8,2),
  confidence_adjusted_payout  NUMERIC(8,2),
  duration_hrs                NUMERIC(5,2),
  mu_time                     NUMERIC(3,2),
  explanation_text            TEXT,        -- rider-facing
  admin_trace                 JSONB,       -- full signal trace for admin
  competing_triggers          JSONB,       -- suppressed triggers (stacking rule)
  is_manual_override          BOOLEAN DEFAULT false,
  admin_action                TEXT,
  admin_id                    UUID,
  admin_action_at             TIMESTAMPTZ,
  admin_custom_amount         NUMERIC(8,2),
  admin_note                  TEXT,
  initiated_at                TIMESTAMPTZ DEFAULT NOW(),
  cleared_at                  TIMESTAMPTZ,
  paid_at                     TIMESTAMPTZ
);

-- ============================================================
-- PAYOUTS
-- ============================================================
CREATE TABLE payouts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id            UUID REFERENCES claims(id),
  rider_id            UUID REFERENCES riders(id) NOT NULL,
  policy_id           UUID REFERENCES policies(id) NOT NULL,
  amount              NUMERIC(8,2) NOT NULL,
  payout_type         TEXT NOT NULL CHECK (payout_type IN
    ('initial','continuation','provisional','remainder',
     'goodwill','vov_reward','premium_debit','refund')),
  razorpay_ref        TEXT UNIQUE,         -- prevents double-send
  razorpay_status     TEXT DEFAULT 'initiated'
    CHECK (razorpay_status IN ('initiated','processing','success','failed',
      'reversed','circuit_breaker_hold','circuit_breaker_hold')),
  idempotency_key     TEXT UNIQUE NOT NULL,
  reconcile_status    TEXT,
  released_at         TIMESTAMPTZ DEFAULT NOW(),
  reconciled_at       TIMESTAMPTZ
);

-- ============================================================
-- CLAIM EVIDENCE (VOV)
-- ============================================================
CREATE TABLE claim_evidence (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id                    UUID REFERENCES claims(id) NOT NULL,
  rider_id                    UUID REFERENCES riders(id) NOT NULL,
  h3_index                    TEXT NOT NULL,
  video_url                   TEXT,
  exif_gps_lat                NUMERIC(10,7),
  exif_gps_lng                NUMERIC(10,7),
  exif_timestamp              TIMESTAMPTZ,
  exif_valid                  BOOLEAN,
  integrity_valid             BOOLEAN,
  cv_confidence               NUMERIC(4,3),
  cv_classes                  TEXT[],
  gear_detected               BOOLEAN DEFAULT false,
  contributed_to_zone_cert    BOOLEAN DEFAULT false,
  vov_reward_issued           BOOLEAN DEFAULT false,
  vov_reward_amount           NUMERIC(6,2),
  ttl_delete_at               TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ZONE VOV CERTIFICATIONS
-- ============================================================
CREATE TABLE zone_vov_certs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  h3_index            TEXT NOT NULL,
  trigger_id          UUID REFERENCES trigger_events(id) NOT NULL,
  submitted_count     INTEGER NOT NULL,
  confirmed_count     INTEGER NOT NULL,
  avg_cv_confidence   NUMERIC(4,3),
  certified           BOOLEAN DEFAULT false,
  certified_at        TIMESTAMPTZ,
  expires_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- DISPUTES
-- ============================================================
CREATE TABLE disputes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id        UUID REFERENCES claims(id) NOT NULL,
  rider_id        UUID REFERENCES riders(id) NOT NULL,
  reason_text     TEXT NOT NULL,
  status          TEXT DEFAULT 'open'
    CHECK (status IN ('open','resolved_upheld','resolved_rejected','escalated')),
  resolution_note TEXT,
  goodwill_credit NUMERIC(8,2),
  sla_deadline    TIMESTAMPTZ NOT NULL,
  escalated       BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ
);

-- ============================================================
-- ZONE RISK CACHE
-- ============================================================
CREATE TABLE zone_risk_cache (
  h3_index              TEXT PRIMARY KEY,
  vulnerability_idx     NUMERIC(4,3),
  active_policies       INTEGER DEFAULT 0,
  lambda_surge          NUMERIC(4,3) DEFAULT 1.0,
  confirmed_event_count INTEGER DEFAULT 0,
  cold_start_mode       BOOLEAN DEFAULT true,
  last_updated          TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- LIQUIDITY SNAPSHOTS
-- ============================================================
CREATE TABLE liquidity_snapshots (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  razorpay_balance  NUMERIC(12,2),
  reserve_buffer    NUMERIC(12,2),
  available_cash    NUMERIC(12,2),
  expected_24h      NUMERIC(12,2),
  liquidity_ratio   NUMERIC(6,4),
  mode              TEXT,
  snapshot_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- METRICS TIMESERIES
-- ============================================================
CREATE TABLE metrics_timeseries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_name TEXT NOT NULL,
  value       NUMERIC,
  labels      JSONB,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
) PARTITION BY RANGE (recorded_at);

-- ============================================================
-- SEGMENT ECONOMICS (weekly snapshot)
-- ============================================================
CREATE TABLE segment_economics (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start            DATE NOT NULL,
  city                  TEXT NOT NULL,
  plan                  TEXT NOT NULL,
  tier                  TEXT NOT NULL,
  risk_profile          TEXT NOT NULL,
  active_policies       INTEGER,
  premiums_collected    NUMERIC(12,2),
  payouts_issued        NUMERIC(12,2),
  loss_ratio            NUMERIC(6,4),
  gross_margin          NUMERIC(12,2),
  fraud_flags           INTEGER,
  vov_participants      INTEGER
);

-- ============================================================
-- EXPERIMENTS
-- ============================================================
CREATE TABLE experiments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  parameter_name    TEXT NOT NULL,
  parameter_value   JSONB NOT NULL,
  group_id          TEXT NOT NULL,
  active            BOOLEAN DEFAULT true,
  set_by_admin_id   UUID,
  activated_at      TIMESTAMPTZ DEFAULT NOW(),
  deactivated_at    TIMESTAMPTZ
);

CREATE TABLE message_experiments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_name   TEXT NOT NULL,
  group_id          TEXT NOT NULL,
  message_key       TEXT NOT NULL,
  message_template  TEXT NOT NULL,
  active            BOOLEAN DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
CREATE TABLE notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id      UUID REFERENCES riders(id) NOT NULL,
  type          TEXT NOT NULL,
  channel       TEXT NOT NULL CHECK (channel IN ('push','sms','whatsapp')),
  message       TEXT NOT NULL,
  status        TEXT DEFAULT 'pending'
    CHECK (status IN ('pending','sent','delivered','failed')),
  attempt_count INTEGER DEFAULT 0,
  sent_at       TIMESTAMPTZ,
  delivered_at  TIMESTAMPTZ,
  failed_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- AUDIT & COMPLIANCE
-- ============================================================
CREATE TABLE admin_audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    UUID NOT NULL,
  action      TEXT NOT NULL,
  payload     JSONB,
  ip_address  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE rider_consent_log (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id              UUID REFERENCES riders(id) NOT NULL,
  consent_type          TEXT NOT NULL,
  consent_text_version  TEXT NOT NULL,
  consented_at          TIMESTAMPTZ DEFAULT NOW(),
  ip_address            TEXT
);

CREATE TABLE data_access_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  accessor_id   UUID NOT NULL,
  accessor_type TEXT NOT NULL,
  data_accessed TEXT NOT NULL,
  purpose       TEXT,
  accessed_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- FRAUD INFRASTRUCTURE
-- ============================================================
CREATE TABLE blacklisted_devices (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_fingerprint  TEXT UNIQUE NOT NULL,
  reason              TEXT,
  blacklisted_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE fraud_clusters (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_type  TEXT NOT NULL,
  rider_ids     UUID[],
  h3_index      TEXT,
  detected_at   TIMESTAMPTZ DEFAULT NOW(),
  status        TEXT DEFAULT 'investigating',
  admin_note    TEXT
);

CREATE TABLE rider_risk_scores (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id    UUID REFERENCES riders(id) NOT NULL,
  score       INTEGER NOT NULL,
  profile     TEXT NOT NULL,
  computed_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- RECONCILIATION
-- ============================================================
CREATE TABLE reconciliation_reports (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date                 DATE NOT NULL,
  report_type                 TEXT NOT NULL,
  total_db_records            INTEGER,
  total_razorpay_records      INTEGER,
  matched_count               INTEGER,
  late_success_count          INTEGER,
  mismatch_count              INTEGER,
  missing_from_db_count       INTEGER,
  missing_from_razorpay_count INTEGER,
  total_discrepancy_inr       NUMERIC(12,2),
  status                      TEXT,
  raw_details                 JSONB,
  created_at                  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE razorpay_reconciliation_raw (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  razorpay_id   TEXT UNIQUE NOT NULL,
  reference_id  TEXT,
  amount        NUMERIC(12,2),
  status        TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  fetched_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE webhook_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    TEXT UNIQUE NOT NULL,
  event_type  TEXT NOT NULL,
  payload     JSONB,
  processed   BOOLEAN DEFAULT false,
  received_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- SYSTEM CONFIG & CONTROL
-- ============================================================
CREATE TABLE system_config (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_by  UUID,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Seed critical config values
INSERT INTO system_config (key, value) VALUES
  ('global_kill_switch',       'false'),
  ('liquidity_mode',           'normal'),
  ('reserve_buffer_inr',       '500000'),
  ('lambda_floor',             '1.0'),
  ('max_daily_payout_mumbai',  '0'),
  ('max_daily_payout_delhi',   '0');

CREATE TABLE cron_locks (
  job_name    TEXT NOT NULL,
  week_start  DATE NOT NULL,
  locked_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (job_name, week_start)
);

CREATE TABLE circuit_breaker_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service       TEXT NOT NULL,
  event_type    TEXT NOT NULL,
  failure_count INTEGER,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ORACLE DATA SNAPSHOTS (for backtesting)
-- ============================================================
CREATE TABLE oracle_api_snapshots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  h3_index      TEXT NOT NULL,
  trigger_type  TEXT NOT NULL,
  api_source    TEXT NOT NULL,
  raw_value     NUMERIC,
  signal_score  NUMERIC(4,3),
  snapshot_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ENTITY STATE LOG (for debugging partial failures)
-- ============================================================
CREATE TABLE entity_state_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type   TEXT NOT NULL,
  entity_id     UUID NOT NULL,
  from_state    TEXT,
  to_state      TEXT NOT NULL,
  reason        TEXT,
  service_name  TEXT,
  transitioned_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- SUPPORT MESSAGES
-- ============================================================
CREATE TABLE support_messages (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id  UUID REFERENCES riders(id) NOT NULL,
  claim_id  UUID REFERENCES claims(id),
  direction TEXT NOT NULL CHECK (direction IN ('admin_to_rider','rider_to_admin')),
  message   TEXT NOT NULL,
  sent_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE backtest_results (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city                  TEXT,
  date_from             DATE,
  date_to               DATE,
  config_used           JSONB,
  precision_pct         NUMERIC(5,2),
  recall_pct            NUMERIC(5,2),
  simulated_loss_ratio  NUMERIC(6,4),
  actual_loss_ratio     NUMERIC(6,4),
  delta_loss_ratio      NUMERIC(6,4),
  is_simulation         BOOLEAN DEFAULT true,
  run_at                TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE stress_test_scenarios (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  scenario_type TEXT NOT NULL,
  params      JSONB NOT NULL,
  last_result JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_telemetry_rider_time   ON telemetry_pings (rider_id, recorded_at DESC);
CREATE INDEX idx_telemetry_h3_time      ON telemetry_pings (h3_index_res9, recorded_at DESC);
CREATE INDEX idx_claims_policy          ON claims (policy_id, initiated_at DESC);
CREATE INDEX idx_claims_trigger         ON claims (trigger_id);
CREATE INDEX idx_claims_status          ON claims (status) WHERE status NOT IN ('paid','rejected');
CREATE INDEX idx_policies_hub_status    ON policies (hub_id, status);
CREATE INDEX idx_policies_rider         ON policies (rider_id, status);
CREATE INDEX idx_trigger_h3_active      ON trigger_events (h3_index, status, triggered_at DESC);
CREATE INDEX idx_payouts_rider_week     ON payouts (rider_id, released_at DESC);
CREATE INDEX idx_payouts_idempotency    ON payouts (idempotency_key);
CREATE INDEX idx_evidence_h3_trigger    ON claim_evidence (h3_index, created_at DESC);
CREATE INDEX idx_shift_rider_status     ON shift_states (rider_id, started_at DESC);
CREATE INDEX idx_hubs_geom              ON hubs USING GIST (geom);
CREATE INDEX idx_metrics_name_time      ON metrics_timeseries (metric_name, recorded_at DESC);

-- ============================================================
-- STATE MACHINE CONSTRAINTS
-- ============================================================
CREATE OR REPLACE FUNCTION validate_trigger_state_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'detected'   AND NEW.status != 'active'                      THEN RAISE EXCEPTION 'Invalid trigger transition: detected -> %', NEW.status; END IF;
  IF OLD.status = 'active'     AND NEW.status NOT IN ('resolving','cancelled')  THEN RAISE EXCEPTION 'Invalid trigger transition: active -> %', NEW.status; END IF;
  IF OLD.status = 'resolving'  AND NEW.status NOT IN ('resolved','active')      THEN RAISE EXCEPTION 'Invalid trigger transition: resolving -> %', NEW.status; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_trigger_state_machine
  BEFORE UPDATE ON trigger_events
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION validate_trigger_state_transition();
```

### 2.2 City Multipliers (Seeded at Launch)

| City | `city_multiplier` |
|---|---|
| Mumbai | 1.35 |
| Delhi | 1.28 |
| Kolkata | 1.18 |
| Bangalore | 1.15 |
| Chennai | 1.08 |
| Pune | 1.05 |
| Ahmedabad | 1.02 |

### 2.3 City Median Incomes (Seeded at Launch)

| City | `city_median_income` |
|---|---|
| Mumbai | ₹850 |
| Delhi | ₹780 |
| Bangalore | ₹820 |
| Chennai | ₹760 |
| Others | ₹720 |


---

## 3. Signal Pipeline — All Inputs

### 3.1 API Rate Limits & Free Tier Strategy

| API | Free Limit | Strategy | Scale Trigger |
|---|---|---|---|
| OpenWeatherMap One Call 3.0 | 1,000 calls/day | 1 call per hex per 15-min cycle; max 10 hexes free | > 10 active hubs → $40/mo paid |
| WAQI / CPCB | 1,000 calls/day | Same as OWM | > 10 active hubs |
| HERE Maps Traffic | 2,500 calls/day | Primary for regular bandh polling | > 60 active hubs |
| Google Routes API | $200 credit/month | Confirmation only when HERE shows anomaly | N/A |
| Google Earth Engine | 100k EECU-s/month | Only when OWM rain score > 0.50 | N/A |
| Weatherstack | 100 calls/month | Only when OWM temp > 38°C | N/A |

**Redis Cache Strategy (reduces API calls ~70%):**

```
Cache key format: "oracle:{trigger_type}:{h3_index}:{15min_bucket}"
15min_bucket = floor(unix_timestamp / 900)

TTL by source:
  OWM weather:        900s  (15 min)
  WAQI AQI:          1800s  (30 min)
  HERE Traffic:       600s  (10 min)
  Google Routes:      900s  (15 min)
  Earth Engine:      7200s  (2 hr — satellite has natural latency)
  Weatherstack:      7200s  (2 hr)
```

### 3.2 Signal Scoring (Layer 1) — Raw API → Confidence Score 0.0–1.0

```
RAIN SIGNAL SCORE (from OWM rainfall_mm_hr):
  IF raw_value >= 50:                    score = 1.00
  IF 35 <= raw_value < 50:               score = 0.70 + ((raw_value - 35) / 15) × 0.30
  IF 20 <= raw_value < hub.rain_threshold_mm:
                                         score = 0.30 + ((raw_value - 20) / 15) × 0.40
  IF raw_value < 20:                     score = 0.00
  NOTE: hub.rain_threshold_mm is adaptive (default 35.0, range 20–60)

FLOOD SIGNAL SCORE (from Earth Engine NDWI + NDMA):
  satellite_ndwi = Google Earth Engine NDWI value
  ndma_active    = 1 if NDMA advisory active for zone, else 0
  score = (0.60 × CLAMP((satellite_ndwi - 0.3) / 0.5, 0.0, 1.0))
        + (0.40 × ndma_active)

AQI SIGNAL SCORE (from WAQI integer):
  IF aqi >= 450: score = 1.00   (Hazardous — Pro plan threshold)
  IF aqi >= 300: score = 0.80
  IF aqi >= 200: score = 0.60   (Standard plan threshold floor)
  IF aqi < 200:  score = 0.00

HEAT SIGNAL SCORE (wet bulb Tw from Weatherstack or OWM):
  Wet bulb formula (Stull 2011):
    Tw = T × arctan(0.151977 × √(RH + 8.313659))
       + arctan(T + RH)
       - arctan(RH - 1.676331)
       + 0.00391838 × RH^1.5 × arctan(0.023101 × RH)
       - 4.686035
  
  IF Tw >= 35:  score = 1.00
  IF Tw >= 32:  score = 0.50 + ((Tw - 32) / 3) × 0.50
  IF Tw < 32:   score = 0.00

BANDH SIGNAL SCORE (from HERE Maps + NLP):
  speed_ratio  = current_avg_speed_kmh / baseline_avg_speed_kmh
  nlp_score    = TF-IDF keyword match score from NLP scraper
  
  IF speed_ratio <= 0.05:  traffic_score = 1.00
  IF speed_ratio <= 0.15:  traffic_score = 0.60 + ((0.15 - speed_ratio) / 0.10) × 0.40
  IF speed_ratio > 0.15:   traffic_score = 0.00
  
  nlp_score (BeautifulSoup):
    Keywords: "bandh", "hartal", "rasta roko", "strike", "road block"
    Geo-filter: within 5km of H3 zone center
    Capped at 0.50 (cannot auto-trigger without traffic confirmation)
  
  bandh_score = MAX(traffic_score, nlp_score × 0.80)

PLATFORM DOWN SIGNAL SCORE (from direct HTTP health check):
  consecutive_failures = count of failed checks in last 30 min (checks every 5 min)
  IF consecutive_failures >= 6:  score = 1.00  (30+ min = trigger)
  IF consecutive_failures >= 3:  score = 0.50  (15 min = monitoring)
  IF consecutive_failures < 3:   score = 0.00
```

### 3.3 Fallback Hierarchy (Explicit Decision Tree)

```
For each signal, execute in order until a result is obtained.
If no result: skip signal, renormalize remaining weights to sum to 1.0.

RAIN:
  1. OWM One Call 3.0 (primary)
  2. IMD Open Data API (fallback, free)
  3. Cached OWM < 45 min old → use with confidence_penalty = 0.15
  4. SKIP → log oracle_skip_reason = 'rain_api_unavailable'

FLOOD:
  1. Earth Engine NDWI (primary)
  2. NDMA advisory API (fallback)
  3. Cached Earth Engine < 3hr → use with confidence_penalty = 0.15
  4. SKIP

HEAT:
  1. Weatherstack wet bulb (primary)
  2. Compute from OWM temp + humidity (Stull formula) — effectively free
  3. SKIP

AQI:
  1. WAQI API (primary)
  2. CPCB station data (fallback)
  3. Cached WAQI < 60 min → use with confidence_penalty = 0.10
  4. SKIP

BANDH:
  1. HERE Maps Traffic (primary, free 2500/day)
  2. Google Routes API (confirmation, free credit)
  3. NLP scraper only → score capped at 0.50, cannot auto-trigger
  4. SKIP

PLATFORM_DOWN:
  1. Direct HTTP GET to platform endpoint — never rate-limited
  2. If response ambiguous (not 200, not timeout): require 3 consecutive before triggering

CONFIDENCE PENALTY ACCUMULATION:
  IF fallback API used:    reduce oracle weight for that signal by 0.10
  IF cached data used:     reduce oracle weight for that signal by 0.15
  IF signal skipped:       remove from weight set entirely
  Renormalize: remaining_weights = each_weight / SUM(remaining_weights)
  Final oracle_score uses renormalized weights.
```

### 3.4 fetch_with_fallback Pattern (Used by All Oracle Services)

```python
def fetch_with_fallback(primary_fn, fallback_fn, cache_key, cache_ttl_seconds):
    """Returns (value, source, confidence_penalty)"""
    
    # 1. Check cache first
    cached = redis.get(cache_key)
    if cached:
        age_seconds = time.time() - cached.timestamp
        if age_seconds < cache_ttl_seconds:
            return cached.value, 'cache', 0.0
    
    # 2. Try primary via circuit breaker
    try:
        result = circuit_breaker(primary_fn.service_name).call(primary_fn)
        redis.set(cache_key, {'value': result, 'timestamp': time.time()}, 
                  ttl=cache_ttl_seconds)
        return result, 'primary', 0.0
    except RateLimitError:
        log_metric('api_rate_limit_hit', labels={'service': primary_fn.service_name})
    except (TimeoutError, CircuitOpenError):
        log_metric('api_unavailable', labels={'service': primary_fn.service_name})
    
    # 3. Try fallback
    try:
        result = circuit_breaker(fallback_fn.service_name).call(fallback_fn)
        redis.set(cache_key, {'value': result, 'timestamp': time.time()},
                  ttl=cache_ttl_seconds)
        return result, 'fallback', 0.10
    except Exception:
        pass
    
    # 4. Use stale cache if available
    if cached:
        return cached.value, 'stale_cache', 0.15
    
    # 5. Signal unavailable
    return None, 'unavailable', None
```

---

## 4. Risk Scoring Engine

### 4.1 Rider Tier Assignment

```
Tier A: riders.effective_income > ₹700/day
Tier B: riders.effective_income ≤ ₹700/day

Effect on coverage_pct within each plan:
  Plan     | Tier A coverage | Tier B coverage
  basic    | 50%             | 50%   (no split — flat)
  standard | 75%             | 65%
  pro      | 92%             | 88%

Assignment: at onboarding (from effective_income)
Re-evaluation: quarterly (1st of Jan, Apr, Jul, Oct)
  Source: AVG(effective_income) recalculated via ML model
```

### 4.2 Rider Risk Score & Profile

```
SCORING FORMULA (0–100 points, higher = riskier):

  claims_frequency_score (0–40 pts):
    claims_per_week = COUNT(claims WHERE initiated_at >= now()-90d) / 13
    IF claims_per_week > 2.0: 40 pts
    IF claims_per_week > 1.0: 20 pts
    IF claims_per_week > 0.5: 10 pts
    ELSE: 0 pts

  fraud_score_history (0–30 pts):
    avg_fs = AVG(claims.fraud_score WHERE initiated_at >= now()-90d)
    IF avg_fs > 0.60: 30 pts
    IF avg_fs > 0.40: 15 pts
    IF avg_fs > 0.25:  5 pts
    ELSE: 0 pts

  hard_flag_count (0–20 pts):
    flags_90d = COUNT(claims WHERE status='hard_flagged' AND initiated_at >= now()-90d)
    IF flags_90d >= 2: 20 pts
    IF flags_90d = 1:  10 pts

  vov_participation (−10 pts reward):
    vov_submissions = COUNT(claim_evidence WHERE rider_id=:id AND created_at >= now()-90d)
    IF vov_submissions >= 3: −10 pts

  risk_score = CLAMP(SUM(all above), 0, 100)

  risk_profile:
    0–30:   'low'
    31–60:  'medium'
    61–100: 'high'

EFFECT ON PREMIUM:
  risk_multiplier:
    'low':    0.95
    'medium': 1.00
    'high':   1.15

EFFECT ON FRAUD THRESHOLDS:
  'high' profile:
    auto_clear_threshold: 0.40 → 0.30
    hard_flag_threshold:  0.70 → 0.60

WEEKLY REPUTATION DECAY (runs Monday alongside premium debit):
  IF week was clean (SUM(payouts this week) = 0):
    direction = -1 if risk_score > 50 else +1   -- pull toward neutral 50
    new_risk_score = CLAMP(risk_score + (direction × 2), 0, 100)
  
  FRAUD EVENT IMPACT (immediate):
    hard_flag confirmed: risk_score += 30 immediately
    fraud investigation confirmed: risk_score = 100

  Re-evaluate risk_profile from new risk_score.
  Store history in rider_risk_scores table for audit.

UPDATE SCHEDULE: Monday 00:05 IST (after premium debit, before riders wake)
```

### 4.3 Income Baseline Verification

```
EFFECTIVE INCOME FORMULA:
  effective_income = MIN(
    declared_income,
    platform_reported_avg  (if available from platform API),
    telemetry_inferred_income × 1.20  (20% buffer for undercount)
  )

  If only declared income available (new rider, no telemetry history):
    effective_income = MIN(declared_income, city_median_income)

TELEMETRY-INFERRED INCOME (computed weekly by ml-service):
  inferred_income = avg_shift_hours_per_day
                  × (movement_events_per_hour × 0.40)  -- 40% = deliveries
                  × city_avg_order_value
  
  city_avg_order_value: ₹70 (Mumbai, Bangalore), ₹65 (Delhi), ₹60 (others)
  Stored in riders.telemetry_inferred_income

DEVIATION CAP (anti-gaming):
  IF rider requests income update:
    change_pct = (new_declared - current_effective) / current_effective
    IF change_pct > 0.30: flag for manual review, hold 2 weeks
  
  Monthly reconciliation:
    IF platform_reported_avg < effective_income × 0.70:
      effective_income = MIN(effective_income, platform_reported_avg × 1.10)
      Max downward adjustment: 20% per month
      Notify rider: "Your coverage has been adjusted to reflect recent earnings."

  Cap at onboarding:
    declared_income bounds: ₹200 ≤ declared ≤ ₹2,500 per day
    IF declared > ₹1,500: require platform screenshot for verification
    IF no screenshot: effective_income = MIN(declared, city_median) until verified
```

### 4.4 ML Vulnerability Index

```
MODEL: GradientBoostingRegressor (scikit-learn)
OUTPUT: vulnerability_idx ∈ [0.0, 1.0] per H3 zone per week

TRAINING LABEL:
  disruption_occurred = 1 if (oracle_score >= 0.75 AND payouts_released >= 3)
                           in that H3 zone in that week

FEATURES (per H3 zone per week):
  Weather:
    avg_rainfall_mm_hr_last_4wk      FLOAT
    max_rainfall_mm_hr_last_4wk      FLOAT
    rainfall_variance_last_4wk       FLOAT
    wet_bulb_temp_avg_last_4wk       FLOAT
    aqi_avg_last_4wk                 FLOAT

  Geographic:
    drainage_index                   FLOAT (0–1)
    elevation_m                      FLOAT (from SRTM DEM)
    distance_to_water_body_km        FLOAT
    is_low_lying                     BINARY
    urban_density_score              FLOAT

  Historical:
    trigger_count_last_12wk          INTEGER
    trigger_count_same_week_last_yr  INTEGER
    avg_oracle_score_last_12wk       FLOAT
    flood_advisory_count_last_yr     INTEGER

  Temporal:
    week_of_year                     INTEGER (1–52)
    is_monsoon_season                BINARY (weeks 22–40)
    is_winter_pollution_season       BINARY (weeks 42–52)

TRAINING DATA QUALITY FILTERS (anti-poisoning):
  INCLUDE only:
    trigger_events.oracle_score >= 0.75  (high confidence)
    trigger_events.status = 'resolved'
    COUNT(payouts WHERE trigger_id = :id AND razorpay_status='success') >= 3
  
  EXCLUDE:
    h3_index where > 20% hard_flagged claims in trigger window
    trigger_events flagged 'disputed_authenticity' by admin
    h3_index with > 2 fraud investigations opened in last 90 days

POISONING DETECTION (monthly, before retraining):
  IF any H3 zone shows > 3× normal trigger frequency → exclude + alert
  IF any H3 appears for first time with high frequency → flag + investigate

EVALUATION METRICS:
  Primary: Brier Score < 0.15
  Secondary: AUC-ROC > 0.78
  Fallback if metrics fail: use previous month's model

CITY-LEVEL FALLBACK (when zone has < 500 training rows):
  Mumbai: 0.65, Delhi: 0.55, Kolkata: 0.60, Bangalore: 0.40, Chennai: 0.45, Others: 0.40

RETRAIN SCHEDULE: Monthly (1st of month, 02:00 UTC)
```

---

## 5. Pricing Engine

### 5.1 Unified Premium Formula

```
P_final = P_base × city_multiplier × λ × β × risk_multiplier × recent_trigger_factor

Applied in strict left-to-right order. Never reorder.

─────────────────────────────────────────────────────
P_base = (Prob_disruption × expected_payout) + Admin + Margin

  Prob_disruption   = vulnerability_idx from zone_risk_cache (ML model output)
  expected_payout   = effective_income × coverage_pct × 0.50
                      (0.5 = assumed avg disruption = 4hr of 8hr shift)
  Admin             = 0.15 × (Prob_disruption × expected_payout)
  Margin            = 0.10 × (Prob_disruption × expected_payout)
  So: P_base = (Prob_disruption × expected_payout) × 1.25

─────────────────────────────────────────────────────
city_multiplier = hubs.city_multiplier (from seeded table)

─────────────────────────────────────────────────────
λ (occupancy surge) = MIN(MAX(λ_floor, 1.0 + (active_count / hub_capacity)), 2.0)

  active_count = SELECT COUNT(*) FROM policies
                 WHERE hub_id = :hub_id
                   AND status = 'active'
                   AND h3_index_res9 = hub.h3_index_res9

  hub_capacity = hubs.capacity (admin-configurable, default 100)
  
  λ_floor = from system_config 'lambda_floor' (default 1.0, increases under RED loss ratio)
  HARD CAP: λ ≤ 2.0 always

─────────────────────────────────────────────────────
β (behavior multiplier) = 1.0 - (0.05 × discount_weeks)

  discount_weeks ∈ {0, 1, 2, 3, 4}
  β range: [0.80, 1.00]
  See Section 6 for discount_weeks update logic.

─────────────────────────────────────────────────────
risk_multiplier:
  'low':    0.95
  'medium': 1.00
  'high':   1.15

─────────────────────────────────────────────────────
recent_trigger_factor = MIN(1.0 + (recent_trigger_count × 0.05), 1.40)

  recent_trigger_count = SELECT COUNT(*) FROM trigger_events
    WHERE h3_index = rider.hub.h3_index
      AND triggered_at >= NOW() - INTERVAL '30 days'
      AND status = 'resolved'
      AND oracle_score >= 0.70

  Riders who claimed in 3 of last 4 weeks: factor × 1.10 additional
  COMBINED MAX: 1.40 before monthly ML recalibration catches up.

─────────────────────────────────────────────────────
COMPLETE CONCRETE EXAMPLE:
  Rider: ₹800/day, Standard plan, Tier A (75%), Mumbai, hub at 80% capacity,
         2 clean weeks, medium risk, zone had 2 events last 30d

  P_base:
    vulnerability_idx = 0.35 (Mumbai Standard zone)
    expected_payout = 800 × 0.75 × 0.5 = ₹300
    P_base = (0.35 × 300) × 1.25 = 105 × 1.25 = ₹131.25

  After city:    131.25 × 1.35             = ₹177.19
  After λ:       177.19 × MIN(1+(80/100), 2.0) = 177.19 × 1.80 = ₹318.94
  After β:       318.94 × (1 - 0.05×2)    = 318.94 × 0.90 = ₹287.05
  After risk:    287.05 × 1.00             = ₹287.05
  After recent:  287.05 × (1 + 2×0.05)    = 287.05 × 1.10 = ₹315.75

  P_final = ₹315.75/week
```

### 5.2 Adaptive Rain Threshold Per Hub

```
rain_threshold_mm = 35.0 × (1 + (drainage_index - 0.5) × 0.6)

Examples:
  drainage_index = 0.2 (poor, flood-prone):  35.0 × 0.82 = 28.7 mm/hr
  drainage_index = 0.5 (average):            35.0 × 1.00 = 35.0 mm/hr
  drainage_index = 0.8 (excellent):          35.0 × 1.18 = 41.3 mm/hr

Bounds: [base × 0.60, base × 1.50] = [21.0, 52.5]

Monthly recalibration:
  false_positive_rate = COUNT(triggers where no payout) / COUNT(total triggers)
  IF false_positive_rate > 20%: threshold × 1.05 (increase — too sensitive)
  IF miss_rate > 15%: threshold × 0.95 (decrease — missing real events)
  Stored back to hubs.rain_threshold_mm
```

---

## 6. Discount Engine

### 6.1 β_behavior — Complete Logic

```
STATE: policies.discount_weeks (INTEGER, 0–4, DEFAULT 0)

MONDAY UPDATE (runs 00:01 IST before premium debit):

  week_total = SELECT COALESCE(SUM(amount), 0)
               FROM payouts
               WHERE rider_id = policy.rider_id
                 AND released_at >= policy.week_start_date
                 AND released_at < policy.week_start_date + INTERVAL '7 days'

  IF week_total = 0:
    policy.discount_weeks = MIN(policy.discount_weeks + 1, 4)
  ELSE:
    policy.discount_weeks = 0

CRITICAL RULE: "Any payout" means ANY row in payouts for this rider this week.
  This includes: auto-cleared, provisional, continuation, VOV reward, goodwill credit.
  There are NO exceptions. If amount > 0 → week_total > 0 → reset to 0.

β = 1.0 - (0.05 × discount_weeks)

PROGRESSION TABLE:
  discount_weeks | β    | Discount | P_final effect
  0              | 1.00 | 0%       | base rate (new/just claimed)
  1              | 0.95 | 5% off   |
  2              | 0.90 | 10% off  |
  3              | 0.85 | 15% off  |
  4              | 0.80 | 20% off  | maximum discount (floor)

β range: [0.80, 1.00] — never below 0.80, never above 1.00.

RESET SCENARIOS (all resolve to discount_weeks = 0):
  - Any payout row inserted (initial, continuation, provisional, remainder)
  - Goodwill credit issued
  - VOV reward issued
  - Upheld dispute payout released
  All of these are real money movements. The rule is absolute.

FRAUD FREEZE:
  Any hard_flag confirmed: β resets to 1.0 AND discount cannot improve for 14 days.
  Track: riders.beta_freeze_until TIMESTAMPTZ
  During freeze: skip the increment step even if week is clean.
```

---

## 7. Trigger Engine — All 6 Triggers

### 7.1 Oracle Weight Model

```
BASE WEIGHTS (no supplementary signals):
  Satellite: 40%  |  Weather: 30%  |  Traffic/Social: 30%
  oracle_score = (0.40 × satellite_score) + (0.30 × weather_score) + (0.30 × traffic_score)

PEER CONSENSUS ACTIVE (>15% of insured riders in hex reporting; min 3 absolute):
  Satellite: 35%  |  Weather: 25%  |  Traffic: 20%  |  Peer: 20%
  oracle_score = (0.35×sat) + (0.25×weather) + (0.20×traffic) + (0.20×peer_score)
  peer_score = CLAMP(reporting_count / insured_count_in_hex, 0.0, 1.0)

ACCELEROMETER ACTIVE (rider stationary 20+ min during trigger window):
  Satellite: 35%  |  Weather: 25%  |  Traffic: 20%  |  Accel: 20%
  oracle_score = (0.35×sat) + (0.25×weather) + (0.20×traffic) + (0.20×accel_score)
  accel_score: 1.0 if stationary 20+ min, 0.0 if moving

BOTH SUPPLEMENTARY ACTIVE:
  Satellite: 30%  |  Weather: 20%  |  Traffic: 15%  |  Peer: 20%  |  Accel: 15%
  oracle_score = (0.30×sat) + (0.20×weather) + (0.15×traffic) + (0.20×peer) + (0.15×accel)

VOV ACTIVE (individual rider submitted confirmed video — individual claim only):
  Satellite: 40%  |  Weather: 30%  |  VOV: 30%
  individual_oracle = (0.40×sat) + (0.30×weather) + (0.30×vov_confidence)
  NOTE: VOV replaces traffic slot for THIS RIDER'S claim only.
  Zone-level peer consensus still contributed to zone oracle independently.

ALL WEIGHTS ALWAYS SUM TO 1.0. Never add flat bonuses on top.
```

### 7.2 Oracle Decision Thresholds

```
COLD START MODE (zone has < 20 confirmed trigger events in 6 months):
  oracle_threshold = 0.75 (stricter — less data = more conservative)
  confidence_scaling = DISABLED (pay full payout if triggered)
  adaptive_thresholds = DISABLED (use city defaults)
  vov_cert_min_confirmed = 3 (reduced from 5)
  ML vulnerability_idx = city_avg_vulnerability (not hex-specific)

NORMAL MODE (zone has >= 20 confirmed events):
  oracle_threshold = 0.65 (from system_config, adjustable via Experiments tab)
  
DECISION TABLE:
  oracle_score >= oracle_threshold → auto-clear (to fraud scoring)
  0.30 ≤ oracle_score < oracle_threshold → escalate to VOV (not denied)
  oracle_score < 0.30 → deny (event not confirmed, no VOV offered)
```

### 7.3 Cooldown Logic

```
After any trigger event resolves with payouts issued:
  cooldown_until = trigger.resolved_at + cooldown_minutes

cooldown_minutes by type:
  rain:          90 minutes
  flood:         240 minutes
  heat:          120 minutes
  aqi:           120 minutes
  bandh:         180 minutes
  platform_down: 60 minutes

Before creating new trigger_events row:
  existing = SELECT id, status FROM trigger_events
             WHERE h3_index = :hex AND trigger_type = :type
             AND (status IN ('active','resolving')
                  OR (status = 'resolved'
                      AND resolved_at >= NOW() - INTERVAL '{cooldown_min} min'))
             LIMIT 1

  IF existing AND status IN ('active','resolving'):
    → Treat as continuation of existing event (extend, do not create new row)
  
  IF existing AND status = 'resolved' (within cooldown):
    → Create new trigger_events with cooldown_active=true
    → cooldown_payout_factor = 0.50 (50% payout reduction)
  
  IF none:
    → Create fresh trigger_events row normally, cooldown_payout_factor = 1.00
```

### 7.4 Duplicate Trigger Protection

```
Before creating ANY trigger_events row:
  SELECT id FROM trigger_events
  WHERE h3_index = :hex
    AND trigger_type = :type
    AND triggered_at >= NOW() - INTERVAL '15 min'  -- within one oracle loop
  
  IF exists → SKIP → return existing trigger_id
  (same oracle loop cannot create duplicate triggers for same hex+type)
```

### 7.5 Multi-Trigger Stacking Rule

```
RULE: Rider receives payout for the SINGLE HIGHEST-VALUE trigger only.
      No stacking. No additive payouts.

ALGORITHM:
  active_triggers = SELECT trigger_id, trigger_type, oracle_score
    FROM trigger_events
    WHERE h3_index = rider.hub.h3_index
      AND status IN ('active','resolving')
      AND trigger_type IN (SELECT covered_triggers FROM plan WHERE plan=rider.plan)
    ORDER BY triggered_at

  IF COUNT = 1: proceed normally

  IF COUNT > 1:
    FOR each trigger: compute event_payout (Section 9.1)
    winning = trigger with MAX(event_payout)
    
    IF tie: use priority order:
      1. flood  2. platform_down  3. bandh  4. rain  5. aqi  6. heat
    
    Create ONE claim for winning trigger only.
    Store: claims.competing_triggers = JSONB of suppressed trigger_ids+types
    Suppressed triggers: log as 'suppressed_by_stacking', no claim.
    
  CONTINUATION: if winning trigger resolves but another still active →
    start new claim for next-highest trigger from that point.
    No coverage gap for rider.
```

### 7.6 Correlation Factor

```
CORRELATION FACTOR C (city-level, per active trigger event):

  total_hexes = SELECT COUNT(DISTINCT h3_index_res9) FROM hubs WHERE city = :city
  active_hexes = SELECT COUNT(DISTINCT h3_index) FROM trigger_events
                 WHERE status IN ('active','resolving')
                   AND triggered_at >= NOW() - INTERVAL '2 hours'
                   AND hub_id IN (SELECT id FROM hubs WHERE city = :city)

  C = active_hexes / total_hexes

PAYOUT FACTOR (applied to all payouts during correlated events):
  C <= 0.20 → payout_factor = 1.00
  C <= 0.40 → payout_factor = 0.90
  C <= 0.60 → payout_factor = 0.80
  C >  0.60 → payout_factor = 0.70

  Store: trigger_events.correlation_factor = C

PLATFORM DOWN SPECIAL CASE:
  platform_down is always 100% correlated across all policies on that platform.
  C = 1.0 always for platform_down → payout_factor = 0.70.
  Disclosed in plan terms.

RIDER COMMUNICATION when payout_factor < 1.0:
  "A city-wide disruption affected {N} zones simultaneously.
   Your payout reflects shared coverage: ₹{actual}.
   This protects the fund for all {total_riders} insured riders in {city}."
```

### 7.7 Ongoing Event Duration Tracking

```
INITIAL PAYOUT (trigger fires at T=0):

  minimum_duration by type:
    rain:          1.0 hour
    flood:         2.0 hours
    heat:          2.0 hours
    aqi:           1.0 hour
    bandh:         2.0 hours
    platform_down: 0.5 hours

  mu_initial = MU_TABLE[EXTRACT(HOUR FROM trigger.triggered_at AT TIME ZONE 'Asia/Kolkata')]
  initial_payout = effective_income × coverage_pct × (min_duration/8) × mu_initial
  Apply headroom cap (Section 9.2). Pay. Set trigger_events.status = 'active'.

CONTINUATION LOOP (every 30 minutes while trigger is active):

  Re-fetch all API signals for H3 zone.
  Recompute oracle_score.
  
  IF oracle_score >= 0.50:
    event still active
    mu_current = MU_TABLE[current_ist_hour]  ← always current hour, not initial
    continuation_payout = effective_income × coverage_pct × (0.5/8) × mu_current
    
    Check shift state: IF rider.shift_state = 'offline' → SKIP payout for this rider
    (rider went home — stop paying continuation for them)
    
    Apply headroom cap. If headroom > 0: pay + update weekly_payout_used.
    Check event_cap: if event_total >= single_event_cap → STOP continuation.
  
  IF oracle_score < 0.50:
    trigger_events.status = 'resolving'
    (second consecutive check confirms → status = 'resolved')

TEMPORAL MULTIPLIER TABLE (all 24 hours defined):
  MU_TABLE = {
    0: 0.50, 1: 0.50, 2: 0.50, 3: 0.50, 4: 0.50, 5: 0.50,
    6: 0.70, 7: 0.70,
    8: 1.50, 9: 1.50, 10: 1.50,
    11: 1.00, 12: 1.00, 13: 1.00, 14: 1.00, 15: 1.00, 16: 1.00,
    17: 1.00, 18: 1.20,
    19: 1.50, 20: 1.50, 21: 1.50,
    22: 0.80, 23: 0.50
  }
  trigger_hour_ist = EXTRACT(HOUR FROM trigger.triggered_at AT TIME ZONE 'Asia/Kolkata')
```

---

## 8. Plan Engine — 3 Plans

### 8.1 Plan Definitions

| Plan | Weekly Base Premium | Triggers Covered | Coverage % (Tier A/B) | Weekly Cap Multiplier |
|---|---|---|---|---|
| `basic` | ₹29 | rain, bandh, platform_down | 50% / 50% | 3× daily income |
| `standard` | ₹49 | rain, bandh, platform_down, flood, aqi | 75% / 65% | 5× daily income |
| `pro` | ₹79 | rain, bandh, platform_down, flood, aqi, heat | 92% / 88% | 7× daily income |

**Plan Logic Rationale:**
- Basic: Three triggers cheapest to detect (OWM, HTTP health check, HERE Maps). High frequency.
- Standard: Adds flood (needs satellite + NDMA) and AQI (needs WAQI). Higher infra cost.
- Pro: Adds heatwave — rarest, hardest to verify (wet bulb temp), most arguable. Highest plan.

### 8.2 Plan Validation at Enrollment

```
SELECT covered_triggers FROM plan_config WHERE plan = :selected_plan
→ stored as JSONB on policy at creation
→ checked against trigger_type at every claim initiation
→ trigger NOT in covered_triggers → claim rejected with explanation_text
```

---

## 9. Payout Engine

### 9.1 Per-Event Payout Formula

```
STEP 1 — Determine mu_time:
  trigger_hour_ist = EXTRACT(HOUR FROM trigger.triggered_at AT TIME ZONE 'Asia/Kolkata')
  mu_time = MU_TABLE[trigger_hour_ist]

STEP 2 — Compute raw event_payout:
  event_payout = effective_income × coverage_pct × (duration_hrs / 8) × mu_time

  Where:
    effective_income  = riders.effective_income
    coverage_pct      = policies.coverage_pct (tier-adjusted)
    duration_hrs      = min_duration for trigger type (initial)
                     OR 0.5 per continuation period
    mu_time           = from MU_TABLE (current IST hour for continuation)

STEP 3 — Apply confidence scaling:
  oracle_score >= 0.85 → confidence_factor = 1.00
  oracle_score 0.75–0.84 → confidence_factor = 0.95
  oracle_score 0.65–0.74 → confidence_factor = 0.85

  confidence_adjusted_payout = event_payout × confidence_factor

STEP 4 — Apply correlation factor:
  post_corr_payout = confidence_adjusted_payout × trigger.correlation_factor

STEP 5 — Apply cooldown factor (if applicable):
  final_event_payout = post_corr_payout × trigger.cooldown_payout_factor

STEP 6 — Apply headroom cap:
  max_weekly_payout = effective_income × plan_cap_multiplier
  headroom = max_weekly_payout - policies.weekly_payout_used

  IF headroom <= 0:
    claims.status = 'cap_exhausted' → no payout
    Notify rider: "Weekly protection limit reached (₹{cap}).
    Coverage resets Monday. ₹0 available for new triggers this week."
    RETURN

  actual_payout = MIN(final_event_payout, headroom)

STEP 7 — Apply event cap:
  single_event_cap = max_weekly_payout × 0.50
  event_total_so_far = SELECT SUM(amount) FROM payouts
    WHERE claim_id IN (SELECT id FROM claims
                       WHERE trigger_id = :trigger_id AND rider_id = :rider_id)
  
  IF event_total_so_far >= single_event_cap:
    STOP continuation. log 'event_cap_reached'.
    Notify rider: "Coverage limit for this event reached (₹{single_event_cap}).
    ₹{remaining_weekly} weekly protection still available for new events this week."
    RETURN

STEP 8 — Apply daily soft limit:
  daily_soft_limit = max_weekly_payout / 4
  daily_total_today = SELECT SUM(amount) FROM payouts
    WHERE rider_id = :rider_id
      AND released_at >= date_trunc('day', NOW() AT TIME ZONE 'Asia/Kolkata')
  
  IF daily_total_today >= daily_soft_limit AND is_continuation (not initial):
    PAUSE continuation until next IST calendar day.
    Notify rider: "Daily coverage limit reached.
    Remaining weekly coverage of ₹{remaining} continues tomorrow."
    RETURN

STEP 9 — Update weekly_payout_used:
  policies.weekly_payout_used += actual_payout

STEP 10 — Insert payout and call Razorpay:
  (See Section 9.3 — Idempotent Razorpay Flow)
```

### 9.2 Graduated Payout Response

```
FRAUD SCORE THRESHOLDS:
  (adjusted for 'high' risk_profile — see Section 4.2)

  FS < auto_clear_threshold (default 0.40):
    status = 'auto_cleared'
    Release 100% of actual_payout within 60 seconds.
    No rider action required.

  auto_clear_threshold ≤ FS ≤ hard_flag_threshold (default 0.70):
    status = 'soft_flagged'
    Release 70% of actual_payout immediately.
    Notify rider: "Claim under standard verification."
    Remaining 30% releases in 2 hours if no escalation.
    VOV prompt offered to accelerate full release.
    Zero penalty if cleared.

  FS > hard_flag_threshold (default 0.70):
    status = 'hard_flagged'
    Full payout HELD.
    Notify rider: "Your claim is being reviewed. Decision in 4 hours."
    One-tap VOV upload offered.
    If cleared: full payout + goodwill credit (₹20–₹50).
    If confirmed fraud: status='rejected', account suspended,
    device_fingerprint added to blacklisted_devices.
```

### 9.3 Idempotent Razorpay Payout Flow

```
STEP 1: Generate idempotency key
  key = SHA-256(claim_id + ':' + payout_type + ':' + str(amount))

STEP 2: Check for existing payout
  existing = SELECT id, razorpay_status FROM payouts
             WHERE idempotency_key = :key LIMIT 1
  IF existing:
    IF razorpay_status = 'success': return existing (already paid, skip)
    IF razorpay_status IN ('processing','circuit_breaker_hold'): wait, do not retry now
    IF razorpay_status = 'failed': proceed to retry Razorpay only

STEP 3: INSERT payout row BEFORE calling Razorpay
  INSERT INTO payouts (claim_id, rider_id, policy_id, amount, payout_type,
                       idempotency_key, razorpay_status='initiated', released_at=NOW())
  ON CONFLICT (idempotency_key) DO NOTHING
  -- UNIQUE constraint catches race conditions

STEP 4: Call Razorpay (via circuit breaker)
  try:
    response = razorpay_cb.call(POST /v1/payouts, {
      account_number: RAZORPAY_ACCOUNT,
      fund_account_id: rider.razorpay_fund_account_id,
      amount: int(actual_payout × 100),  -- paise
      currency: "INR",
      mode: "UPI",
      purpose: "payout",
      queue_if_low_balance: true,
      reference_id: key,
      narration: "GigShield Income Protection"
    })
    UPDATE payouts SET razorpay_ref=response.id, razorpay_status='processing'
    WHERE idempotency_key = :key
  except CircuitOpenError:
    UPDATE payouts SET razorpay_status='circuit_breaker_hold'
    redis.zadd('payout_recovery_queue', {key: time.time()})
    notify_rider('payout_queued', eta_hours=0.5)
  except Exception:
    UPDATE payouts SET razorpay_status='failed'
    queue_retry(claim_id, payout_type, attempt=1)

STEP 5: Webhook receives payout.processed / payout.failed
  POST /webhooks/razorpay
  Verify: HMAC-SHA256(body, RAZORPAY_WEBHOOK_SECRET)
  
  Check webhook idempotency:
    SELECT id FROM webhook_events WHERE event_id = :razorpay_event_id
    IF exists: SKIP (Razorpay retries webhooks)
  
  INSERT INTO webhook_events (event_id, event_type, payload, processed=false)
  
  IF event_type = 'payout.processed':
    UPDATE payouts SET razorpay_status='success', reconcile_status='matched'
    UPDATE claims SET paid_at=NOW() (for auto_cleared)
    Trigger downstream notifications
  
  IF event_type = 'payout.failed':
    UPDATE payouts SET razorpay_status='failed'
    queue_retry(attempt+1)
  
  IF event_type = 'payout.reversed':
    UPDATE payouts SET razorpay_status='reversed'
    Alert admin + rider. Re-initiate payout if not fraud.

RETRY SCHEDULE:
  attempt 1: 5 min after failure
  attempt 2: 15 min after attempt 1
  attempt 3: 45 min after attempt 2
  after attempt 3 fails: status='failed_permanent' → manual_queue → admin alert

PREMIUM DEBIT GUARD (double-debit protection):
  Before Monday debit for any policy:
    existing = SELECT id FROM payouts
               WHERE policy_id = :id
                 AND payout_type = 'premium_debit'
                 AND released_at >= date_trunc('week', NOW())
    IF exists: SKIP (already debited this week — cron restart protection)
```

---

## 10. Fraud & Trust Engine

### 10.1 Three-Factor Intent-to-Work Check

```
ALL THREE factors must be satisfied within 60 min before trigger fires.
Fail any one → intent FAILED → fraud_score = 1.0 → hard-flag → STOP.

FACTOR 1 — GPS Movement Pattern:
  pings = SELECT latitude, longitude, speed_kmh, recorded_at
    FROM telemetry_pings
    WHERE rider_id = :rider_id
      AND recorded_at BETWEEN (trigger.triggered_at - INTERVAL '60 min')
                          AND trigger.triggered_at
    ORDER BY recorded_at

  PASS if:
    COUNT(pings) >= 3
    AND NOT (all pings within 50m radius AND all speed_kmh < 2.0
             for more than 45 consecutive minutes)
    -- (stationary at residential for 45+ min = off-duty)

FACTOR 2 — App Active Session:
  session_pings = SELECT COUNT(*) FROM telemetry_pings
    WHERE rider_id = :rider_id
      AND session_active = true
      AND recorded_at BETWEEN (trigger.triggered_at - INTERVAL '60 min')
                          AND trigger.triggered_at

  PASS if: COUNT(session_pings) >= 1
  -- App heartbeat every 5 min; sleeping phone pauses after ~20 min

FACTOR 3 — Platform Activity Signal:
  platform_response = platform_adapter.get_rider_status(rider_id, trigger.triggered_at)
  
  IF platform_response IS NOT NULL:
    PASS if: platform_response.status IN ('available', 'on_delivery')
             AND platform_response.last_seen >= trigger.triggered_at - INTERVAL '60 min'
    FAIL if: platform_response.status = 'offline'
  
  IF platform_response IS NULL (platform API unavailable):
    claims.intent_platform_unavailable = true
    Proceed with Factors 1+2 only.
    Claim soft-flagged instead of auto-clear (regardless of fraud score).

COMBINED INTENT:
  intent_passed = factor1_gps AND factor2_session AND factor3_platform (or N/A)
  IF NOT intent_passed: fraud_score = 1.0 → hard-flag → STOP (no presence check needed)
```

### 10.2 Fraud of Presence Check

```
pings = last 3 GPS pings before trigger

FOR each ping:
  distance_km = haversine(ping.lat, ping.lng, hub.latitude, hub.longitude)
  h3_of_ping  = h3.latlng_to_cell(ping.lat, ping.lng, resolution=9)

match_count = COUNT(pings WHERE distance_km <= hub.radius_km
                             OR h3_of_ping = hub.h3_index_res9
                             OR h3_of_ping IN adjacent_h3_cells(hub.h3_index_res9))

presence_confidence:
  3 of 3 match → 1.00
  2 of 3 match → 0.67
  1 of 3 match → 0.33 (PRESENCE CHECK FAILS — minimum threshold is 2+)
  0 of 3 match → 0.00 (immediate hard-flag)

GPS VELOCITY SPOOFING BLOCK:
  FOR each consecutive ping pair:
    time_delta_hrs = (ping2.recorded_at - ping1.recorded_at).total_seconds() / 3600
    distance_km    = haversine(ping1, ping2)
    implied_speed  = distance_km / time_delta_hrs
    IF implied_speed > 150: fraud_score = 1.0 → hard-flag → STOP immediately
```

### 10.3 Fraud Score Formula

```
HARD GATES (any fail = fraud_score = 1.0, hard-flag, STOP ALL processing):
  Gate 1: implied_speed > 150 km/h between any two pings
  Gate 2: intent_check failed (any factor, excluding N/A platform)
  Gate 3: EXIF GPS mismatch on VOV video
  Gate 4: EXIF timestamp mismatch on VOV video
  Gate 5: Bundle integrity hash mismatch

SOFT SCORE (only if all gates pass AND presence_confidence >= 0.67):

  fraud_score = 1.0 - (0.60 × oracle_confidence + 0.40 × presence_confidence)

  WHERE:
    oracle_confidence  = trigger.oracle_score (zone-level Bayesian posterior)
    presence_confidence = from Section 10.2 (0.0, 0.33, 0.67, or 1.00)

  The 60/40 split means:
    Real flood, wrong location (oracle=0.90, presence=0.20):
      FS = 1.0 - (0.60×0.90 + 0.40×0.20) = 1.0 - 0.62 = 0.38 → soft-flag
    Real flood, correct location (oracle=0.90, presence=1.00):
      FS = 1.0 - (0.60×0.90 + 0.40×1.00) = 1.0 - 0.94 = 0.06 → auto-clear
    Marginal oracle, correct location (oracle=0.67, presence=1.00):
      FS = 1.0 - (0.60×0.67 + 0.40×1.00) = 1.0 - 0.80 = 0.20 → auto-clear

THRESHOLD APPLICATION:
  Default: auto_clear < 0.40, hard_flag > 0.70 (adjustable via Experiments tab)
  'high' risk_profile: auto_clear < 0.30, hard_flag > 0.60
```

### 10.4 VOV — Complete Two-Stage Architecture

```
STAGE 1: ZONE CERTIFICATION (aggregate — all riders in hex benefit)

Trigger: Zone oracle_score between 0.30 and (oracle_threshold - 0.01)
System prompts eligible riders in hex with optional video upload.
Window: trigger.triggered_at to trigger.triggered_at + 3 hours

Every 10 minutes while zone is 'uncertain':
  SELECT
    COUNT(*) FILTER (WHERE cv_confidence >= 0.70) AS confirmed,
    COUNT(*) AS submitted,
    AVG(cv_confidence) FILTER (WHERE cv_confidence >= 0.70) AS avg_conf
  FROM claim_evidence
  WHERE h3_index = :hex
    AND created_at >= trigger.triggered_at
    AND created_at <= trigger.triggered_at + INTERVAL '3 hours'

CERTIFICATION CONDITION (BOTH must be true):
  confirmed >= 5           (absolute minimum — prevents 2-person collusion)
  confirmed / submitted >= 0.80  (80% confirmation ratio)

IF CERTIFIED:
  UPDATE zone_vov_certs: certified=true, certified_at=NOW(), expires_at=NOW()+2hr
  UPDATE trigger_events: vov_zone_certified=true, vov_cert_score=avg_conf
  
  NEW ORACLE SCORE for all riders in hex:
    certified_oracle = (0.40×satellite) + (0.30×weather) + (0.30×avg_conf)
  
  FOR ALL active policies in hex (batch):
    IF intent_check PASSED (run individually)
    AND presence_check PASSED (run individually)
    THEN initiate_claim(rider, trigger, certified_oracle)
  
  VOV contributors: set claim_evidence.contributed_to_zone_cert = true
  Issue VOV zone-cert reward (₹20) for each contributor

STAGE 2: INDIVIDUAL VOV (rider's own claim, zone not certified)

IF zone not certified AND individual oracle < oracle_threshold:
  Prompt: "Our sensors couldn't fully confirm the disruption in your area.
  A 10-second video will help verify your claim and release your payout faster."

VOV FRAUD CHECKS (cheap — run BEFORE YOLOv8):

  EXIF GPS:
    exif_gps = extract from video using hachoir/exifread
    h3_of_video = h3.latlng_to_cell(exif_gps.lat, exif_gps.lng, resolution=9)
    IF h3_of_video != claim.h3_index → EXIF mismatch → hard-gate → reject

  EXIF Timestamp:
    trigger_window = (trigger.triggered_at - 30min, trigger.triggered_at + 120min)
    IF exif_ts NOT IN trigger_window → reject

  Integrity:
    date_digitized = EXIF DateTimeDigitized
    date_modified  = ffprobe modification time
    IF ABS(date_digitized - date_modified) > 60 seconds → re-encoded → reject

IF all EXIF checks pass → YOLOv8n inference (Celery task):
  Target classes:
    rain/flood: rain streaks, standing water, wet road, submerged vehicles
    bandh:      crowds, barricades, protest banners, blocked roads
    gear:       Zepto bags, Blinkit shirts, delivery crates
  
  IF gear_detected: cv_confidence = MAX(cv_confidence, 0.95)
  
  IF cv_confidence >= 0.70:
    individual_oracle = (0.40×sat) + (0.30×weather) + (0.30×cv_confidence)
    This individual VOV also accumulates toward zone certification.
    Issue VOV individual reward:
      Case 1 (individual claim saved): ₹15
      Case 2 (zone cert contributor): ₹20
      Case 3 (cv ok but zone not certified): ₹10
      Max per event: ₹35 (if both Case 1 + Case 2)

TTL:
  After payout confirmed: set ttl_delete_at = NOW() + INTERVAL '48 hours'
  Hourly cron: DELETE video_url from Supabase Storage WHERE ttl_delete_at < NOW()
  Metadata (cv_confidence, exif fields) kept indefinitely for audit.
```

### 10.5 Connectivity Resilience — Offline Bundle Validation

```
MECHANISM: PWA Service Worker records pings locally during network loss.
On reconnect: submit bundle with original device timestamps.
telemetry_pings.is_bundle = true, bundle_hash = SHA-256(rider_id+timestamps+h3_array)

BUNDLE FRAUD CHECKS:

1. HASH INTEGRITY:
   Server recomputes SHA-256. If mismatch → reject entire bundle → hard-flag.

2. VELOCITY CHECK ACROSS BUNDLE:
   For each consecutive pair:
     implied_speed = haversine(p1, p2) / time_delta_hrs
     IF implied_speed > 150 → hard-flag entire bundle
   
   INTERVAL UNIFORMITY:
     std_dev = standard_deviation(time gaps between pings)
     IF std_dev < 0.5 seconds → suspiciously uniform → soft-flag
     (Real GPS has natural jitter; fabricated bundles have perfect spacing)

3. PLATFORM CROSS-REFERENCE:
   platform_response = platform_adapter.get_last_active(rider_id)
   IF platform shows 'offline' for ENTIRE bundle period → mismatch → soft-flag

4. H3 CONSISTENCY:
   All pings must be in same H3 cell or adjacent cell (one ring).
   IF any ping > 2 cells away from others → location jump → hard-flag.

GPS GAP TOLERANCE:
  Up to 8 minutes of no pings → bridge using last-known H3 cell (expected in storms).
  Gaps > 8 min → bundle submission required to cover gap.
```

### 10.6 Syndicate-Scale Liquidity Gate

```
IF claims from single H3 zone exceed 2× expected claim rate for active trigger:
  Excess claims held in escrow pending batch review.
  Processing order: ascending fraud_score (lowest-risk riders clear first).

TEMPORAL CLUSTERING:
  IF > 50 claims initiate in same 5-minute window from same H3:
    Route batch to admin review before payouts beyond first 20 release.

SOCIAL GRAPH FLAGGING:
  IF riders onboarded within same 48-hour window AND share IP prefix:
    Cross-reference at batch events. Clusters → soft-flag before individual scoring.
```

### 10.7 Geospatial Fraud Clustering

```
SIGNAL 1 — Enrollment Density Spike (daily check):
  SELECT h3_index, COUNT(*) AS enroll_today
  FROM riders WHERE created_at >= NOW() - INTERVAL '24 hours'
  GROUP BY h3_index
  HAVING COUNT(*) > (baseline_avg × 3)
  → Soft-flag new riders from that hex. Require Aadhaar KYC before activation.

SIGNAL 2 — Simultaneous Claim Burst:
  claim_burst = COUNT(claims WHERE initiated_at BETWEEN :t AND :t+5min AND h3_index=:hex) > 50
  IF burst AND riders share:
    same device_fingerprint prefix (first 8 chars)
    OR same IP /24 subnet
    OR enrolled within same 48hr
    OR same bank_account_hash prefix
  → syndicate_suspected = true → freeze ALL burst claims → admin review

SIGNAL 3 — Device/IP Graph:
  At enrollment: build edges between riders sharing device_fingerprint OR IP_prefix
  IF connected component size > 10:
    riders.syndicate_suspect_group_id = shared UUID
    Any claim from these riders requires VOV regardless of oracle score.

SIGNAL 4 — Payout Destination Clustering:
  IF > 5 riders in same hex share bank_account_hash prefix:
    Hard-block simultaneous payouts. One at a time, 30-min gaps.

SCHEMA:
  fraud_clusters table (cluster_type, rider_ids[], h3_index, status, admin_note)
  riders.syndicate_suspect_group_id UUID (null if not suspected)
  riders.enrollment_ip_prefix TEXT (/24 subnet hash)
```

### 10.8 Explainability Report

```
RIDER-FACING (simplified):
  Maps highest-weight fraud signal to plain English.

  IF hard gate failed:
    velocity > 150:  "Claim held: GPS showed movement inconsistent with delivery riding."
    intent Factor 1: "Claim held: No GPS activity detected in the 60 minutes before the event."
    intent Factor 2: "Claim held: Your app was not active before the disruption."
    intent Factor 3: "Claim held: Your platform account showed you as offline."
    EXIF mismatch:   "Claim held: The video submitted was not recorded at your zone."
  
  IF soft score > threshold:
    low presence:    "Claim held: Your location could not be confirmed at the affected zone."
    low oracle:      "Claim held: Our sensors could not confirm a disruption in your area."
  
  IF auto-cleared:   "Payout of ₹{amount} confirmed. {trigger_type} detected in your zone."

ADMIN-FACING (full trace in claims.admin_trace JSONB):
  {
    rider: {tier, risk_profile, effective_income, discount_weeks, shift_state_at_trigger},
    intent_check: {factor1_gps: {...}, factor2_session: {...}, factor3_platform: {...}},
    presence_check: {pings_matched, distances_km, velocity_check, presence_confidence},
    oracle: {weight_config, weights, scores, raw_api, oracle_score, api_sources, confidence_penalties},
    fraud: {fraud_score, hard_gates, formula_used},
    payout: {event_payout_raw, confidence_factor, correlation_factor, cooldown_factor,
             single_event_cap_remaining, daily_soft_limit_remaining,
             weekly_headroom, actual_payout}
  }
```

### 10.9 Proof of Oracle — Transparency UI

```
GET /api/v1/claims/{claim_id}/proof (rider-facing)

Response (rider never sees raw fraud_score):
{
  "trigger_type": "rain",
  "payout": 420.00,
  "location": "Andheri, Mumbai",
  "layers": {
    "intent":   {"passed": true, "summary": "GPS active, app open, platform online"},
    "location": {"passed": true, "pings_in_zone": 3, "speed_normal": true},
    "oracle":   {"score": 0.81, "satellite": 0.90, "weather": 0.72, "traffic": 0.68},
    "vov":      {"required": false, "status": "N/A"}
  },
  "payout_breakdown": {
    "income": 800, "coverage": "70%", "duration_hrs": 2, "mu": 1.5,
    "confidence_factor": 1.0, "correlation_factor": 1.0,
    "final": 420.00
  },
  "explanation": "Payout of ₹420 confirmed. Heavy rain detected in your zone.",
  "paid_at": "2026-06-18T14:47:00+05:30"
}
```


---

## 11. Policy Lifecycle Management

### 11.1 State Machine

```
States: active | paused | lapsed | cancelled
Claim sub-flow: disputed (on claims, not policies)

Valid transitions:
  active   → paused    (rider taps "Pause Policy")
  paused   → active    (rider taps "Resume" OR auto-resume after 7 days)
  active   → cancelled (rider taps "Cancel Policy")
  active   → lapsed    (Razorpay debit fails)
  lapsed   → active    (retry debit succeeds within 48hr grace)
  lapsed   → cancelled (retry fails after 48hr)
  cancelled → active   (rider re-enrolls as new policy — new policy_id)
```

### 11.2 Active State

```
Default state after onboarding. All features enabled:
  - UPI mandate debits every Monday 00:01 IST
  - Oracle monitoring runs continuously for rider's hub hex
  - Claims eligible at any time (if shift_state = active or idle)
  - Continuation payouts issue for ongoing events
```

### 11.3 Paused State

```
RULES:
  Max 2 pauses per quarter (policies.pause_count_qtr)
  Quarter resets: 1st Jan, 1st Apr, 1st Jul, 1st Oct (pg_cron)
  
  CANNOT pause if: active trigger event currently firing in rider's hex.
  API returns 400: "Cannot pause during an active disruption event."
  
  During pause:
    UPI mandate SKIPPED (not revoked)
    No premium debit
    No claims eligible
  
  On resume: mandate picks up at next Monday cycle.

WEEKLY CAP INTERACTION (CRITICAL):
  The Monday-Sunday cap window advances EVERY Monday regardless of pause status.
  policies.week_start_date advances every Monday (by pg_cron).
  policies.weekly_payout_used resets to 0 every Monday (by pg_cron).
  Paused days DO NOT extend the cap window.
  A rider cannot "bank" unused cap by pausing.
```

### 11.4 Cancelled State

```
TRIGGER: Rider taps "Cancel Policy"

REFUND RULES:
  Cancellation within 24hr of Monday debit: refund 80% (20% admin fee retained)
    refund_amount = policies.weekly_premium × 0.80
    idempotency_key = SHA-256(policy_id + ':' + cancelled_at + ':refund')
    Trigger Razorpay refund API
  
  Cancellation after 24hr: no refund (Oracle was monitoring, risk was real)

ON CANCEL:
  policies.status = 'cancelled', policies.cancelled_at = NOW()
  Razorpay mandate revoked via API
  policy_id ARCHIVED (never deleted — fraud detection requires history)
  riders.device_fingerprint RETAINED (checked on any re-enrollment)
  INSERT INTO admin_audit_log (action='policy_cancelled', ...)
```

### 11.5 Lapsed State

```
TRIGGER: Razorpay debit fails (low balance, mandate expired, network error)

IMMEDIATE:
  policies.status = 'lapsed'
  All claims suspended (no new claims)
  Notify rider: push + SMS "Payment failed. 48-hour grace period. Tap to update."

GRACE PERIOD:
  T+24hr: Razorpay mandate retry attempt #1
    idempotency_key = SHA-256(policy_id + ':' + week_start_date + ':debit_retry_1')
    Success → policies.status = 'active', resume normally
  
  T+48hr: If still lapsed → retry #2
    Success → active. Failure → policies.status = 'cancelled' (full cancellation flow)
```

### 11.6 Disputed Sub-Flow (on Claims)

```
TRIGGER: Rider taps "Dispute this decision" on hard-flagged or denied claim.

RATE LIMIT: Max 2 disputes per week per rider.
  3rd attempt → HTTP 429: "Dispute limit reached this week."

PROCESS:
  INSERT INTO disputes:
    claim_id, rider_id, reason_text, status='open',
    sla_deadline = NOW() + INTERVAL '72 hours'
  
  Admin sees in God Mode fraud queue with SLA countdown.
  
  UPHELD:
    UPDATE disputes SET status='resolved_upheld', resolved_at=NOW()
    goodwill_credit = ₹20 (soft-flag cleared) or ₹50 (hard-flag, post-dispute)
    INSERT payouts (payout_type='goodwill', amount=full_payout+goodwill_credit)
    NOTE: This payout DOES reset discount_weeks. Any payout = reset.
  
  REJECTED:
    UPDATE disputes SET status='resolved_rejected'
    Send plain-language explanation to rider.
    If 3+ rejected disputes in 90 days: increase fraud threshold sensitivity for rider.
  
  UNRESOLVED at sla_deadline:
    disputes.escalated = true → admin urgent webhook
    Escalation path: admin review → if still unresolved → note for Consumer Forum
```

---

## 12. Loss Ratio & Solvency Engine

### 12.1 Loss Ratio Monitor

```
RUNS HOURLY (pg_cron):

  loss_ratio_30d = 
    SUM(payouts.amount WHERE released_at >= NOW() - INTERVAL '30 days'
                          AND payout_type NOT IN ('premium_debit','refund'))
    /
    NULLIF(
      SUM(policies.weekly_premium × weeks_active)
      -- weeks_active = number of active weeks in last 30 days per policy
    , 0)

  Stored in metrics_timeseries (metric_name='loss_ratio_30d')

GUARDRAIL TIERS:

  loss_ratio < 0.65    → GREEN   — no action
  0.65 ≤ ratio < 0.75  → AMBER   — log warning, admin webhook
  0.75 ≤ ratio < 0.85  → ORANGE  —
    λ_floor = 1.10 (applied to new policy quotes)
    UPDATE system_config SET value='1.10' WHERE key='lambda_floor'
    Admin webhook (urgent)
  ratio ≥ 0.85         → RED     —
    λ_floor = 1.20
    P_base margin increases: 10% → 15% (system_config 'p_base_margin_pct')
    Admin webhook + email
    IF ratio > 1.0: trigger Solvency Swap
```

### 12.2 Solvency Swap

```
SOLVENCY RATIO = (Capital Reserves + Reinsurance Limit) / Expected Claims Value

Status Stable:   Ratio > 1.2 (Green)
Status Critical: Ratio < 1.0 (Red) → trigger Solvency Swap

Expected Claims Value = SUM(claims.actual_payout WHERE status NOT IN ('paid','rejected'))
                      + (active_trigger_count × avg_payout_per_trigger × avg_policies_per_hex)

Solvency Swap (mock for Phase 2, real reinsurance contract in production):
  POST /internal/solvency/inject
  Body: { amount: (1.2 × expected_claims) - current_reserves, reason: 'stop_loss_trigger' }
  Logs to admin panel. Admin + founder SMS alert.
```

### 12.3 Per-City Profitability (Weekly Report)

```sql
SELECT
  hubs.city,
  policies.plan,
  riders.tier,
  riders.risk_profile,
  COUNT(DISTINCT policies.id)                                   AS active_policies,
  SUM(policies.weekly_premium)                                  AS premiums_collected,
  SUM(payouts.amount) FILTER (WHERE p.payout_type != 'premium_debit') AS payouts_issued,
  SUM(payouts.amount) / NULLIF(SUM(policies.weekly_premium), 0) AS loss_ratio,
  SUM(policies.weekly_premium) - SUM(payouts.amount)           AS gross_margin
FROM policies
JOIN riders ON policies.rider_id = riders.id
JOIN hubs   ON policies.hub_id = hubs.id
LEFT JOIN payouts ON payouts.policy_id = policies.id
  AND payouts.released_at >= date_trunc('week', NOW() - INTERVAL '7 days')
WHERE policies.week_start_date = date_trunc('week', NOW() - INTERVAL '7 days')::date
GROUP BY hubs.city, policies.plan, riders.tier, riders.risk_profile;
-- Stored in segment_economics table weekly (Monday 01:00 IST)
```

### 12.4 Auto-Generated Alerts from Segment Economics

```
IF segment.loss_ratio > 0.85:
  Alert: "{city} {plan} Tier {tier} {risk_profile} riders losing money.
  Recommend: increase risk_profile_high_mult or tighten oracle threshold for segment."

IF segment.loss_ratio < 0.30:
  Alert: "{city} {plan} Tier {tier} — very low loss ratio.
  Consider: reduce premium to improve adoption, or expand coverage."
```

---

## 13. Liquidity Engine

### 13.1 Real-Time Liquidity Monitor (Runs Every 5 Minutes)

```
available_cash = razorpay_balance + reserve_buffer
  razorpay_balance: GET /v1/fund_accounts/{account_id}/balance (via Razorpay API)
                    Cached in Redis for 4 minutes.
                    On fetch failure: use last known + flag as 'stale_balance'.
                    If stale > 15 min: escalate to 'cautious' mode.
  reserve_buffer:   system_config 'reserve_buffer_inr' (default ₹5,00,000)

expected_payouts_24h:
  = SUM(claims.actual_payout WHERE status IN ('auto_cleared','soft_flagged') AND paid_at IS NULL)
  + (active_trigger_count × avg_payout_per_trigger × avg_active_policies_per_hex)

liquidity_ratio = available_cash / MAX(expected_payouts_24h, 1)
```

### 13.2 Liquidity Guardrail Tiers

```
liquidity_ratio ≥ 1.5 → mode = 'normal'
  All payouts process immediately as designed.

1.2 ≤ ratio < 1.5 → mode = 'elevated'
  No payout changes. Admin webhook. Close monitoring.

1.0 ≤ ratio < 1.2 → mode = 'cautious'
  auto_clear_threshold: 0.40 → 0.35 (harder to auto-clear)
  Provisional split: 60% now, 40% in 4hr (was 70/30 in 2hr)
  Queue: payouts > ₹500 require 5-min queue before release.
  Admin alert: urgent webhook.

0.8 ≤ ratio < 1.0 → mode = 'stressed'
  Global payout_factor = 0.90 (10% reduction on all new payouts)
  Soft-flag remainder: held 6hr instead of 2hr.
  Payouts > ₹1,000: require manual admin approval.
  Admin SMS + webhook immediately.

ratio < 0.8 → mode = 'emergency'
  UPDATE system_config SET value='payouts_only' WHERE key='global_kill_switch'
  All new payouts queued (accumulated, released when liquidity recovers).
  Admin + founder SMS/call alert.
  Rider message: "Your payout of ₹{amount} is confirmed and queued.
  Due to high demand today, it will reach your account within 4 hours."

Rider communication (cauious/stressed):
  "Your payout is confirmed. Due to high demand right now,
  it will reach your account within {1|2|4} hours."
  NEVER say "liquidity" or "fund shortage". Say "high demand".

Store all snapshots: INSERT INTO liquidity_snapshots (all fields)
```

---

## 14. Observability, Metrics & Alerting

### 14.1 Metrics Collection

```
All services emit structured JSON logs:
{
  "timestamp": "UTC ISO",
  "service": "payout-service",
  "function": "process_payout",
  "level": "INFO|WARN|ERROR",
  "rider_id": "...",
  "claim_id": "...",
  "duration_ms": 342,
  "status": "success",
  "metadata": {}
}

Log levels:
  ERROR: exception, failed payment, circuit opened
  WARN:  fallback API used, soft-flag, rate limit approaching
  INFO:  payout success, trigger fired, oracle complete
  DEBUG: ping received, signal score computed (staging only)

Log shipping: stdout → Supabase log (free) for Phase 1/2.
              Phase 3: Logtail or Datadog when volume justifies.
```

### 14.2 Metrics Timeseries (Written by Each Service)

```
FINANCIAL (every 15 min):
  payouts_last_15min_count, payouts_last_15min_sum
  premiums_collected_today
  loss_ratio_realtime
  liquidity_ratio, solvency_ratio
  active_policies_count
  pending_payouts_count, pending_payouts_total_inr

OPERATIONAL (every 5 min):
  oracle_loop_last_run_seconds_ago
  active_trigger_count
  api_calls_last_hour (labels: {service: 'owm'})
  api_rate_limit_hits_last_hour (labels: {service: 'owm'})
  circuit_breaker_states (labels: {service: 'razorpay'})
  celery_queue_depth (labels: {queue: 'payout'})
  celery_active_workers

FRAUD (every 15 min):
  claims_last_15min
  auto_clear_rate_last_hour
  soft_flag_rate_last_hour
  hard_flag_rate_last_hour
  vov_submission_rate
  fraud_investigation_queue_depth

PAYOUT DELIVERY (every 5 min):
  avg_payout_delay_seconds
  p95_payout_delay_seconds
  failed_payouts_last_hour
  razorpay_webhook_lag_seconds
```

### 14.3 Alert Thresholds

| Metric | Threshold | Channel |
|---|---|---|
| loss_ratio_realtime | > 0.85 | Webhook + Email |
| liquidity_ratio | < 1.2 | Webhook (urgent) |
| liquidity_ratio | < 1.0 | SMS + Webhook |
| oracle_loop_last_run_secs_ago | > 1200 (20 min) | Webhook |
| failed_payouts_last_hour | > 3 | Webhook + Email |
| hard_flag_rate_last_hour | > 0.20 | Webhook |
| auto_clear_rate_last_hour | < 0.50 | Webhook (too conservative) |
| celery_queue_depth (payout) | > 100 | Webhook |
| api_rate_limit_hits/hr | > 5 | Webhook |
| circuit_breaker (razorpay) | = 'open' | SMS + Webhook |
| pending_payouts_total_inr | > ₹5,00,000 | Email |

---

## 15. Admin Panel — All Tabs

### 15.1 Overview / Dashboard Tab

```
Real-time cards (Supabase real-time subscription, refresh 30s):
  [Payouts/min]  [Auto-clear rate]  [Liquidity ratio]
  [Loss ratio]   [Active triggers]  [Celery queue depth]

Circuit breaker status per service:
  razorpay: ● CLOSED | ● OPEN | ● HALF-OPEN
  owm, waqi, google, zepto, blinkit

Time-series charts (24hr / 7d / 30d selector):
  Loss ratio over time
  Payouts per hour (bar)
  API call volumes per service (line)
  Fraud flag rates (line)
  Avg payout delay (line)

Global controls:
  [Kill Switch: OFF | triggers_only | payouts_only | full]
  (requires admin 2-factor confirm + typed "CONFIRM")
```

### 15.2 Fraud Queue Tab

```
Claims with status IN ('hard_flagged', 'manual_review')
Sorted by fraud_score DESC

Per claim row:
  rider phone, claim amount, trigger type, fraud_score, time elapsed
  [Expand] → full admin_trace JSONB, rider history (90d claims/payouts),
              device fingerprint match count, telemetry pings on map,
              VOV video player (if submitted)

Admin actions per claim:
  [Approve] → full payout → status='manual_approved'
  [Approve Partial] → input custom ₹ → status='manual_adjusted'
  [Reject] → input reason → notify rider → status='manual_rejected'
  [Escalate] → flag fraud investigation → block rider → alert team
  [Request Info] → send support_message to rider

Bulk payout release (for queued payouts during liquidity event):
  Filter: city + trigger_id + status
  Shows: affected_count, total_amount, current liquidity_ratio
  [Release All] → confirm → batch Razorpay (POST /v1/batch_payouts, max 1000)
```

### 15.3 Rider Support Tab

```
Search: phone number, rider_id, policy_id

Rider card shows:
  Policy details, plan, status, discount_weeks, risk_profile, risk_score
  All claims (last 90 days) with status and amounts
  All payouts (last 90 days)
  Active disputes with SLA countdown
  Shift state history (last 7 days)
  Effective income vs declared income

Admin actions:
  [Adjust effective_income] → log reason → UPDATE riders
  [Reset discount_weeks to 0] → log reason
  [Override risk_profile] → log reason
  [Cancel policy] → triggers cancellation flow
  [Issue goodwill credit] → input amount + reason → instant payout
  [Send message] → INSERT support_messages (admin_to_rider)

Manual claim creation:
  Input: rider_id, trigger_type, event_start, event_duration
  System computes payout using standard formula (preview shown)
  [Approve & Pay] → claims.is_manual_override=true → INSERT + payout
```

### 15.4 Backtesting Tab (READ-ONLY SIMULATION)

```
DISCLAIMER (bold banner): "SIMULATION ONLY — Nothing written to live system."

Inputs:
  City dropdown, date range (max 6 months back)
  "Use current config" toggle (default ON)
  If OFF: config sliders appear (same as Experiment tab parameters)

[Run Backtest] → async Celery job → progress bar

ALGORITHM (reads oracle_api_snapshots table):
  For each 15-min window in date range × active hexes:
    snapshots = oracle_api_snapshots WHERE h3_index=:hex AND snapshot_at IN window
    oracle_score = compute_oracle_score(snapshots, config)
    would_trigger = oracle_score >= config.oracle_threshold
    actual_trigger = EXISTS trigger_events WHERE h3=:hex AND triggered_at IN window
    
    results.append({
      true_positive:  would_trigger AND actual_trigger,
      false_positive: would_trigger AND NOT actual_trigger,
      false_negative: NOT would_trigger AND actual_trigger,
      simulated_payout: compute_payout(hex, window, config) if would_trigger else 0,
      actual_payout: SUM(payouts for this window)
    })

Results:
  Summary cards: Oracle Precision %, Oracle Recall %, Simulated Loss Ratio, Actual Loss Ratio
  Delta: simulated - actual (green if negative = new config is better)
  "Would this config have saved/cost ₹{delta} vs current?"
  
  Timeline chart: oracle_score over time, threshold line, TP/FP/FN markers
  Trigger breakdown table: per trigger type — TP rate, FP rate, FN rate, avg payout

Side-by-side preview (when changing sliders before running):
  Shows: backtest on last 30 days with proposed config (5–10 sec, non-blocking)

Saved results: INSERT INTO backtest_results (is_simulation=true)
```

### 15.5 Stress Testing Tab (SIMULATION ONLY)

```
DISCLAIMER (bold): "SIMULATION ONLY — No live state changed."

Pre-built scenarios (one-click, then editable):

A — Extreme Rain Week:
  Inputs: city, % riders triggered, avg_duration_hrs, mu_override
  Output: simulated_payout, simulated_loss_ratio, liquidity_mode triggered,
          reserve_depleted_in_hours

B — Multi-Trigger Cascade:
  Inputs: city, trigger_types (checkboxes), % overlap
  Computes using MAX stacking rule (not additive)
  Shows savings from stacking rule vs naive additive

C — Festival Bandh Spike:
  Pre-loaded festival calendar (Republic Day Jan 26, Independence Aug 15, Diwali, Holi)
  Shows expected payout exposure calendar for next 12 months

D — Custom (free-form):
  Any combination: % affected, trigger type, duration, mu, city, oracle_score
  Instant calculation (pure formula, no DB queries)

All scenarios show:
  simulated_loss_ratio, liquidity_ratio, solvency_ratio
  Which guardrail tier activates (color-coded)
  Recommended action ("Pre-load reserve by ₹{X} before monsoon season")
  [Save Scenario] → stress_test_scenarios table
  [Export PDF] → finance review
```

### 15.6 Experiments Tab (LIVE — CAN CHANGE SYSTEM BEHAVIOR)

```
REQUIRES: Admin auth + typed "CONFIRM" before any change.
HOLDOUT GROUP: Never affected by any experiment. Always excluded.

CONTROLLABLE PARAMETERS (sliders with bounds):
  oracle_threshold:          0.50–0.80 (default 0.65)
  auto_clear_fs_threshold:   0.25–0.50 (default 0.40)
  hard_flag_fs_threshold:    0.55–0.80 (default 0.70)
  confidence_band_1_factor:  0.70–1.00 (oracle 0.65–0.74, default 0.85)
  confidence_band_2_factor:  0.85–1.00 (oracle 0.75–0.84, default 0.95)
  single_event_cap_pct:      0.30–0.70 (default 0.50)
  daily_soft_limit_divisor:  3–7       (default 4)
  lambda_floor:              1.0–1.5   (default 1.0)
  risk_profile_high_mult:    1.05–1.30 (default 1.15)
  vov_reward_individual:     ₹5–₹30    (default ₹15)
  vov_reward_zone_cert:      ₹10–₹40   (default ₹20)
  discount_per_clean_week:   0.01–0.10 (default 0.05)
  max_discount_weeks:        2–8       (default 4)

GROUP TARGETING: All riders | Control | Variant A | Variant B | (never Holdout)

SIDE-BY-SIDE PREVIEW (non-blocking, 5–10 sec):
  Before committing: show backtest on last 30 days with proposed value.
  "Precision: 78% → 84%. Recall: 92% → 81%. Loss ratio: 0.61 → 0.55."
  "~{N} riders would NOT have been paid with this threshold."

CONFIRMATION:
  "You are changing {param} from {old} to {new}.
   Affects {group_label} ({count} policies). Type CONFIRM to apply."
  → Logged to admin_audit_log with full diff.

Changes take effect within 15 min (next oracle loop reads from experiments table).
Exception: premium parameters take effect next Monday (locked for current week).

ROLLBACK: Available 24hr after any change. Logged separately in admin_audit_log.

METRICS DASHBOARD (read-only):
  Group A vs B vs Control: loss_ratio, auto_clear_rate, avg_payout, churn_rate, vov_rate
  Statistical significance meter (chi-squared p-value)
  [Declare Winner] button: available when p < 0.05 AND n >= 200 per group
  [Roll out to all] → applies winning config to all groups, ends experiment

GUARDRAILS (hard limits, cannot be overridden by experiment):
  auto_clear_threshold never > 0.50
  Cannot change velocity > 150 hard gate
  Cannot change EXIF checks
  Holdout group never touched
```

### 15.7 Economics Tab

```
Segment economics table (filterable by city, plan, tier, risk_profile):
  active_policies, premiums_collected, payouts_issued, loss_ratio, gross_margin

Metric cards:
  Platform total loss ratio | Total active riders | Break-even progress bar

Auto-alerts panel: segments with loss_ratio > 0.85 (red) or < 0.30 (opportunity)

Reconciliation reports: list with status (clean/issues_found), download JSON
```

---

## 16. Notification System

### 16.1 Notification Engine Architecture

```
Services publish events to Redis pub/sub channel: 'notifications'
notification-service consumes, renders, sends.
Never blocks publishing service (fire-and-forget).

Channels (priority order):
  1. Push (FCM/APNS via PWA Web Push API) — free, primary
  2. SMS (Twilio / MSG91) — ~₹0.15/SMS, critical fallback
  3. WhatsApp (Meta Business API) — Phase 3 only
```

### 16.2 Notification Rules

| Event | Channels | Template |
|---|---|---|
| payout_success | Push + SMS | "₹{amount} sent to your GPay — {trigger_type} protection active" |
| payout_queued | Push only | "Your ₹{amount} payout is confirmed. Processing in ~{eta} hours." |
| claim_soft_flagged | Push only | "Claim under review. ₹{provisional} sent now. Remaining ₹{remainder} in 2hr." |
| claim_hard_flagged | Push + SMS | "Claim is being reviewed. Decision in 4 hours. Tap to add video evidence." |
| vov_requested | Push only | "Add a 10-sec video to verify the disruption and speed up your payout." |
| policy_renewed | Push only | "Coverage renewed. ₹{premium} debited. {discount_text} Zone risk: {risk_level}" |
| policy_lapsed | Push + SMS | "Payment failed. 48-hour grace period. Tap to update payment." |
| weekly_cap_reached | Push only | "Weekly limit reached (₹{cap}). Coverage resets Monday." |
| event_cap_reached | Push only | "Event limit reached (₹{event_cap}). ₹{remaining_weekly} available for new events." |
| system_delay | Push only | "Verifying disruption in your area. Payout may be delayed ~{delay}." |

**Critical** = payout_success, claim_hard_flagged, policy_lapsed, policy_renewed → SMS fallback if push fails 3×.  
**Non-critical** = all others → push only, no SMS fallback.

### 16.3 Retry Logic

```
Push:
  Attempt 1: immediate
  Attempt 2: 5 minutes (if no delivery receipt)
  Attempt 3: 15 minutes
  All 3 fail AND critical → SMS fallback

SMS:
  Attempt 1: immediate
  Attempt 2: 10 minutes
  2nd fails → log 'sms_failed', admin alert if > 10 failures/hr
```

### 16.4 Trust UX Layer (Rider-Facing)

```
PRE-EVENT (always visible on dashboard):
  "If a disruption triggers now: ~₹{expected_payout}"
  expected_payout = effective_income × coverage_pct × (2/8) × current_mu_time
  Updates every 15 min. Shows "Peak hours" or "Off-peak hours" badge.

DURING EVENT (live status card):
  Rain event active in your zone
  Duration: 1h 23m and counting
  Paid so far: ₹157.50
  Next top-up in: 7 minutes
  Weekly remaining: ₹3,842.50
  Event cap remaining: ₹1,842.50
  (Updates every 30s via Supabase real-time)

PAYOUT REDUCTION (always explain, never silently reduce):
  confidence_factor < 1.0:
    "Disruption partially confirmed. Your payout is ₹{actual} (vs full ₹{full}).
    Upload a video to receive the full amount →"
  correlation_factor < 1.0:
    "A city-wide disruption affected {N} zones. Payout: ₹{actual}.
    This protects the fund for all {total_riders} insured riders."
  event_cap reached: preemptive message before it hits (at 90% of event_cap).
```

---

## 17. Onboarding & UX Flows

### 17.1 Onboarding Steps

```
Step 1: Phone OTP verification
  POST /api/v1/auth/send-otp  → Twilio SMS OTP
  POST /api/v1/auth/verify-otp → JWT issued

Step 2: Profile form
  name, platform (dropdown), city, hub (dropdown filtered by city)
  declared_income (₹200–₹2,500 slider with examples)
  
  VALIDATION:
    IF declared_income > ₹1,500: show "Verification screenshot required"
    effective_income = MIN(declared_income, city_median_income) until verified

Step 3: Fraud prevention checks (silent, before activation)
  device_fingerprint = canvas+WebGL hash (computed client-side)
  enrollment_ip_prefix = /24 subnet (logged server-side)
  
  CHECK blacklisted_devices: IF match → silent reject ("Unable to process")
  CHECK riders WHERE device_fingerprint = :fp AND status='active':
    IF exists → require Aadhaar KYC before proceeding
  CHECK riders WHERE bank_account_hash = :hash:
    IF exists → "This bank account is linked to an existing policy. Cancel it first."
  
  Assign experiment_group_id = SHA-256(rider_id)[0:8] % 4 → 'control'|'variant_a'|'variant_b'|'holdout'

Step 4: Risk profiling (instant, from ML model)
  features: city, hub vulnerability_idx, declared_income, platform
  output: risk_score, risk_profile (default 'medium' for new riders)
  quote: show P_final for each plan

Step 5: Plan selection
  Show 3 plan cards with:
    Weekly premium (P_final computed live)
    Covered triggers (list)
    Coverage % and weekly cap (₹X at ₹Y/day income)
    Expected payout example: "For a 2-hour rain at 8PM: ~₹{amount}"

Step 6: UPI Mandate setup
  Razorpay mandate creation flow
  ₹1 verification debit + instant refund
  Mandate ID stored in policies.razorpay_mandate_id
  First real debit: next Monday 00:01 IST

Step 7: Policy activation
  policies.status = 'active'
  policies.week_start_date = next_monday()
  policies.weekly_payout_used = 0
  Push notification: "GigShield is active. You're protected."
  Rider consent logged in rider_consent_log.

Step 8: Income verification (async, within 48hr if required)
  Admin reviews platform screenshot
  IF verified: effective_income updated, rider notified
  IF not submitted/rejected: effective_income stays at city_median cap
```

---

## 18. Race Condition & Idempotency Protection

### 18.1 Four-Layer Double-Spend Protection

```
LAYER 1 — Redis distributed lock (first gate):
  @app.task(bind=True, max_retries=3, acks_late=True)
  def process_payout(self, claim_id):
    lock_key = f"payout_lock:{claim_id}"
    lock = redis_client.set(lock_key, '1', nx=True, ex=60)  # atomic SET if NOT EXISTS
    if not lock:
      return {'status': 'skipped', 'reason': 'lock_held'}  # another worker has it
    try:
      return _process_payout_inner(claim_id)
    finally:
      redis_client.delete(lock_key)  # always release (TTL=60s auto-releases on crash)

LAYER 2 — PostgreSQL SELECT FOR UPDATE SKIP LOCKED:
  In _process_payout_inner:
    BEGIN;
    SELECT id, status FROM claims
    WHERE id = :claim_id FOR UPDATE SKIP LOCKED;
    IF no_row: ROLLBACK; RETURN  # another worker locked it — skip
    # Proceed with fraud scoring + Razorpay call
    UPDATE claims SET status='paid', paid_at=NOW();
    INSERT INTO payouts (...);
    COMMIT;

LAYER 3 — Atomic status guard:
  UPDATE claims
  SET status='paid', paid_at=NOW()
  WHERE id = :claim_id AND status != 'paid'
  RETURNING id;
  IF no_row_returned: ABORT (already paid by another worker)

LAYER 4 — UNIQUE constraint on payouts.idempotency_key:
  INSERT INTO payouts (idempotency_key=:key, ...) ON CONFLICT DO NOTHING
  If another worker already inserted → our INSERT does nothing → no duplicate Razorpay call

CRON DOUBLE-RUN PROTECTION:
  First action of every cron job:
    INSERT INTO cron_locks (job_name, week_start, locked_at)
    VALUES (:job, date_trunc('week', NOW()), NOW())
    ON CONFLICT (job_name, week_start) DO NOTHING
    RETURNING id;
    IF no_row: EXIT (another instance already ran)

INTEGRATION TEST (must be in CI):
  Spawn 10 concurrent Celery workers on same claim_id.
  Assert: exactly 1 row in payouts, exactly 1 Razorpay call.
```

---

## 19. Circuit Breaker & API Resilience

### 19.1 Circuit Breaker Implementation

```python
class CircuitBreaker:
  """State stored in Redis — shared across all workers."""
  
  def __init__(self, service_name, failure_threshold=5,
               recovery_timeout=60, half_open_max=2):
    self.state_key         = f"cb:{service_name}:state"
    self.failure_count_key = f"cb:{service_name}:failures"
    self.last_failure_key  = f"cb:{service_name}:last_failure"
    self.failure_threshold = failure_threshold
    self.recovery_timeout  = recovery_timeout
    self.half_open_max     = half_open_max
  
  def call(self, fn, *args, **kwargs):
    state = redis.get(self.state_key) or 'closed'
    
    if state == 'open':
      last = float(redis.get(self.last_failure_key) or 0)
      if time.time() - last > self.recovery_timeout:
        redis.set(self.state_key, 'half_open')
        state = 'half_open'
      else:
        raise CircuitOpenError(f"{self.service_name} circuit is OPEN")
    
    if state == 'half_open':
      count = int(redis.incr(f"cb:{self.service_name}:half_open_count"))
      if count > self.half_open_max:
        raise CircuitOpenError("HALF-OPEN limit reached")
    
    try:
      result = fn(*args, **kwargs)
      redis.set(self.failure_count_key, 0)
      if state == 'half_open':
        redis.set(self.state_key, 'closed')
        redis.delete(f"cb:{self.service_name}:half_open_count")
      return result
    except Exception as e:
      failures = int(redis.incr(self.failure_count_key))
      redis.set(self.last_failure_key, time.time())
      if failures >= self.failure_threshold:
        redis.set(self.state_key, 'open')
        INSERT INTO circuit_breaker_events (service, event_type='opened', failure_count=failures)
        alert_admin(f"Circuit OPENED: {self.service_name}")
      raise
```

### 19.2 Circuit Breakers Deployed

| Service | failure_threshold | recovery_timeout |
|---|---|---|
| razorpay | 3 | 120s |
| owm | 5 | 60s |
| waqi | 5 | 60s |
| google | 5 | 90s |
| zepto | 3 | 120s |
| blinkit | 3 | 120s |
| weatherstack | 3 | 300s |

### 19.3 Razorpay Circuit Open — Behavior

```
When razorpay_cb raises CircuitOpenError:
  INSERT payouts with razorpay_status='circuit_breaker_hold'
  redis.zadd('payout_recovery_queue', {idempotency_key: timestamp})
  notify_rider('payout_queued', eta_hours=0.5)

When circuit transitions to CLOSED:
  Drain payout_recovery_queue in chronological order.
  Rate limit: max 50 payouts/minute (prevents thundering herd).
  Each payout processed via normal idempotent flow.
```

---

## 20. Reconciliation & Disaster Recovery

### 20.1 Three-Layer Reconciliation

```
LAYER 1 — Webhook (real-time, covers ~95%):
  Razorpay sends webhook → POST /webhooks/razorpay → update DB.
  Webhook idempotency: check webhook_events.event_id before processing.

LAYER 2 — Polling fallback (every 30 min, catches missed webhooks):
  stuck = SELECT id, razorpay_ref FROM payouts
          WHERE razorpay_status = 'processing'
            AND released_at < NOW() - INTERVAL '10 min'
            AND razorpay_ref IS NOT NULL

  For each stuck payout:
    GET /v1/payouts/{razorpay_ref}
    Update DB status based on Razorpay response.
    If 'processed': update claim, notify rider (late success).
    If 'failed': trigger retry flow.

LAYER 3 — Daily full reconciliation (03:00 IST):
  Fetch all Razorpay payouts for yesterday (cursor-paginated).
  Store in razorpay_reconciliation_raw.
  
  Match by reference_id = idempotency_key:
    matched:               reconcile_status='matched'
    amounts differ:        reconcile_status='amount_mismatch' → CRITICAL ALERT
    DB 'processing', RP success: reconcile_status='late_success' → notify rider
    In RP, not in DB:      reconcile_status='missing_from_db' → CRITICAL ALERT
    In DB 'success', not in RP: reconcile_status='missing_from_razorpay' → CRITICAL ALERT
  
  INSERT INTO reconciliation_reports (all counts, total_discrepancy_inr, status)
  Email report to admin@gigshield.in always.
  SMS admin if issues_found.

PREMIUM DEBIT RECONCILIATION (Monday 01:00 IST):
  Compare active policies vs Razorpay mandate charges.
  Active policy with no debit → investigate.
  Debit with no matching policy → refund + alert.
```

### 20.2 Disaster Recovery

```
BACKUP STRATEGY:
  Supabase Pro PITR: restore to any second in last 7 days. RPO < 1s, RTO < 30 min.
  Supabase daily snapshot: 7 daily + 4 weekly + 12 monthly backups.
  
  Critical tables (financial/legal) — independent GCS backup:
    Tables: payouts, claims, policies, disputes, admin_audit_log, reconciliation_reports
    Frequency: daily via GitHub Actions at 01:00 UTC
    Retention: 7 years (RBI requirement)
    Encryption: AES-256, key in Google Secret Manager
  
  Schema: /supabase/migrations/ (git-versioned) — fully reconstructable.

RESTORE SCENARIOS:
  1. Accidental deletion → PITR to 5 min before → 15-30 min downtime
  2. Full corruption → daily snapshot → up to 24hr data loss
  3. Region failure → Supabase multi-region failover → < 5 min downtime
  4. Complete loss → GCS backup for financial tables + Razorpay reconciliation for gap

RUNBOOK: /docs/disaster-recovery.md — reviewed quarterly, DR drill quarterly.
STAGING: gigshield-staging (separate Supabase project, Razorpay test mode).
```

---

## 21. Geospatial Fraud Clustering

(Fully specified in Section 10.7 above — cross-reference for implementation.)

Key schema additions:
- `riders.syndicate_suspect_group_id UUID`
- `riders.enrollment_ip_prefix TEXT`
- `fraud_clusters` table
- Daily check for enrollment density spikes
- Claim burst detection within 5-minute windows

---

## 22. ML Model Specifications

### 22.1 Vulnerability Index Model

(Fully specified in Section 4.4 above.)

### 22.2 YOLOv8n VOV Model

```
Base model: YOLOv8n (nano — runs on CPU without GPU infra)
Fine-tuning: custom dataset of rain/flood/bandh/gear imagery

Custom classes:
  rain_streak, standing_water, wet_road, submerged_vehicle
  crowd, barricade, protest_banner, blocked_road
  zepto_bag, blinkit_shirt, delivery_crate

Confidence threshold for claim confirmation: >= 0.70
Gear detection boost: cv_confidence = MAX(cv_confidence, 0.95)

Deployment: FastAPI + Celery background task
  @celery.task
  def run_yolo_inference(evidence_id: str, video_url: str, trigger_type: str):
    model = YOLO('./models/yolov8n_gigshield.pt')
    results = model(video_url)
    confidence = max(r.confidence for r in results if r.class in target_classes(trigger_type))
    gear = any(r.class in GEAR_CLASSES for r in results)
    UPDATE claim_evidence SET cv_confidence=confidence, gear_detected=gear, cv_classes=[...]
    WHERE id = evidence_id

Training data: /data/vov_training/ (labeled by trigger_type)
Retrain: when new confirmed VOV evidence accumulates > 500 new labeled samples.
```

### 22.3 Telemetry-Inferred Income Model

```
Simple regression model (weekly, by ml-service):
  inferred_income = avg_shift_hours_per_day
                  × (movement_events_per_hour × 0.40)
                  × city_avg_order_value

  movement_events_per_hour = COUNT(pings WHERE speed_kmh > 5 AND recorded_at IN shift_hours)
                             / shift_hours_count

  Store in riders.telemetry_inferred_income (updated Monday alongside premium debit).
```

---

## 23. A/B Experimentation Framework

(Fully specified in Section 15.6 above.)

**Key implementation notes:**

```python
# Services read experiment config at RUNTIME (not startup)
def get_experiment_config(group_id: str, parameter_name: str):
    result = db.execute(
        "SELECT parameter_value FROM experiments "
        "WHERE group_id = :group AND parameter_name = :param AND active = true",
        {'group': group_id, 'param': parameter_name}
    ).fetchone()
    return result.parameter_value if result else None

# Usage in oracle-service:
threshold = get_experiment_config(policy.experiment_group_id, 'oracle_threshold')
oracle_threshold = threshold or DEFAULT_ORACLE_THRESHOLD  # fallback to default

# UX message experiment:
def get_message(key: str, group_id: str, context: dict) -> str:
    template = db.query(message_experiments).filter_by(message_key=key, group_id=group_id).first()
    template = template or get_control_message(key)
    return template.format(**context)
```

---

## 24. Legal & Compliance Layer

### 24.1 Product Classification

```
GigShield = "Parametric Income Supplementation Service"
NOT = insurance (avoids IRDAI licensing initially)

Rationale:
  - Payouts triggered by objective data (not loss claims)
  - No indemnity principle
  - No insurable interest assessment

Tax classification:
  Payout = "other income" under Income Tax Act
  TDS: 5% on annual payouts > ₹10,000 per rider (Section 194J/194C — confirm with CA)
  Annual tracker: riders.annual_payout_total (reset Jan 1)
  Issue Form 16A if threshold crossed.

IRDAI CONTINGENCY (if regulatory classification challenged):
  Option A: IRDAI Regulatory Sandbox (≤3yr, ≤₹10cr coverage)
  Option B: Partner with Digit Insurance / Acko General (distribution layer only)
  Option C: Restructure as loyalty reward
  Trigger for contingency: any IRDAI communication or legal notice.
  Pre-draft Option B partnership agreement before public launch.
```

### 24.2 KYC & AML

```
Minimum KYC (payouts ≤ ₹10,000 cumulative):
  Phone OTP (already implemented) + self-declaration

Enhanced KYC (cumulative payouts > ₹10,000 OR IRDAI requirement):
  Aadhaar + PAN via DigiLocker API or UIDAI OTP
  Bank account penny drop (Razorpay supports this)
  Store: aadhaar_hash, pan_hash (SHA-256 only, never raw)

AML:
  Flag: any rider receiving > ₹50,000 in single week → manual review
  Flag: payouts exceed declared weekly income × 1.5
  Report: STR to FIU-IND if confirmed suspicious

Consent log: rider_consent_log (every action requiring consent)
Data access log: data_access_log (every admin view of rider PII — DPDP Act 2023)
```

### 24.3 Terms of Service Requirements

```
Must explicitly state:
  1. Not insurance — parametric income supplementation service
  2. Payouts triggered by objective data, not individual claims
  3. Payout amounts may be adjusted during city-scale events (correlation factor)
  4. Coverage not guaranteed during government emergencies (kill switch clause)
  5. Weekly cap applies Mon–Sun regardless of pause
  6. Not liable for Razorpay/banking infrastructure delays
  7. Data collection per DPDP Act (what collected, how used, retention)

Versioned: ToS version number + effective date
Change notification: 7 days advance notice before any ToS change
Accept log: rider_consent_log with version number
```

### 24.4 Consumer Protection

```
Consumer Protection Act 2019:
  Explainability Report (Section 10.8) = adverse action notice
  Dispute sub-flow with 72hr SLA (Section 11.6) = grievance mechanism
  REQUIRED: Named Grievance Officer (name/email/phone on platform)
  REQUIRED: Escalation to Consumer Forum if unresolved dispute

DPDP Act 2023:
  Right to deletion: cancellation + 90-day retention → delete personal data
  Exception: financial records → 7 years (RBI requirement)
```

---

## 25. Data Retention Strategy

| Table | Hot Retention | Archive | Delete |
|---|---|---|---|
| telemetry_pings | 90 days | 90d–2yr (GCS parquet) | > 2 years |
| telemetry_pings (fraud investigation) | Indefinitely | Never | Never |
| trigger_events | Indefinitely | — | Never (actuarial) |
| claims | Indefinitely | — | Never (financial) |
| payouts | Indefinitely | — | Never (financial/RBI) |
| claim_evidence.video_url | 48hr post-payout (TTL) | — | After TTL |
| claim_evidence (metadata) | Indefinitely | — | Never (audit) |
| disputes | Indefinitely | — | Never (legal) |
| admin_audit_log | Indefinitely | — | Never (compliance) |
| shift_states | 6 months | 6m–2yr | > 2 years |
| zone_risk_cache | 7-day rolling | — | Auto-overwritten |
| metrics_timeseries | 6 months | 6m–2yr (GCS) | > 2 years |
| oracle_api_snapshots | 6 months | — | > 6 months |
| notifications | 90 days | — | > 90 days |

Archival cron: 3AM IST on 1st of each month. Export → GCS parquet → DELETE from Supabase.

---

## 26. System Architecture & Services

### 26.1 Service Responsibilities

| Service | Owns | Calls | Never calls |
|---|---|---|---|
| oracle-service | trigger_events, oracle_api_snapshots | External weather/AQI/traffic APIs, redis | Razorpay |
| fraud-service | fraud scoring logic, disputes | telemetry-service, oracle-service | Razorpay |
| payout-service | payouts, Razorpay integration, liquidity | fraud-service, policy-service, Razorpay | External weather APIs |
| telemetry-service | telemetry_pings, shift_states | Platform adapter | All external APIs |
| policy-service | policies, policy_pauses, premiums | ml-service | External APIs |
| ml-service | risk scores, vulnerability index, income inference | Supabase | External APIs |
| vov-service | claim_evidence, zone_vov_certs, YOLOv8 | oracle-service | Razorpay |
| notification-service | notifications | Redis pub/sub consumer, Twilio, FCM | DB (read-only) |
| liquidity-service | liquidity_snapshots | Razorpay balance API | Fraud/oracle |
| reconciliation-service | reconciliation_reports | Razorpay API, DB | Real-time user requests |

### 26.2 Scaling Thresholds

| Riders | Action |
|---|---|
| < 1,000 | Free tiers — ₹0/month infra |
| > 1,000 | Upgrade Supabase Pro ($25/mo, 8GB) + OWM Starter ($40/mo) |
| > 5,000 | Redis caching layer; OWM bounding-box batch calls; Supabase read replica |
| > 10,000 telemetry pings/sec | Kafka ingestion layer (Confluent Cloud) |
| > 50,000 | Oracle-service city sharding; YOLOv8 on dedicated GPU; CDN for VOV uploads |

### 26.3 Time Authority

```
RULE: All timestamps from PostgreSQL NOW() only.

NEVER:
  datetime.now() in Python
  Date.now() in JavaScript  
  new Date() in Next.js
  Local server time anywhere

ALWAYS:
  current_time = await supabase.rpc('get_server_time')  -- SELECT NOW()
  OR: use DB row's DEFAULT NOW() timestamp

CLOCK DRIFT DETECTION:
  Every service on startup:
    db_time = SELECT NOW()
    local_time = local clock
    drift_ms = ABS(db_time - local_time)
    IF drift_ms > 5000: log WARNING + alert
    IF drift_ms > 30000: refuse to start + CRITICAL alert

CRON: All pg_cron jobs use DB server time (UTC).
IST DISPLAY: EXTRACT(HOUR FROM ts AT TIME ZONE 'Asia/Kolkata') for μ_time lookup.
All storage: UTC. All display: IST (UTC+5:30).
```

---

## 27. Edge Cases & Guard Rails

```
1. RIDER PAUSES DURING ACTIVE TRIGGER:
   Cannot pause if trigger_events.status IN ('active','resolving') for rider's hex.
   API returns 400: "Cannot pause during an active disruption event."

2. MULTIPLE TRIGGERS SIMULTANEOUSLY (rain + bandh + flood):
   Each creates separate trigger_events rows.
   Rider gets ONE claim: highest-value trigger (Section 7.5 stacking rule).
   If winning trigger resolves: seamlessly switch to next active trigger.
   All draw from same weekly_payout_used pool.

3. RIDER CHANGES HUB MID-WEEK:
   Hub change requires: cancel policy + re-enroll at new hub.
   policies.hub_id fixed at enrollment — cannot be changed in-place.
   This prevents chasing active trigger zones.

4. VOV SUBMITTED AFTER EVENT WINDOW CLOSES:
   VOV window = trigger.triggered_at to trigger.triggered_at + 3 hours.
   After 3 hours: VOV rejected with "Event window closed."
   EXIF timestamp check still catches attempts to backdate.

5. RIDER CLAIMS FROM TWO HEX ZONES (dual-SIM bug):
   policies.hub_id is fixed. Presence check uses hub's H3 cell.
   Second hex fails presence check. Only registered hub is valid.

6. WEEKLY CAP EXHAUSTED, NEW TRIGGER FIRES:
   System runs intent + presence + fraud checks.
   IF headroom = 0: claims.status = 'cap_exhausted'. No payout.
   Notify: "Weekly protection limit reached. Coverage resets Monday."
   Log for actuarial analysis.

7. PLATFORM API DOWN (Zepto unavailable):
   Intent Factor 3 = N/A. Claim soft-flagged regardless of fraud score.
   intent_platform_unavailable = true on claim.
   Rider sees normal "1–2 hour verification" message.

8. GOODWILL CREDIT AFTER DISPUTE UPHELD:
   INSERT payouts (payout_type='goodwill').
   Counts toward weekly_payout_used. Counts toward discount_weeks reset.
   Any money movement = reset. No exceptions.

9. RIDER ENROLLS IN FLOOD-PRONE HUB (high λ zone):
   P_final can legitimately reach 2× base if λ=2.0 and risk_multiplier=1.15.
   This is by design — high-risk zones pay proportionally more.
   Cap λ at 2.0 prevents absurd premiums.

10. CELERY WORKER CRASHES HOLDING REDIS LOCK:
    Redis lock TTL=60s auto-releases after crash.
    Next worker attempt acquires lock and processes normally.
    DB SELECT FOR UPDATE ensures only one actually commits.

11. BACKTESTING READS LIVE DATA:
    oracle_api_snapshots stores raw API responses for 6 months.
    Backtesting reads only snapshots — never live APIs.
    Backtesting is always READ-ONLY — never writes to live tables.

12. COLD START EXIT:
    zone_risk_cache.confirmed_event_count incremented on every resolved trigger with payouts.
    When count reaches 20: cold_start_mode = false automatically.
    No manual intervention required.

13. SYNDICATE RE-REGISTRATION AFTER BAN:
    Banned rider's device_fingerprint in blacklisted_devices.
    New enrollment with same device: silent reject.
    New device: syndicate_suspect_group_id linkage via IP + enrollment timing.
    Requires VOV for ALL claims in suspected syndicate component.
```

---

## 28. Background Jobs & Cron Schedule

```
All cron via pg_cron (DB server time = UTC). Times shown in UTC.

Every 5 minutes:
  - Platform health checks (Zepto, Blinkit, Instamart HTTP GET)
  - Platform down trigger evaluation
  - Liquidity snapshot (payout-service)
  - Celery queue depth metrics

Every 10 minutes:
  - Zone VOV certification accumulation check (vov-service)

Every 15 minutes:
  - Oracle data fetch (OWM, WAQI, Weatherstack, HERE)
  - Signal scoring (Layer 1 AI processing)
  - Oracle score computation (Layer 2 Bayesian)
  - Trigger evaluation for all active H3 zones
  - λ (occupancy) live update
  - Metrics snapshot (all financial + operational metrics)

Every 30 minutes:
  - Continuation loop for all active trigger_events
  - Re-evaluate oracle_score for ongoing events
  - Issue continuation top-up payouts (subject to all caps)
  - Reconciliation polling (stuck payouts in 'processing' > 10 min)

Every hour:
  - Delete expired VOV video files (ttl_delete_at < NOW())
  - Solvency ratio check + alert if < 1.2
  - Loss ratio update + guardrail check
  - Drain payout_recovery_queue (if razorpay circuit recently closed)

Every Monday 00:01 IST (Sunday 18:31 UTC):
  SELECT cron.schedule('monday-all', '31 18 * * 0', 'SELECT run_monday_cycle()');
  
  run_monday_cycle():
    1. Check cron_locks (double-run protection)
    2. Reset weekly_payout_used = 0 for ALL policies (active + paused + lapsed)
    3. Advance week_start_date to current Monday for ALL policies
    4. Compute risk scores + reputation decay for all riders (risk_scoring)
    5. Update telemetry_inferred_income for all riders (ml-service)
    6. Compute discount_weeks (Section 6.1) for all active policies
    7. Compute β from new discount_weeks
    8. Recompute P_final with new β + live λ + recent_trigger_factor
    9. Check premium_debit idempotency key (prevent double-debit)
    10. Issue Razorpay mandate charge for all active policies
    11. Process lapsed/failed → grace period flow
    12. Reset pause_count_qtr on 1st of Jan/Apr/Jul/Oct (quarterly reset)
    13. Compute segment_economics snapshot
    14. Send weekly renewal push notification to all riders

Every Monday 01:00 IST (Sunday 19:31 UTC):
  - Compute segment_economics (weekly snapshot → INSERT)
  - Retrain rider tier assignments (if quarterly reset day)

Every Tuesday 00:30 IST:
  - Final retry for lapsed policies → cancel if still failing

Daily 01:00 UTC:
  - Backup financial tables to GCS (encrypted AES-256)

Daily 02:00 UTC:
  - Supabase auto-snapshot (managed)

Daily 03:00 UTC:
  - Full Razorpay reconciliation (Layer 3)
  - Archival: export old telemetry_pings to GCS parquet

Monthly (1st, 02:00 UTC):
  - Retrain ML vulnerability index model
  - Recalibrate adaptive trigger thresholds
  - Archive old metrics_timeseries to GCS
  - Trigger data poisoning detection (before retraining)
  - Update zone_risk_cache.vulnerability_idx for all active zones

Quarterly (1st Jan/Apr/Jul/Oct):
  - Reset pause_count_qtr = 0 for all policies
  - Re-evaluate rider tier (A/B) from 90-day income telemetry
```


---

## 29. API Contract Reference

### 29.1 Rider-Facing APIs

```
POST /api/v1/auth/send-otp
Body: { phone: "+919876543210" }
Response: { otp_sent: true, expires_in: 120 }

POST /api/v1/auth/verify-otp
Body: { phone: "...", otp: "123456" }
Response: { access_token: "JWT", rider_id: "uuid" }

GET /api/v1/premium/quote?plan={plan}&hub_id={hub_id}
Auth: JWT
Response: {
  plan, daily_income, p_base, city_multiplier, lambda, beta,
  risk_multiplier, recent_trigger_factor, p_final,
  discount_weeks, weekly_cap, coverage_pct, triggers_covered: [],
  expected_payout_example: { duration_hrs: 2, mu: 1.5, amount: 210 }
}

POST /api/v1/policies
Auth: JWT
Body: { plan, hub_id, razorpay_fund_account_id }
Response: { policy_id, status, week_start_date, weekly_premium, razorpay_mandate_id }

PATCH /api/v1/policies/{policy_id}/status
Auth: JWT
Body: { action: "pause"|"resume"|"cancel", reason: "..." }
Response (pause): { new_status, pause_count_qtr, pauses_remaining, next_debit_date }
Response (cancel): { new_status, refund_amount, refund_eta }

GET /api/v1/claims?status=paid&limit=20&offset=0
Auth: JWT
Response: { claims: [...], total: N }

GET /api/v1/claims/{claim_id}/proof
Auth: JWT
Response: (see Section 10.9)

POST /api/v1/claims/{claim_id}/evidence
Auth: JWT, multipart/form-data { video: File }
Response: {
  evidence_id, exif_valid, integrity_valid, cv_confidence, gear_detected,
  contributed_to_zone_cert, zone_cert_status: {confirmed, needed},
  individual_oracle, claim_decision, payout_released
}

POST /api/v1/disputes
Auth: JWT
Body: { claim_id, reason_text }
Response: { dispute_id, sla_deadline, status }

GET /api/v1/dashboard/live
Auth: JWT
Response: {
  active_trigger: { type, duration_mins, paid_so_far, event_cap_remaining } | null,
  weekly_remaining: ₹amount,
  expected_payout_now: ₹amount,
  mu_label: "Peak hours" | "Off-peak hours",
  policy_status, discount_weeks, next_debit
}
```

### 29.2 Internal APIs (Service-to-Service)

```
POST /internal/triggers/evaluate
Body: { h3_index, trigger_type, signal_scores: {sat, weather, traffic, ...}, raw_api_data: {} }
Response: { trigger_id, oracle_score, weight_config, auto_clear, claims_initiated, vov_required_count }

POST /internal/claims/{claim_id}/score
(no body — all data fetched from DB)
Response: {
  claim_id, intent_passed, presence_confidence, oracle_confidence,
  fraud_score, decision, event_payout, headroom, actual_payout, explanation_text
}

POST /internal/payouts/process
Body: { claim_id, payout_type, amount }
Response: { payout_id, idempotency_key, razorpay_status }

POST /internal/solvency/inject
Body: { amount, reason }
Response: { injected, new_reserves }

POST /webhooks/razorpay
Headers: X-Razorpay-Signature
Body: Razorpay webhook payload
Response: 200 OK (always — Razorpay retries on non-200)
```

### 29.3 Admin APIs

```
GET /internal/admin/claims/{claim_id}/trace
Auth: admin JWT + X-Admin-Token
Response: { admin_trace JSONB, rider_explanation TEXT }

POST /internal/admin/claims/{claim_id}/action
Auth: admin JWT + X-Admin-Token
Body: { action: "approve"|"reject"|"adjust", amount?, reason }
Response: { claim_id, new_status, payout_released? }

POST /internal/admin/force-trigger
Auth: admin JWT + X-Admin-Token
Body: { h3_index, trigger_type, oracle_score }
Response: { trigger_id, is_synthetic: true, claims_initiated }

GET /internal/admin/system-config
Auth: admin JWT + X-Admin-Token
Response: { configs: [{ key, value }] }

POST /internal/admin/system-config
Auth: admin JWT + X-Admin-Token (requires typed CONFIRM for kill_switch)
Body: { key, value }
Response: { key, old_value, new_value, applied_at }

GET /internal/admin/hubs/{hub_id}/risk
Auth: Hub API key (Bearer)
Response: {
  hub_id, h3_index, current_risk_score, active_shielded_riders, total_fleet,
  shielded_pct, disruption_probability_6hr, active_trigger, weekly_payout_exposure
}
```

---

## 30. End-to-End Data Flow

### 30.1 Happy Path — Auto-Cleared Payout

```
T+0:00  Oracle worker fetches weather for all active H3 zones (every 15 min).
        OWM returns 47mm/hr for Andheri hex (hub_id: ABC, h3: 89304...)

T+0:01  signal_scoring: rain_score = 0.92 (47mm/hr → 0.70 + (12/15)×0.30 = 0.94)
        oracle computation: (0.40×0.90sat) + (0.30×0.92weather) + (0.30×0.68traffic) = 0.840
        No supplementary signals → base weights used.
        oracle_score = 0.840 ≥ 0.65 threshold → trigger fires.

T+0:01  INSERT trigger_events (triggered_at=NOW(), status='detected')
        → UPDATE status='active'
        INSERT oracle_api_snapshots (for backtesting)

T+0:02  Query all active policies in hex h3: 89304...
        For each rider (parallel via Celery):
          1. Acquire Redis lock: payout_lock:{claim_id}
          2. Check shift_state: status IN ('active','idle') within 60 min → PASS
          3. Intent check (3 factors): GPS pings ✓, session active ✓, platform online ✓
          4. Presence check: 3/3 pings within 2km ✓, velocity 12km/h ✓
          5. oracle_confidence = 0.840, presence_confidence = 1.00
          6. fraud_score = 1.0 - (0.60×0.840 + 0.40×1.0) = 1.0 - 0.904 = 0.096
          7. FS = 0.096 < 0.40 → AUTO-CLEAR

T+0:02  Payout computation:
          mu_time = MU_TABLE[20] = 1.50 (8PM IST)
          event_payout = 800 × 0.75 × (1.0/8) × 1.50 = ₹112.50 (1hr min window)
          confidence_factor = 1.00 (oracle 0.84 → band 2)
          correlation_factor = 1.00 (C = 0.15 for Andheri — isolated event)
          cooldown_factor = 1.00 (first event this hex today)
          headroom = (800×5) - 0 = ₹4,000 → actual_payout = ₹112.50

T+0:02  INSERT INTO claims (idempotency_key=SHA256(...), status='auto_cleared')
        INSERT INTO payouts (idempotency_key=SHA256(...), status='initiated')
        UPDATE policies.weekly_payout_used += 112.50

T+0:03  Razorpay payout API called → response.id returned
        UPDATE payouts SET razorpay_ref=response.id, razorpay_status='processing'
        Push notification: "₹112.50 sent to your GPay — Rain protection active"
        SMS: "GigShield: Rs 112 credited for rain. Check app."

T+0:05  Razorpay webhook: payout.processed
        UPDATE payouts SET razorpay_status='success', reconcile_status='matched'
        UPDATE claims SET paid_at=NOW()
        Redis lock released.

T+0:30  Continuation loop: re-fetch OWM → 42mm/hr → oracle_score = 0.79 ≥ 0.50 → active
        mu_current = MU_TABLE[20] = 1.50 (still 8PM)
        continuation_payout = 800 × 0.75 × (0.5/8) × 1.50 = ₹56.25
        event_total = 112.50 + 56.25 = 168.75 < single_event_cap (₹2,000) → proceed
        daily_total = 168.75 < daily_soft_limit (₹1,000) → proceed
        headroom = 4,000 - 168.75 = ₹3,831.25 → pay ₹56.25

T+1:00  Continuation loop: OWM → 18mm/hr → oracle_score = 0.42 < 0.50 → 'resolving'
T+1:30  Second consecutive check: 14mm/hr → oracle_score = 0.31 < 0.50 → 'resolved'
        trigger_events.resolved_at = NOW()
        Final top-up for last 30 min: ₹56.25 → total paid = ₹225.00

MONDAY 00:01 IST:
  week_total = ₹225.00 > 0 → discount_weeks = 0 (payout occurred → reset)
  weekly_payout_used = 0 (fresh week)
  Razorpay debit for P_final (new week)
```

### 30.2 Monday Cycle Data Flow

```
00:01 IST: pg_cron fires run_monday_cycle()
  INSERT cron_locks (double-run check)
  
  Batch UPDATE all policies:
    weekly_payout_used = 0
    week_start_date = date_trunc('week', NOW())::date
  
  For each active policy (in batches of 500):
    week_total = SELECT SUM FROM payouts WHERE rider_id=:id AND released_at IN last_week
    discount_weeks = (week_total=0) ? MIN(dw+1, 4) : 0
    β = 1.0 - (0.05 × discount_weeks)
    
    risk_score = recompute_risk_score(rider_id)
    risk_profile = classify(risk_score)
    
    recent_trigger_count = SELECT COUNT FROM trigger_events WHERE h3=:hex AND last_30_days
    
    P_final = P_base × city_mult × λ × β × risk_multiplier × recent_trigger_factor
    
    idempotency_key = SHA256(policy_id + ':' + week_start_date + ':debit')
    existing = SELECT FROM payouts WHERE idempotency_key = :key
    IF existing: skip (double-run protection)
    
    Razorpay mandate charge → INSERT payouts (payout_type='premium_debit')
    Push notification: "Coverage renewed. ₹{P_final} debited. {discount_text}"
  
  segment_economics snapshot: INSERT for last week's data
  admin_audit_log: INSERT (action='monday_cycle_complete', payload={rider_count, total_debited})

00:30 IST: Retry lapsed policies
01:00 IST: Segment economics report + alerts
```

---

## 31. Full Formula Sheet

```
══════════════════════════════════════════════════════════════════
PRICING FORMULAS
══════════════════════════════════════════════════════════════════

P_base = (Prob_disruption × expected_payout) × 1.25
  expected_payout = effective_income × coverage_pct × 0.50

P_final = P_base × city_multiplier × λ × β × risk_multiplier × recent_trigger_factor

λ = MIN(MAX(λ_floor, 1.0 + (active_count / hub_capacity)), 2.0)
β = 1.0 - (0.05 × discount_weeks)          [β ∈ {0.80, 0.85, 0.90, 0.95, 1.00}]
risk_multiplier: low=0.95, medium=1.00, high=1.15
recent_trigger_factor = MIN(1.0 + (recent_trigger_count × 0.05), 1.40)

rain_threshold_mm = 35.0 × (1 + (drainage_index - 0.5) × 0.6)

══════════════════════════════════════════════════════════════════
INCOME FORMULAS
══════════════════════════════════════════════════════════════════

effective_income = MIN(declared_income, platform_reported_avg, telemetry_inferred × 1.20)
  Fallback: MIN(declared_income, city_median_income)

telemetry_inferred = avg_shift_hrs/day × (movement_events/hr × 0.40) × city_avg_order_value

wet_bulb_Tw = T × arctan(0.151977 × √(RH+8.313659)) + arctan(T+RH)
              - arctan(RH-1.676331) + 0.00391838×RH^1.5×arctan(0.023101×RH) - 4.686035

══════════════════════════════════════════════════════════════════
ORACLE FORMULAS
══════════════════════════════════════════════════════════════════

oracle_score_base = (0.40×satellite) + (0.30×weather) + (0.30×traffic)
oracle_score_peer = (0.35×sat) + (0.25×weather) + (0.20×traffic) + (0.20×peer)
oracle_score_accel = (0.35×sat) + (0.25×weather) + (0.20×traffic) + (0.20×accel)
oracle_score_both  = (0.30×sat) + (0.20×weather) + (0.15×traffic) + (0.20×peer) + (0.15×accel)
individual_oracle_vov = (0.40×sat) + (0.30×weather) + (0.30×vov_confidence)

peer_score = CLAMP(reporting_count / insured_count_in_hex, 0.0, 1.0)
  [min 3 absolute reporters to activate]

C (correlation) = active_trigger_hexes / total_hexes_in_city
payout_factor(C): C≤0.20→1.00, C≤0.40→0.90, C≤0.60→0.80, C>0.60→0.70

──────────────────────────────────────────────────────────────────
Signal scores:
  rain: linear interpolation 0.0→1.0 across [20, 35, 50] mm/hr
  flood: 0.60×normalize(NDWI, 0.3, 0.8) + 0.40×ndma_active
  aqi: 0→200=0.0, 200→300=0.60, 300→450=0.80, 450+=1.00
  heat: 0→32°C=0.0, 32→35°C=0.50→1.00
  bandh: speed_ratio→score (0.05→1.00, 0.15→0.60, >0.15→0.00); MAX with NLP×0.80
  platform_down: 0 checks=0.0, 3+=0.50, 6+=1.00
──────────────────────────────────────────────────────────────────

VOV zone cert: confirmed ≥ 5 AND confirmed/submitted ≥ 0.80
  certified_oracle = (0.40×sat) + (0.30×weather) + (0.30×avg_cv_confidence)

══════════════════════════════════════════════════════════════════
PAYOUT FORMULAS
══════════════════════════════════════════════════════════════════

event_payout = effective_income × coverage_pct × (duration_hrs / 8) × mu_time

confidence_factor:
  oracle ≥ 0.85 → 1.00
  oracle 0.75–0.84 → 0.95
  oracle 0.65–0.74 → 0.85

final_payout = event_payout × confidence_factor × correlation_factor × cooldown_factor

headroom = (effective_income × plan_cap_multiplier) - weekly_payout_used
actual_payout = MIN(final_payout, headroom)

single_event_cap = (effective_income × plan_cap_multiplier) × 0.50
daily_soft_limit = (effective_income × plan_cap_multiplier) / 4

max_weekly_payout: Basic=3×, Standard=5×, Pro=7× effective_income

mu_time values: 0–5h=0.50, 6–7h=0.70, 8–10h=1.50, 11–17h=1.00, 18h=1.20,
               19–21h=1.50, 22h=0.80, 23h=0.50

══════════════════════════════════════════════════════════════════
FRAUD FORMULAS
══════════════════════════════════════════════════════════════════

fraud_score = 1.0 - (0.60 × oracle_confidence + 0.40 × presence_confidence)

presence_confidence: 3/3 match=1.00, 2/3=0.67, 1/3=0.33 (FAIL), 0/3=0.00

risk_score = CLAMP(claims_freq_pts + fraud_hist_pts + hard_flag_pts - vov_pts, 0, 100)
  claims_freq: >2/wk=40, >1/wk=20, >0.5/wk=10
  fraud_hist:  avg_fs>0.60=30, >0.40=15, >0.25=5
  hard_flags:  ≥2 in 90d=20, 1=10
  vov_bonus:   ≥3 submissions=-10

risk_score weekly decay: toward 50 by 2 points per clean week
  direction = -1 if score>50 else +1
  new_score = CLAMP(score + (direction × 2), 0, 100)

══════════════════════════════════════════════════════════════════
FINANCIAL FORMULAS
══════════════════════════════════════════════════════════════════

loss_ratio_30d = SUM(payouts WHERE last_30d) / SUM(premiums × weeks_active)

solvency_ratio = (capital_reserves + reinsurance_limit) / expected_claims_value

liquidity_ratio = (razorpay_balance + reserve_buffer)
                / MAX(expected_payouts_24h, 1)

recent_trigger_factor = MIN(1.0 + (recent_confirmed_events_30d × 0.05), 1.40)

══════════════════════════════════════════════════════════════════
```

---

## 32. Pseudocode for Critical Functions

### 32.1 Monday Premium Debit

```python
def run_monday_cycle():
    # Double-run protection
    result = db.execute(
        "INSERT INTO cron_locks (job_name, week_start) VALUES ('monday', date_trunc('week', NOW())::date) "
        "ON CONFLICT DO NOTHING RETURNING id"
    )
    if not result: return  # already ran

    week_start = date_trunc('week', NOW())

    # Reset weekly cap for ALL policies (active, paused, lapsed)
    db.execute("""
        UPDATE policies SET weekly_payout_used = 0, week_start_date = :ws
        WHERE status IN ('active', 'paused', 'lapsed')
    """, {'ws': week_start})

    # Process each active policy
    policies = db.query("SELECT * FROM policies WHERE status = 'active'")
    for batch in chunks(policies, 500):
        for policy in batch:
            _process_single_policy_monday(policy, week_start)


def _process_single_policy_monday(policy, week_start):
    rider = get_rider(policy.rider_id)
    hub = get_hub(policy.hub_id)

    # 1. Compute week_total for discount logic
    week_total = db.scalar("""
        SELECT COALESCE(SUM(amount), 0) FROM payouts
        WHERE rider_id = :rid AND released_at >= :ws AND released_at < :ws + INTERVAL '7 days'
    """, {'rid': rider.id, 'ws': week_start - timedelta(days=7)})

    # 2. Update discount_weeks
    if week_total == 0 and not rider.beta_freeze_until > NOW():
        policy.discount_weeks = min(policy.discount_weeks + 1, 4)
    else:
        policy.discount_weeks = 0

    # 3. Recompute risk score
    rider.risk_score = compute_risk_score(rider.id)
    rider.risk_profile = classify_risk(rider.risk_score)

    # 4. Compute P_final
    beta = 1.0 - (0.05 * policy.discount_weeks)
    risk_mult = {'low': 0.95, 'medium': 1.00, 'high': 1.15}[rider.risk_profile]
    active_count = count_active_policies_in_hex(hub.h3_index_res9)
    lambda_val = min(max(get_lambda_floor(), 1.0 + active_count / hub.capacity), 2.0)
    recent_count = count_recent_triggers(hub.h3_index_res9)
    recent_factor = min(1.0 + recent_count * 0.05, 1.40)
    p_final = compute_p_base(rider, hub) * hub.city_multiplier * lambda_val * beta * risk_mult * recent_factor

    # 5. Idempotency key
    idem_key = sha256(f"{policy.id}:{week_start}:debit")
    existing = db.scalar("SELECT id FROM payouts WHERE idempotency_key = :k", {'k': idem_key})
    if existing: return  # already debited

    # 6. Razorpay mandate charge
    try:
        response = razorpay_cb.call(charge_mandate, policy.razorpay_mandate_id, p_final)
        db.insert('payouts', {
            'policy_id': policy.id, 'rider_id': rider.id,
            'amount': p_final, 'payout_type': 'premium_debit',
            'razorpay_ref': response.id, 'razorpay_status': 'success',
            'idempotency_key': idem_key
        })
    except Exception as e:
        policy.status = 'lapsed'
        notify(rider, 'policy_lapsed')
        schedule_retry(policy.id, delay_hours=24)

    db.save(policy, rider)
    notify(rider, 'policy_renewed', premium=p_final, discount_weeks=policy.discount_weeks)
```

### 32.2 Trigger Evaluation

```python
def evaluate_oracle_for_hex(h3_index: str, trigger_type: str) -> Optional[str]:
    """Returns trigger_id if fired, None otherwise."""
    
    hub = get_hub_for_hex(h3_index)
    cold_start = is_cold_start(h3_index)
    threshold = 0.75 if cold_start else get_config('oracle_threshold', 0.65)

    # Fetch signals via fallback hierarchy
    signals = {}
    penalties = {}
    
    sat_val, sat_src, sat_pen = fetch_with_fallback(
        get_satellite_score, get_ndma_score, f"oracle:flood:{h3_index}:{bucket()}", 7200)
    signals['satellite'] = sat_val
    penalties['satellite'] = sat_pen

    weather_val, weather_src, weather_pen = fetch_with_fallback(
        get_owm_score, get_imd_score, f"oracle:weather:{h3_index}:{bucket()}", 900)
    signals['weather'] = weather_val
    penalties['weather'] = weather_pen

    traffic_val, traffic_src, traffic_pen = fetch_with_fallback(
        get_here_traffic_score, get_google_routes_score, f"oracle:traffic:{h3_index}:{bucket()}", 600)
    signals['traffic'] = traffic_val
    penalties['traffic'] = traffic_pen

    # Determine weight config based on supplementary signals
    peer_active = is_peer_consensus_active(h3_index)
    accel_active = is_accel_signal_active(h3_index)
    weights, config_name = get_weight_config(peer_active, accel_active)

    # Apply confidence penalties (reduce weights for degraded signals)
    weights = apply_penalties(weights, penalties)
    weights = renormalize(weights)  # ensure sum = 1.0

    # Compute oracle score
    oracle_score = sum(weights[k] * (signals.get(k) or 0) for k in weights)

    # Check duplicate trigger
    existing = db.scalar("""
        SELECT id FROM trigger_events
        WHERE h3_index = :hex AND trigger_type = :type
          AND triggered_at >= NOW() - INTERVAL '15 min'
    """, {'hex': h3_index, 'type': trigger_type})
    if existing: return existing

    # Check cooldown
    cooldown_mins = COOLDOWN_MINUTES[trigger_type]
    cooldown_event = db.fetchone("""
        SELECT id, cooldown_active FROM trigger_events
        WHERE h3_index = :hex AND trigger_type = :type
          AND status = 'resolved' AND resolved_at >= NOW() - INTERVAL ':min min'
    """, {'hex': h3_index, 'type': trigger_type, 'min': cooldown_mins})

    if oracle_score >= threshold:
        trigger_id = db.insert('trigger_events', {
            'trigger_type': trigger_type, 'h3_index': h3_index,
            'hub_id': hub.id, 'oracle_score': oracle_score,
            'weight_config': config_name, 'status': 'active',
            'cold_start_mode': cold_start,
            'cooldown_active': bool(cooldown_event),
            'cooldown_payout_factor': 0.50 if cooldown_event else 1.00,
            'correlation_factor': compute_correlation(hub.city),
            **{f"{k}_score": signals.get(k) for k in ['satellite','weather','traffic','peer','accel']}
        })
        db.insert('oracle_api_snapshots', {
            'h3_index': h3_index, 'trigger_type': trigger_type,
            'api_source': weather_src, 'raw_value': ..., 'signal_score': weather_val
        })
        log_metric('trigger_fired', labels={'type': trigger_type, 'city': hub.city})
        initiate_claims_for_hex.delay(h3_index, trigger_id)
        return trigger_id

    elif 0.30 <= oracle_score < threshold:
        # Uncertain — prompt VOV for riders in hex
        prompt_vov_for_hex.delay(h3_index, trigger_type, oracle_score)
        return None
    
    return None  # oracle_score < 0.30 — deny
```

### 32.3 Payout Processing

```python
def process_claim_payout(claim_id: str, payout_type: str = 'initial'):
    lock_key = f"payout_lock:{claim_id}"
    
    # Layer 1: Redis lock
    if not redis.set(lock_key, '1', nx=True, ex=60):
        return {'status': 'skipped', 'reason': 'lock_held'}
    
    try:
        with db.transaction():
            # Layer 2: SELECT FOR UPDATE SKIP LOCKED
            claim = db.fetchone(
                "SELECT * FROM claims WHERE id = :id FOR UPDATE SKIP LOCKED",
                {'id': claim_id}
            )
            if not claim: return {'status': 'skipped', 'reason': 'locked_by_other'}

            policy = get_policy(claim.policy_id)
            rider  = get_rider(claim.rider_id)
            trigger = get_trigger(claim.trigger_id)

            # Compute payout
            mu = MU_TABLE[get_ist_hour(trigger.triggered_at)]
            duration = MIN_DURATION[trigger.trigger_type] if payout_type == 'initial' else 0.5
            event_payout = rider.effective_income * policy.coverage_pct * (duration/8) * mu

            conf_factor = get_confidence_factor(claim.oracle_confidence)
            corr_factor = trigger.correlation_factor
            cool_factor = trigger.cooldown_payout_factor
            final_payout = event_payout * conf_factor * corr_factor * cool_factor

            max_weekly = rider.effective_income * policy.plan_cap_multiplier
            headroom = max_weekly - policy.weekly_payout_used
            
            if headroom <= 0:
                db.update('claims', {'id': claim_id, 'status': 'cap_exhausted'})
                notify(rider, 'weekly_cap_reached', cap=max_weekly)
                return {'status': 'cap_exhausted'}
            
            actual_payout = min(final_payout, headroom)

            # Check event cap
            event_total = db.scalar("""
                SELECT COALESCE(SUM(amount),0) FROM payouts p
                JOIN claims c ON p.claim_id = c.id
                WHERE c.trigger_id = :tid AND c.rider_id = :rid
            """, {'tid': trigger.id, 'rid': rider.id})
            
            single_event_cap = max_weekly * 0.50
            if event_total >= single_event_cap:
                notify(rider, 'event_cap_reached', event_cap=single_event_cap,
                       remaining_weekly=headroom)
                return {'status': 'event_cap_reached'}

            # Layer 3: atomic status guard
            rows = db.execute(
                "UPDATE claims SET status='paid', paid_at=NOW() "
                "WHERE id = :id AND status != 'paid' RETURNING id",
                {'id': claim_id}
            ).rowcount
            if rows == 0: return {'status': 'already_paid'}

            # Update weekly usage
            db.execute(
                "UPDATE policies SET weekly_payout_used = weekly_payout_used + :amt WHERE id = :pid",
                {'amt': actual_payout, 'pid': policy.id}
            )

            # Generate idempotency key
            idem_key = sha256(f"{claim_id}:{payout_type}:{actual_payout}")

            # Layer 4: UNIQUE constraint catches any remaining race
            result = db.execute("""
                INSERT INTO payouts (claim_id, rider_id, policy_id, amount, payout_type, 
                                     idempotency_key, razorpay_status)
                VALUES (:cid, :rid, :pid, :amt, :pt, :ik, 'initiated')
                ON CONFLICT (idempotency_key) DO NOTHING
                RETURNING id
            """, {
                'cid': claim_id, 'rid': rider.id, 'pid': policy.id,
                'amt': actual_payout, 'pt': payout_type, 'ik': idem_key
            })
            
            if not result.fetchone():
                return {'status': 'skipped', 'reason': 'idempotency_conflict'}

        # Call Razorpay (outside transaction to avoid long-held locks)
        try:
            rz_response = razorpay_cb.call(create_payout, rider.razorpay_fund_account_id,
                                            actual_payout, idem_key)
            db.execute(
                "UPDATE payouts SET razorpay_ref=:ref, razorpay_status='processing' "
                "WHERE idempotency_key=:ik",
                {'ref': rz_response.id, 'ik': idem_key}
            )
        except CircuitOpenError:
            db.execute(
                "UPDATE payouts SET razorpay_status='circuit_breaker_hold' WHERE idempotency_key=:ik",
                {'ik': idem_key}
            )
            redis.zadd('payout_recovery_queue', {idem_key: time.time()})
            notify(rider, 'payout_queued', amount=actual_payout, eta_hours=0.5)
            return {'status': 'circuit_breaker_hold'}

        notify(rider, 'payout_success', amount=actual_payout, trigger_type=trigger.trigger_type)
        log_metric('payout_issued', labels={'type': payout_type, 'amount': actual_payout})
        return {'status': 'success', 'amount': actual_payout, 'payout_type': payout_type}

    finally:
        redis.delete(lock_key)
```

### 32.4 VOV Zone Certification Check

```python
def check_vov_zone_certification(h3_index: str, trigger_id: str):
    result = db.fetchone("""
        SELECT
            COUNT(*) FILTER (WHERE cv_confidence >= 0.70) AS confirmed,
            COUNT(*) AS submitted,
            AVG(cv_confidence) FILTER (WHERE cv_confidence >= 0.70) AS avg_conf
        FROM claim_evidence
        WHERE h3_index = :hex
          AND created_at >= (SELECT triggered_at FROM trigger_events WHERE id = :tid)
          AND created_at <= (SELECT triggered_at FROM trigger_events WHERE id = :tid) + INTERVAL '3 hours'
    """, {'hex': h3_index, 'tid': trigger_id})

    confirmed = result.confirmed or 0
    submitted = result.submitted or 0
    avg_conf  = result.avg_conf or 0.0

    # Certification requires BOTH conditions (fixes minimum sample size gap)
    if confirmed >= 5 and submitted > 0 and (confirmed / submitted) >= 0.80:
        # Certify zone
        db.insert('zone_vov_certs', {
            'h3_index': h3_index, 'trigger_id': trigger_id,
            'submitted_count': submitted, 'confirmed_count': confirmed,
            'avg_cv_confidence': avg_conf, 'certified': True,
            'certified_at': NOW(), 'expires_at': NOW() + timedelta(hours=2)
        })
        db.execute(
            "UPDATE trigger_events SET vov_zone_certified=true, vov_cert_score=:score WHERE id=:tid",
            {'score': avg_conf, 'tid': trigger_id}
        )

        # New oracle score for all riders in hex
        trigger = get_trigger(trigger_id)
        certified_oracle = (0.40 * (trigger.satellite_score or 0)
                          + 0.30 * (trigger.weather_score or 0)
                          + 0.30 * avg_conf)

        # Batch initiate claims for all eligible active policies in hex
        policies = db.query("""
            SELECT p.* FROM policies p
            JOIN hubs h ON p.hub_id = h.id
            WHERE h.h3_index_res9 = :hex AND p.status = 'active'
        """, {'hex': h3_index})

        for policy in policies:
            initiate_claim_if_eligible.delay(policy.id, trigger_id, certified_oracle)

        # Issue VOV zone-cert rewards to contributors
        contributors = db.query("""
            SELECT DISTINCT rider_id FROM claim_evidence
            WHERE h3_index = :hex AND cv_confidence >= 0.70
              AND created_at >= (SELECT triggered_at FROM trigger_events WHERE id = :tid)
        """, {'hex': h3_index, 'tid': trigger_id})
        
        for contrib in contributors:
            db.execute(
                "UPDATE claim_evidence SET contributed_to_zone_cert=true WHERE rider_id=:rid AND h3_index=:hex",
                {'rid': contrib.rider_id, 'hex': h3_index}
            )
            issue_vov_reward.delay(contrib.rider_id, 'zone_cert', amount=20)

        return True
    
    return False
```

---

## 33. Known Tradeoffs

| # | Tradeoff | Decision | Rationale |
|---|---|---|---|
| 1 | λ recalculated live but premium weekly-fixed | Accept | Stability > perfection for weekly product. "Surge notice" in app when λ > 1.5 |
| 2 | μ_time fixed at initial payout hour | Accept | Continuation payouts correctly use current hour. Net effect over event is accurate |
| 3 | effective_income uses MIN() — may under-compensate | Accept | Conservative prevents fraud. Rider can dispute with order history evidence |
| 4 | VOV reward resets discount_weeks | Accept | Any payout = reset. Rule is absolute and unambiguous. VOV worth it for genuine evidence |
| 5 | Confidence-weighted 85% payout at marginal oracle | Accept | Disclosed. Rider can always VOV to get full amount. Protects pool |
| 6 | Platform API absence → soft-flag (not auto-clear) | Accept | Correct behavior when primary intent signal unavailable |
| 7 | Cold start uses 0.75 threshold (misses some real events) | Accept | Safety > recall for new zones. 20 events to graduate is achievable in one monsoon season |
| 8 | Daily soft limit can delay continuation payouts | Accept | Prevents one 12-hour event from exhausting full weekly cap on day 1 |
| 9 | Free tier API limits restrict to ~10 active hexes | Accept | Sufficient for MVP. Scale trigger defined (Section 26.2) |
| 10 | Backtesting reads oracle_api_snapshots (6-month lag) | Accept | Backtesting is for config validation, not real-time. 6 months is sufficient |

---

## 34. Master AI Build Prompt

The following prompt is designed to be given to an AI assistant (Claude, GPT-4, etc.) to build GigShield end-to-end from scratch. It encapsulates the entire system in a single buildable prompt.

---

```
You are building GigShield — a production-grade parametric income protection platform
for Q-Commerce delivery riders in India (Zepto, Blinkit, Swiggy Instamart).

════════════════════════════════════════════════════════════
CORE CONCEPT
════════════════════════════════════════════════════════════
GigShield monitors real-world data signals (weather, AQI, traffic, satellite, platform
health). When a signal crosses a threshold in a rider's registered hub zone, it
automatically scores a claim and sends a UPI payout via Razorpay — with zero rider action.

Riders pay a weekly premium (debited every Monday). Payouts are income-relative
(₹effective_income × coverage% × hours_disrupted/8 × time_multiplier), not fixed amounts.

════════════════════════════════════════════════════════════
TECH STACK
════════════════════════════════════════════════════════════
Frontend:   Next.js 14 (App Router) + Tailwind CSS + shadcn/ui. PWA (offline support).
            Mobile-first. Supabase real-time for live dashboard updates.
Backend:    FastAPI (Python 3.11). Celery + Redis for async tasks.
Database:   Supabase (PostgreSQL 15 + Row-Level Security + real-time + auth).
Storage:    Supabase Storage (VOV videos, 48hr TTL auto-delete).
Payments:   Razorpay (UPI payouts + mandate debits + webhook handling).
ML:         YOLOv8n (CPU inference via Celery for VOV), scikit-learn GBM (risk scoring).
Geospatial: h3-py (Python), h3-js (frontend). Uber H3 Resolution 9 (~170m).
Cache:      Redis (Upstash free tier). Circuit breaker state, API response cache.
Scheduling: pg_cron (all cron runs on DB server time = UTC. NEVER local server time).
Deployment: Vercel (Next.js) + Render (FastAPI + Celery) + Supabase.
Monitoring: Supabase logs + custom metrics_timeseries table + admin dashboard.

════════════════════════════════════════════════════════════
SIX TRIGGERS (what causes payouts)
════════════════════════════════════════════════════════════
rain:          OWM > hub.rain_threshold_mm/hr (adaptive, default 35mm/hr)
flood:         NDMA advisory + Earth Engine NDWI > 0.3
heat:          Wet bulb temp > 32°C (Stull formula from OWM temp+humidity)
aqi:           WAQI > 200 (standard) or > 450 (hazardous)
bandh:         Road speed < 15% of 30-day baseline (HERE Maps)
platform_down: HTTP health check fails 6 consecutive times (30 min)

════════════════════════════════════════════════════════════
THREE PLANS
════════════════════════════════════════════════════════════
basic:    ₹29/wk | rain + bandh + platform_down | 50% coverage | 3× income cap
standard: ₹49/wk | basic + flood + aqi          | 75%/65% (Tier A/B) | 5× income cap
pro:      ₹79/wk | all 6 triggers               | 92%/88% (Tier A/B) | 7× income cap

════════════════════════════════════════════════════════════
PRICING FORMULA
════════════════════════════════════════════════════════════
P_final = P_base × city_multiplier × λ × β × risk_multiplier × recent_trigger_factor

P_base = (vulnerability_idx × effective_income × coverage_pct × 0.50) × 1.25
λ = MIN(MAX(λ_floor, 1.0 + active_policies/hub_capacity), 2.0)
β = 1.0 - (0.05 × discount_weeks)  [0–4 clean weeks → 0–20% discount]
risk_multiplier: low=0.95, medium=1.00, high=1.15
recent_trigger_factor = MIN(1.0 + confirmed_events_30d × 0.05, 1.40)

discount_weeks: increments +1 if SUM(payouts this week) = 0, resets to 0 otherwise.
"Any payout" = any row in payouts table for that rider that week. No exceptions.

════════════════════════════════════════════════════════════
PAYOUT FORMULA
════════════════════════════════════════════════════════════
event_payout = effective_income × coverage_pct × (duration_hrs/8) × mu_time
final_payout = event_payout × confidence_factor × correlation_factor × cooldown_factor
actual_payout = MIN(final_payout, headroom)  [headroom = weekly_cap - weekly_payout_used]

weekly_cap = effective_income × plan_cap_multiplier
single_event_cap = weekly_cap × 0.50  [max from one continuous event]
daily_soft_limit = weekly_cap / 4    [soft limit per calendar day]

mu_time (all 24 IST hours defined):
  0–5: 0.50, 6–7: 0.70, 8–10: 1.50, 11–17: 1.00, 18: 1.20, 19–21: 1.50, 22: 0.80, 23: 0.50

confidence_factor: oracle≥0.85→1.00, 0.75–0.84→0.95, 0.65–0.74→0.85
correlation_factor: based on fraction of city hexes affected (0.70–1.00)

════════════════════════════════════════════════════════════
ORACLE ENGINE (Bayesian, multi-source)
════════════════════════════════════════════════════════════
Base: oracle_score = 0.40×satellite + 0.30×weather + 0.30×traffic
With peer (>15% riders report): 0.35×sat + 0.25×weather + 0.20×traffic + 0.20×peer
With accel (rider stationary 20+ min): 0.35×sat + 0.25×weather + 0.20×traffic + 0.20×accel
Both supplementary: 0.30×sat + 0.20×weather + 0.15×traffic + 0.20×peer + 0.15×accel

oracle_score ≥ 0.65 → fire trigger (auto-clear)
0.30 ≤ score < 0.65 → offer VOV to riders
score < 0.30 → deny (no VOV)

API fallback hierarchy: primary → fallback → cached (with confidence penalty) → skip
On skip: renormalize remaining weights to sum to 1.0.

════════════════════════════════════════════════════════════
FRAUD ENGINE (3-layer)
════════════════════════════════════════════════════════════
Layer 1 - Intent (3 factors, ALL required within 60 min before trigger):
  F1: GPS movement (≥3 pings, not stationary at residential 45+ min)
  F2: App session heartbeat (at least 1 in 60 min window)
  F3: Platform status = 'available' or 'on_delivery' (soft requirement, fallback to N/A)
  ANY factor fail → fraud_score = 1.0 → hard-flag → STOP

Layer 2 - Presence (Haversine distance):
  Last 3 GPS pings: ≥2/3 must be within hub.radius_km (2km) OR adjacent H3 cell
  GPS velocity > 150 km/h between any pings → fraud_score = 1.0 → hard-flag → STOP
  presence_confidence: 3/3→1.00, 2/3→0.67, <2/3→FAIL

Layer 3 - Bayesian fraud score:
  fraud_score = 1.0 - (0.60 × oracle_confidence + 0.40 × presence_confidence)
  FS < 0.40 → auto-clear | 0.40–0.70 → soft-flag | > 0.70 → hard-flag

VOV (Visual Oracle Verification):
  EXIF GPS must match H3 zone. Timestamp ±30 min of trigger. Integrity hash.
  YOLOv8n detects: rain streaks, standing water, crowds, barricades, delivery gear.
  cv_confidence ≥ 0.70 → confirmed. Gear detected → boost to 0.95.
  Zone cert: ≥5 confirmed AND ≥80% ratio → auto-clear ALL eligible riders in hex.

════════════════════════════════════════════════════════════
CRITICAL IMPLEMENTATION RULES
════════════════════════════════════════════════════════════
1. ALL timestamps from PostgreSQL NOW() only. Never local server time.
2. ALL money operations: idempotency key = SHA-256(entity_ids + type + amount).
   Check UNIQUE constraint BEFORE calling Razorpay.
3. SELECT FOR UPDATE SKIP LOCKED before any claim processing (prevents double-spend).
4. Redis lock (nx=True, ex=60) as first gate in every Celery payout task.
5. Circuit breakers (closed/open/half-open) per external dependency stored in Redis.
6. cron_locks table: INSERT ON CONFLICT DO NOTHING before every cron job.
7. Razorpay webhook: store event_id in webhook_events, skip if already processed.
8. State machine transitions enforced by DB triggers (no skipping states).
9. weekly_payout_used resets every Monday regardless of policy status (paused/lapsed too).
10. VOV zone certification requires ≥5 CONFIRMED (absolute minimum) AND ≥80% ratio.

════════════════════════════════════════════════════════════
DATABASE SCHEMA (KEY TABLES)
════════════════════════════════════════════════════════════
riders (id, phone, effective_income, tier, risk_score, risk_profile, device_fingerprint,
        experiment_group_id, ...)
hubs (id, h3_index_res9, city_multiplier, drainage_index, rain_threshold_mm, capacity, ...)
policies (id, rider_id, hub_id, plan, status, coverage_pct, plan_cap_multiplier,
          weekly_premium, discount_weeks, weekly_payout_used, week_start_date, ...)
telemetry_pings (id, rider_id, h3_index_res9, speed_kmh, platform_status,
                 session_active, is_bundle, bundle_hash, recorded_at, ...)
shift_states (id, rider_id, status [active|idle|offline], started_at, ended_at, ...)
trigger_events (id, trigger_type, h3_index, oracle_score, correlation_factor,
                cooldown_payout_factor, vov_zone_certified, status, ...)
claims (id, rider_id, policy_id, trigger_id, idempotency_key, status, fraud_score,
        event_payout, actual_payout, admin_trace JSONB, ...)
payouts (id, claim_id, rider_id, amount, payout_type, razorpay_ref UNIQUE,
         idempotency_key UNIQUE, razorpay_status, reconcile_status, ...)
claim_evidence (id, claim_id, h3_index, video_url, exif_valid, cv_confidence,
                gear_detected, contributed_to_zone_cert, ttl_delete_at, ...)
zone_vov_certs (id, h3_index, trigger_id, confirmed_count, certified, certified_at, ...)
system_config (key, value) -- global_kill_switch, liquidity_mode, lambda_floor, ...
experiments (id, parameter_name, parameter_value, group_id, active, ...)
liquidity_snapshots, metrics_timeseries, reconciliation_reports, admin_audit_log,
circuit_breaker_events, fraud_clusters, entity_state_log, webhook_events, ...

════════════════════════════════════════════════════════════
ADMIN PANEL TABS
════════════════════════════════════════════════════════════
1. Dashboard: real-time KPIs, circuit breaker states, kill switch control
2. Fraud Queue: hard-flagged claims with full trace, approve/reject/adjust actions
3. Rider Support: search by phone, view full history, manual overrides, goodwill credits
4. Backtesting: READ-ONLY replay of historical API data through oracle logic
5. Stress Testing: SIMULATION ONLY financial scenarios (no live state changes)
6. Experiments: LIVE parameter changes (sliders + group targeting + typed CONFIRM)
7. Economics: segment loss ratios, per-city profitability, alerts for bad segments

════════════════════════════════════════════════════════════
BACKGROUND JOBS (all pg_cron UTC times)
════════════════════════════════════════════════════════════
Every 5 min: platform health checks, liquidity snapshot
Every 15 min: oracle fetch + score + trigger eval + metrics
Every 30 min: continuation payouts, reconciliation polling
Every Monday 18:31 UTC (00:01 IST): full Monday cycle
  (reset caps, compute discount/risk/premium, debit Razorpay, notify riders)
Daily 03:00 UTC: full Razorpay reconciliation, data archival
Monthly 1st 02:00 UTC: ML retrain, threshold recalibration

════════════════════════════════════════════════════════════
BUILD ORDER (recommended)
════════════════════════════════════════════════════════════
Phase 1 (MVP — mock APIs):
  1. Supabase schema (all tables, indexes, RLS)
  2. Rider onboarding flow (Next.js + Supabase auth)
  3. Policy engine (premium calculation, 3 plans)
  4. Mock Oracle (hardcoded trigger for demo)
  5. Payout engine (formula + Razorpay sandbox)
  6. Rider dashboard (live tracker, proof of oracle)
  7. Admin panel (all tabs, God Mode simulation)

Phase 2 (Scale — live APIs):
  8. Real Oracle (OWM + WAQI + HERE + Earth Engine + fallback hierarchy)
  9. Intent check (3-factor + shift detection)
  10. Fraud scoring (presence check + Bayesian FS)
  11. Monday pg_cron job (full premium debit cycle)
  12. Razorpay webhooks + reconciliation
  13. Idempotency + circuit breakers + race condition protection
  14. Liquidity engine + loss ratio guardrails

Phase 3 (Production):
  15. YOLOv8n VOV (EXIF check + inference + zone cert)
  16. ML vulnerability index (GBM training pipeline)
  17. Geospatial fraud clustering detection
  18. Backtesting + stress test engines
  19. A/B experimentation framework
  20. Notification system (push + SMS)
  21. Legal/compliance layer (KYC, consent logs)
  22. Disaster recovery runbook + DR drills

════════════════════════════════════════════════════════════
DO NOT:
  - Use local server time anywhere (always PostgreSQL NOW())
  - Call Razorpay without checking idempotency_key UNIQUE first
  - Process claims without SELECT FOR UPDATE SKIP LOCKED
  - Add flat bonuses to oracle score (always recalibrate weights to sum 1.0)
  - Stack multiple trigger payouts (always MAX of concurrent triggers)
  - Increment discount_weeks without checking ALL payouts for the week
  - Allow VOV zone cert with < 5 confirmed videos
  - Store raw Aadhaar or PAN numbers (SHA-256 hash only)
  - Allow experiments to affect the holdout group
  - Allow admin to bypass idempotency or hard fraud gates via experiment config

════════════════════════════════════════════════════════════
START HERE:
  Read the full GigShield v3.0 specification.
  Begin with the Supabase schema (Section 2.1 of spec).
  Then build: policy-service → oracle-service → fraud-service → payout-service.
  Frontend (Next.js PWA) can be built in parallel using mock API responses.
  Every money operation must have an idempotency key before any Razorpay call.
  Every service must use PostgreSQL NOW() for all timestamps.
════════════════════════════════════════════════════════════
```

---

*GigShield Production Engineering Specification v3.0*  
*Generated: March 2026*  
*Status: Implementation-ready. No assumptions left undefined.*  
*All 28 features + 15 second-order problems + 15 final critical gaps fully resolved.*

