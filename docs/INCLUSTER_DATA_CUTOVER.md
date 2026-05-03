# In-Cluster Data Cutover Runbook

This runbook migrates app runtime from AWS managed data services to in-cluster MongoDB/Redis and PVC-backed uploads.

## 1) Pre-checks

- Terraform apply has completed for `ltt-ltc-terraform/envs/dev`.
- Mongo service exists: `mongodb.default.svc.cluster.local:27017`.
- Redis service exists: `redis.default.svc.cluster.local:6379`.
- App chart PVC for uploads is enabled in `helm/app/values.deploy.yaml`.

## 2) Migrate MongoDB data

From a machine that can reach the old Mongo endpoint:

```bash
mongodump --uri="${OLD_MONGO_URI}" --gzip --archive=/tmp/products.archive.gz
kubectl -n default cp /tmp/products.archive.gz deploy/mongodb:/tmp/products.archive.gz
kubectl -n default exec deploy/mongodb -- mongorestore --drop --gzip --archive=/tmp/products.archive.gz
```

## 3) Migrate images (S3 -> PVC)

Use a temporary helper pod, then copy files into the mounted uploads path:

```bash
aws s3 sync "s3://YOUR_OLD_BUCKET" ./uploads-export
kubectl -n default cp ./uploads-export/. deploy/api-app:/app/public/uploads/
```

If your PVC name differs, set it from `kubectl get pvc -n default`.

## 4) Runtime Secret update

Apply runtime secret with in-cluster endpoints:

```bash
kubectl create secret generic api-runtime-env -n default \
  --from-literal=MONGO_URI="mongodb://mongodb.default.svc.cluster.local:27017/products_db" \
  --from-literal=REDIS_URL="redis://redis.default.svc.cluster.local:6379" \
  --from-literal=SESSION_SECRET="REPLACE_WITH_LONG_RANDOM_SECRET" \
  --from-literal=S3_BUCKET="" \
  --dry-run=client -o yaml | kubectl apply -f -
```

## 5) Deploy and verify

```bash
helm upgrade --install api ./helm/app -n default -f ./helm/app/values.deploy.yaml
kubectl rollout status deployment/api-app -n default --timeout=10m
curl -fsS http://localhost:3000/health
curl -fsS http://localhost:3000/ready
```

App checks:
- product CRUD works
- sessions persist through redis
- image upload and image retrieval work
- image still available after pod restart

## 6) Rollback

If failures occur, restore old runtime secret values and redeploy:

```bash
kubectl create secret generic api-runtime-env -n default \
  --from-literal=MONGO_URI="${OLD_MONGO_URI}" \
  --from-literal=REDIS_URL="${OLD_REDIS_URL}" \
  --from-literal=S3_BUCKET="${OLD_S3_BUCKET}" \
  --from-literal=SESSION_SECRET="${OLD_SESSION_SECRET}" \
  --dry-run=client -o yaml | kubectl apply -f -
helm upgrade --install api ./helm/app -n default -f ./helm/app/values.deploy.yaml
kubectl rollout restart deployment/api-app -n default
```
