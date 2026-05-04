# CI/CD Pipeline Setup and Operations Runbook

This document explains how to set up, run, and troubleshoot the GitHub Actions deployment pipeline for the API application in this repository.

Primary workflow: [`Final_Project/.github/workflows/node_deployment.yml`](D:/HK6/(DevOps) Software Development, Operations And Maintenance/Final_Project/.github/workflows/node_deployment.yml)

Related script: [`Final_Project/.github/scripts/sync-runtime-secret.sh`](D:/HK6/(DevOps) Software Development, Operations And Maintenance/Final_Project/.github/scripts/sync-runtime-secret.sh)

Helm chart: [`Final_Project/helm/app`](D:/HK6/(DevOps) Software Development, Operations And Maintenance/Final_Project/helm/app)

---

## 1) Pipeline architecture

The deployment workflow does the following:

1. Runs CI gates (`reusable-ci.yml`).
2. Lints and renders Helm templates.
3. Validates AWS deploy variables.
4. Builds Docker image and pushes to ECR.
5. Deploys to blue clusters using Helm upgrade.
6. Optionally waits stabilization window.
7. Optionally deploys to green clusters with rollback logic.

Blue/green and canary strategy are controlled by workflow inputs and chart overrides.

---

## 2) Required GitHub configuration

### Repository variables

Set these in GitHub repository settings:

- `AWS_REGION` (example: `ap-southeast-1`)
- `AWS_ROLE_TO_ASSUME` (IAM role ARN for GitHub OIDC)
- `ECR_REPOSITORY_NAME` (example: `devops-final-app`)
- `EKS_CLUSTER_NAME` or `EKS_BLUE_CLUSTERS`
- `HELM_CHART_PATH` (default `helm/app`)
- `HELM_RELEASE_NAME` (default `api`)
- `K8S_NAMESPACE` (default `default`)
- `K8S_DEPLOYMENT_NAME` (default `api-app`)
- `HELM_VALUES_FILE` (default `helm/app/values.deploy.yaml`)
- `HELM_INSTALL_TIMEOUT` (example: `5m` or `20m`)
- `UPLOADS_STORAGE_CLASS` (set to `gp2` for current cluster, unless `gp3` exists)

Optional variables:

- `SYNC_K8S_RUNTIME_SECRET` (`true` to sync runtime Secret each deploy)
- `RUNTIME_SECRET_NAME` (default `api-runtime-env`)
- `INCLUSTER_DATA_SERVICES` (`true` for in-cluster Mongo/Redis mode)
- `K8S_MONGO_SERVICE_NAME` (default `mongodb`)
- `K8S_REDIS_SERVICE_NAME` (default `redis`)
- `K8S_MONGO_DB_NAME` (default `products_db`)

### Repository secrets

Required:

- `APP_SESSION_SECRET`

Optional (overrides derived defaults):

- `APP_MONGO_URI`
- `APP_REDIS_URL`
- `APP_S3_BUCKET` (keep empty for in-cluster uploads PVC mode)
- `APP_AWS_REGION`

---

## 3) Runtime modes

### Managed AWS mode (legacy)

- `APP_MONGO_URI` points to DocumentDB
- `APP_REDIS_URL` points to ElastiCache
- `APP_S3_BUCKET` set

### In-cluster stateful mode (current target)

- `MONGO_URI` derived or set to `mongodb://mongodb.default.svc.cluster.local:27017/products_db`
- `REDIS_URL` derived or set to `redis://redis.default.svc.cluster.local:6379`
- `S3_BUCKET` empty
- `uploadsPersistence.enabled=true` in deploy values
- `uploadsPersistence.storageClass` must match an existing cluster StorageClass (currently `gp2`)

---

## 4) Manual deployment command (equivalent to CI fix path)

When running manually, use explicit image and storage class:

```bash
helm upgrade --install api ./helm/app -n default -f ./helm/app/values.deploy.yaml \
  --set-string image.repository=525089404588.dkr.ecr.ap-southeast-1.amazonaws.com/devops-final-app \
  --set-string image.tag=<IMAGE_TAG> \
  --set-string uploadsPersistence.storageClass=gp2
```

Then verify:

```bash
kubectl rollout status deployment/api-app -n default --timeout=10m
kubectl get pods -n default -o wide
kubectl get pvc -n default
```

---

## 5) Job-by-job troubleshooting

### A) `UPGRADE FAILED: another operation is in progress`

Cause:
- A prior Helm operation is still pending/canceling.

Actions:
1. Check status/history:
   - `helm status api -n default`
   - `helm history api -n default`
2. If stuck, wait or run another `helm upgrade` after status settles.
3. Re-run deploy with explicit image and storage class.

### B) New pod in `ImagePullBackOff` with `changeme.example.com/app:latest`

Cause:
- Helm deployed with default chart image values, no CI image override.

Actions:
- Always pass `--set-string image.repository` and `--set-string image.tag`.
- Confirm pod image:
  - `kubectl describe pod <pod> -n default | grep -i Image`

### C) Pod `Pending` due to unbound PVC

Cause:
- `uploadsPersistence.storageClass` mismatch (`gp3` requested but only `gp2` exists).

Actions:
1. Check storage classes:
   - `kubectl get storageclass`
2. Use matching class in Helm:
   - `--set uploadsPersistence.storageClass=gp2`
3. If PVC stuck with wrong class, delete PVC and redeploy:
   - `kubectl delete pvc api-app-uploads -n default`

### D) `/health` and `/ready` OK but app still logs old DocDB/Redis hosts

Cause:
- `api-runtime-env` Secret still contains stale values.

Actions:
1. Decode secret values:
   - `kubectl get secret api-runtime-env -n default -o jsonpath="{.data.MONGO_URI}"`
   - `kubectl get secret api-runtime-env -n default -o jsonpath="{.data.REDIS_URL}"`
2. Reapply Secret with in-cluster URIs.
3. Restart deployment:
   - `kubectl rollout restart deployment/api-app -n default`

### E) CI warning: `metrics.k8s.io ... Unauthorized`

Meaning:
- Usually a non-blocking API discovery warning while probing metrics API.

If pipeline proceeds:
- Treat as warning.

If pipeline fails:
- Check auth:
  - `kubectl auth can-i list nodes.metrics.k8s.io`
  - `kubectl auth can-i list pods.metrics.k8s.io`

---

## 6) Health checks and smoke tests

Port-forward local test:

```bash
kubectl -n default port-forward svc/api-app 3000:80
```

Then:

```bash
curl.exe -i "http://127.0.0.1:3000/health"
curl.exe -i "http://127.0.0.1:3000/ready"
```

Expected:
- `/health` => 200 and `{"status":"ok"}`
- `/ready` => 200 and `{"status":"ready"}` once app fully initialized

---

## 7) Operational checklist before merge to main

1. `helm lint` passes.
2. ECR image exists for target tag.
3. Runtime Secret values match intended data mode.
4. StorageClass configured and PVCs bound.
5. Deployment rollout complete.
6. New pod logs do not reference old DocumentDB/ElastiCache hostnames.

---

## 8) Recommended repo defaults for this environment

- Keep `UPLOADS_STORAGE_CLASS=gp2` until `gp3` is installed and validated.
- Keep `INCLUSTER_DATA_SERVICES=true`.
- Keep `SYNC_K8S_RUNTIME_SECRET=true` with at least `APP_SESSION_SECRET`.
- Prefer derived in-cluster URIs unless explicit overrides are required.
