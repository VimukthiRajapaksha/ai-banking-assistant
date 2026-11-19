# syntax=docker/dockerfile:1
# Production image: the built app, served by server.mjs. Settings come from
# /config.js at run time (see config.js.example), so one image serves every
# environment; on the WSO2 Developer Platform that file is a file mount.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=18000
COPY --from=build /app/dist ./dist
COPY server.mjs ./
# Numeric, in 10000-20000: the WSO2 Developer Platform requires a non-root user
# in that range, and Kubernetes can only verify runAsNonRoot from a numeric UID.
RUN adduser --disabled-password --gecos "" --home /nonexistent \
      --shell /sbin/nologin --no-create-home --uid 10014 apex
USER 10014
EXPOSE 18000
CMD ["node", "server.mjs"]
