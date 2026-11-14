FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY circuits ./circuits
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "src/server.js"]
