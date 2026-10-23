# Recovery packaging only; canonical Core source is unchanged.
FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY btco-os/core/package.json btco-os/core/package-lock.json ./core/
RUN npm ci --prefix core --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY btco-os/web/domain ./web/domain
COPY btco-os/core/*.mjs ./core/
COPY btco-os/core/public ./core/public
COPY tools/render-runtime.mjs ./ops/render-runtime.mjs
USER node
EXPOSE 3000
CMD ["node", "ops/render-runtime.mjs"]
