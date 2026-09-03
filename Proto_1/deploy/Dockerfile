FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
USER node
ENV NODE_ENV=production
CMD ["node", "server/staging-index.js"]
