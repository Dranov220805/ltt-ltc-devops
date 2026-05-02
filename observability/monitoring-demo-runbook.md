# Monitoring Demonstration Runbook (24-48h)

## Goal
Demonstrate deployment stability, autoscaling, and rollback readiness over a sustained runtime window.

## Dashboards and Signals
- Cluster and node CPU/memory saturation.
- Pod restarts, OOM kills, and readiness/liveness failures.
- API latency p95/p99 and error rate.
- HPA desired/current replica count over time.
- Queue/stream lag metrics for asynchronous workloads (Kafka if enabled).

## Deployment Events to Capture
- Deployment start and completion timestamps per cluster wave.
- Canary and/or blue-green rollout outcomes.
- Rollback trigger reason and rollback completion time.

## Test Procedure
1. Start normal traffic observation (baseline) for at least 30 minutes.
2. Run Gatling load tiers: 10, 100, and 1000 users.
3. During each tier, collect:
   - scale-up latency
   - peak error rate
   - seat-lock conflict response distribution (2xx/4xx)
4. Validate system behavior under seat-hold timeout.
5. Optionally force a bad release and confirm rollback execution.

## Evidence Package
- Screenshots of Grafana dashboards for each test tier.
- Exported logs for deployment and API errors.
- CI/CD run links for deploy and performance workflows.
- Summary table:
  - tier
  - max replicas
  - p95 latency
  - error rate
  - rollback required (yes/no)

## Exit Criteria
- Service remains reachable for full observation window.
- HPA reacts to load without sustained saturation.
- Rollback path is validated at least once in controlled scenario.
