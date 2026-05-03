FROM node:20-alpine

WORKDIR /app

COPY --chown=1000:1000 package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY --chown=1000:1000 . .

# Runtime secrets (MONGO_URI, REDIS_URL, SESSION_SECRET, AWS keys) come from K8s / orchestrator — do not COPY .env into the image.
ENV NODE_ENV=production
ENV PORT=3000
ENV AWS_REGION=ap-southeast-1
EXPOSE 3000

USER 1000

CMD ["node", "main.js"]