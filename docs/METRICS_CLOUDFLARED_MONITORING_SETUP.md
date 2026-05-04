# Metrics, Cloudflared, and Monitoring Setup Guide

This guide answers:

1. Why `/metrics` is needed
2. How the updated setup maps domain and monitoring subdomain
3. Which monitoring software is deployed
4. Exact step-by-step commands to run everything correctly

---

## 1) Why `/metrics` is needed

`/health` and `/ready` only tell Kubernetes if the app process is alive/ready.

`/metrics` is for Prometheus/Grafana observability:

- It exposes numeric time-series data (request count, process stats, memory, etc.)
- Prometheus scrapes it periodically (for example every 15s)
- Grafana dashboards and alerts are built on these metrics

In this project, `/metrics` is implemented in:

- `Final_Project/main.js` using `prom-client`
- App chart ServiceMonitor points to `/metrics` in:
  - `Final_Project/helm/app/templates/servicemonitor.yaml`
  - `Final_Project/helm/app/values.deploy.yaml`

Important:
- If you deploy an old image tag (built before this code change), `/metrics` returns `Cannot GET /metrics`.
- Rebuild and redeploy app image to activate metrics endpoint.

---

## 2) How domain + cloudflared mapping works in the updated setup

## Current architecture (ALB-first)

Your current implementation is **ALB-first**, not tunnel-first:

- App domain: `devops.ltc.io.vn` -> Cloudflare DNS -> AWS ALB (Ingress) -> `api-app` service
- Monitoring domain: `monitoring.devops.ltc.io.vn` -> Cloudflare DNS -> AWS ALB (Grafana ingress) -> Grafana service

Configured in:

- App ingress host + ALB annotations:
  - `Final_Project/helm/app/values.deploy.yaml`
- Monitoring Grafana ingress:
  - `ltt-ltc-terraform/modules/k8s-addons/main.tf` (`kube_prometheus_stack`)

## Where cloudflared fits now

Cloudflared is deployed as an **optional side path**:

- Terraform deploys `cloudflared` Deployment and token Secret:
  - `ltt-ltc-terraform/modules/k8s-addons/main.tf`
- Enabled by:
  - `enable_cloudflared_tunnel = true`
  - `TF_VAR_cloudflare_tunnel_token`

But the tunnel **hostname mapping itself is not in app code** and not in this Terraform module.
It is configured in **Cloudflare Zero Trust dashboard** (Public Hostnames for the tunnel).

So the mapping logic is:

- App code: exposes HTTP routes (`/`, `/health`, `/ready`, `/metrics`)
- Kubernetes/Ingress: routes hostnames to services
- Cloudflare Zero Trust: maps tunnel public hostnames to internal service URLs (only when you choose tunnel path)

---

## 3) Monitoring software used

The deployed monitoring stack is:

- **kube-prometheus-stack** (Prometheus Operator bundle)
  - Prometheus
  - Grafana
  - Alertmanager
  - kube-state-metrics
  - node-exporter
- **MongoDB exporter**
  - `prometheus-mongodb-exporter`
- **Redis exporter**
  - `prometheus-redis-exporter`
- **metrics-server** (cluster resource metrics for HPA and kubectl top)

All are managed from:

- `ltt-ltc-terraform/modules/k8s-addons/main.tf`
- variables in:
  - `ltt-ltc-terraform/modules/k8s-addons/variables.tf`
  - `ltt-ltc-terraform/envs/dev/variables.tf`
  - `ltt-ltc-terraform/envs/dev/terraform.tfvars`

---

## 4) Step-by-step runbook (recommended order)

## Step 0: Prerequisites

- `kubectl`, `helm`, `terraform`, `aws` CLI installed
- Logged into AWS account with permissions
- Kube context points to your EKS cluster
- EBS CSI + StorageClass (`gp2`) available

Quick checks:

```powershell
kubectl get nodes
kubectl get storageclass
```

## Step 1: Apply Terraform platform addons (monitoring + exporters + cloudflared workload)

From `ltt-ltc-terraform/envs/dev`:

```powershell
terraform init
terraform validate
terraform apply -auto-approve
```

If you only want addons first:

```powershell
terraform apply -auto-approve -target="module.k8s_addons[0]"
```

Verify:

```powershell
kubectl get pods -n monitoring
kubectl get pods -n default
kubectl get ingress -A
kubectl get servicemonitor -A
```

## Step 2: Build and deploy app image that contains `/metrics`

Use CI (recommended) or manual build+push, then deploy with explicit image repository/tag.

Manual Helm deploy (example):

```powershell
helm upgrade --install api ./helm/app -n default -f ./helm/app/values.deploy.yaml `
  --set-string image.repository=525089404588.dkr.ecr.ap-southeast-1.amazonaws.com/devops-final-app `
  --set-string image.tag=<NEW_TAG_WITH_METRICS_CODE> `
  --set uploadsPersistence.storageClass=gp2
```

Verify rollout:

```powershell
kubectl rollout status deployment/api-app -n default --timeout=10m
kubectl get pods -n default -o wide
```

## Step 3: Verify `/health`, `/ready`, `/metrics`

```powershell
kubectl -n default port-forward svc/api-app 18080:80
```

In another terminal:

```powershell
curl.exe -i http://127.0.0.1:18080/health
curl.exe -i http://127.0.0.1:18080/ready
curl.exe -i http://127.0.0.1:18080/metrics
```

Expected:

- `/health` -> `200`
- `/ready` -> `200` after startup finishes
- `/metrics` -> Prometheus text output (not HTML, not JSON)

## Step 4: Configure Cloudflare DNS for ALB-first routing

1. Get ALB hostnames from ingress:

```powershell
kubectl get ingress -n default api-app -o jsonpath="{.status.loadBalancer.ingress[0].hostname}"
kubectl get ingress -n monitoring kube-prometheus-stack-grafana -o jsonpath="{.status.loadBalancer.ingress[0].hostname}"
```

2. In Cloudflare DNS:
- Create/Update `devops.ltc.io.vn` CNAME -> app ALB DNS
- Create/Update `monitoring.devops.ltc.io.vn` CNAME -> monitoring ALB DNS

3. Proxy mode:
- App host: proxied (recommended)
- Monitoring host: proxied or DNS-only depending on your access policy

## Step 5: Configure Cloudflared tunnel hostnames (optional path)

Use this only if you want selected services to be tunnel-routed.

1. Ensure token is set before Terraform apply:

```powershell
$env:TF_VAR_cloudflare_tunnel_token="eyJ..."
```

2. Confirm cloudflared pod exists:

```powershell
kubectl get pods -n cloudflared
```

3. In Cloudflare Zero Trust -> Tunnels -> your tunnel -> Public Hostnames:

- Add hostname `monitoring.devops.ltc.io.vn` -> service URL `http://kube-prometheus-stack-grafana.monitoring.svc.cluster.local:80`
- Optionally add internal-only admin hostnames similarly

Note:
- This hostname mapping is controlled in Cloudflare dashboard, not in app source code.

## Step 6: Validate monitoring data in Grafana

1. Open `monitoring.devops.ltc.io.vn`
2. In Grafana Explore, test metrics:
   - `up`
   - `http_requests_total`
   - `mongodb_up`
   - `redis_up`
3. Confirm app ServiceMonitor is discovered:

```powershell
kubectl get servicemonitor -n monitoring api-app -o yaml
```

---

## 5) Troubleshooting quick map

- `/metrics` returns 404:
  - Deployed image is old -> rebuild + redeploy latest image tag.
- App pod uses `changeme.example.com/app:latest`:
  - Helm image override missing -> set `image.repository` and `image.tag`.
- Grafana ingress exists but no external ADDRESS yet:
  - ALB controller still provisioning; wait and recheck.
- Cloudflared pod running but hostname not reachable:
  - Public Hostname mapping in Zero Trust is missing or points to wrong service URL.
- Prometheus cannot see app metrics:
  - Check `ServiceMonitor` labels/namespace and `/metrics` endpoint reachability.

---

## 6) Current source-of-truth files

- App metrics endpoint:
  - `Final_Project/main.js`
- App ingress + ServiceMonitor values:
  - `Final_Project/helm/app/values.deploy.yaml`
  - `Final_Project/helm/app/values.yaml`
  - `Final_Project/helm/app/templates/ingress.yaml`
  - `Final_Project/helm/app/templates/servicemonitor.yaml`
- Monitoring stack + cloudflared workload:
  - `ltt-ltc-terraform/modules/k8s-addons/main.tf`
  - `ltt-ltc-terraform/modules/k8s-addons/variables.tf`
  - `ltt-ltc-terraform/envs/dev/main.tf`
  - `ltt-ltc-terraform/envs/dev/variables.tf`
  - `ltt-ltc-terraform/envs/dev/terraform.tfvars`
