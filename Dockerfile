FROM node:24-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci

COPY . .

RUN npx prisma generate
RUN npm run build


FROM node:24-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci --omit=dev
RUN npx prisma generate

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/docs/contracts/messages ./docs/contracts/messages
COPY --from=builder --chown=node:node /app/scripts/operations/recover-saga-dlq.cjs ./scripts/operations/recover-saga-dlq.cjs

EXPOSE 3000

USER node

CMD ["node", "dist/src/main.js"]
