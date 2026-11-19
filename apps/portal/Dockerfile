# syntax=docker/dockerfile:1
# Production image: the built app, served by server.mjs. Settings come from
# config.js at run time, served from the VITE_* environment variables (see
# config.js.example), so one image serves every environment.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
# The path the app is served under: the root by default, as on a WSO2
# Developer Platform web app, which has a host of its own. Behind a shared host
# (a service, reached at /<component>-<endpoint>), build with
# --build-arg BASE_PATH=/<component>-<endpoint>.
ARG BASE_PATH=
ENV BASE_PATH=$BASE_PATH
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ARG BASE_PATH=
ENV NODE_ENV=production PORT=18000 BASE_PATH=$BASE_PATH
COPY --from=build /app/dist ./dist
COPY server.mjs ./
# Numeric, in 10000-20000: the WSO2 Developer Platform requires a non-root user
# in that range, and Kubernetes can only verify runAsNonRoot from a numeric UID.
RUN adduser --disabled-password --gecos "" --home /nonexistent \
      --shell /sbin/nologin --no-create-home --uid 10014 apex
USER 10014
EXPOSE 18000
CMD ["node", "server.mjs"]
