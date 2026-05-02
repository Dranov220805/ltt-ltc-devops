FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
# Skip lifecycle scripts (prepare runs husky; husky is not installed with --omit=dev)
RUN npm ci --omit=dev --ignore-scripts

COPY . .

ENV NODE_ENV=production
EXPOSE 3000

USER node

CMD ["node", "main.js"]
