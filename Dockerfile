FROM node:20-alpine

WORKDIR /app

COPY --chown=1000:1000 package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY --chown=1000:1000 . .

ENV NODE_ENV=production
EXPOSE 3000

USER 1000

CMD ["node", "main.js"]