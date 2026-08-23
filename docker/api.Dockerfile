# QA-owned build recipe for the DayFlow API container.
#
# This file lives only in dayflow-qa and is never copied into, or committed to, the DayFlow repo.
# docker-compose.test.yml builds it with `context: <pinned checkout>/server` — i.e. it compiles
# the real dev source, unmodified, it just isn't the dev team's own Dockerfile (they don't have
# one; DayFlow's Node API normally runs directly on the host via `npm run dev` / `npm start`, per
# doc/DEPLOYMENT_LIGHTSAIL.md — nginx + a containerized API is how QA chooses to test it so the
# suite runs against the same reverse-proxy topology production uses). See ARCHITECTURE.md §3.
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 5000
CMD ["node", "dist/server.js"]
