FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY core/package.json core/package-lock.json ./core/
RUN npm ci --prefix core --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY web/domain ./web/domain
COPY core/*.mjs ./core/
COPY core/public ./core/public
USER node
EXPOSE 3000
CMD ["node", "core/server.mjs"]
