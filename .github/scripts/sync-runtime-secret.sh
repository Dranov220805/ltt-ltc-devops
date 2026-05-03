#!/usr/bin/env bash
# Optional: create/update Secret for Helm envFrom. Requires SYNC_RUNTIME_SECRET=true and NS set.
# GitHub Actions passes APP_* env vars from secrets (never echo values).

sync_runtime_secret() {
  local name="${RUNTIME_SECRET_NAME:-api-runtime-env}"
  [[ "${SYNC_RUNTIME_SECRET:-}" == "true" ]] || return 0

  local args=()
  [[ -n "${APP_MONGO_URI:-}" ]] && args+=(--from-literal=MONGO_URI="${APP_MONGO_URI}")
  [[ -n "${APP_SESSION_SECRET:-}" ]] && args+=(--from-literal=SESSION_SECRET="${APP_SESSION_SECRET}")
  [[ -n "${APP_REDIS_URL:-}" ]] && args+=(--from-literal=REDIS_URL="${APP_REDIS_URL}")
  [[ -n "${APP_S3_BUCKET:-}" ]] && args+=(--from-literal=S3_BUCKET="${APP_S3_BUCKET}")
  local aws_region="${APP_AWS_REGION:-${AWS_REGION:-}}"
  [[ -n "${aws_region}" ]] && args+=(--from-literal=AWS_REGION="${aws_region}")

  if [[ ${#args[@]} -eq 0 ]]; then
    echo "::warning::SYNC_RUNTIME_SECRET is true but no APP_* secrets (and no AWS_REGION); skipping Secret apply."
    return 0
  fi

  kubectl create secret generic "${name}" "${args[@]}" \
    --namespace "${NS}" \
    --dry-run=client -o yaml | kubectl apply -f -
  echo "Applied Secret ${name} in namespace ${NS} (keys only — values redacted)."
}
