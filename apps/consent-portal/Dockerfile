# syntax=docker/dockerfile:1
# Next.js standalone server. Settings are read from the environment at run
# time (see .env.example), so one image serves every environment.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
# The path the portal is served under. On the WSO2 Developer Platform a service
# is reached at /<component>-<endpoint> on a host it shares with others; build
# with --build-arg BASE_PATH= to serve from the root instead.
ARG BASE_PATH=/apex-consent-portal-web
ENV BASE_PATH=$BASE_PATH
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=18060 \
    HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# Numeric, in 10000-20000: the WSO2 Developer Platform requires a non-root user
# in that range, and Kubernetes can only verify runAsNonRoot from a numeric UID.
RUN adduser --disabled-password --gecos "" --home /nonexistent \
      --shell /sbin/nologin --no-create-home --uid 10014 apex
USER 10014
EXPOSE 18060
CMD ["node", "server.js"]
