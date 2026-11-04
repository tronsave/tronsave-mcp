FROM node:22-alpine AS builder

WORKDIR /app
COPY package*.json ./
# Sources are not copied yet, so skip `prepare` (the build runs below).
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build && npm prune --production

FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY MCP_SERVER_QUICKSTART.md ./
COPY docs/CONNECT.md ./docs/

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.MCP_PORT||3000)+'/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/index.js"]
