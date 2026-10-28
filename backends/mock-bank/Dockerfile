# syntax=docker/dockerfile:1
FROM node:22-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

# Numeric, in 10000-20000: the WSO2 Developer Platform requires a non-root user
# in that range, and Kubernetes can only verify runAsNonRoot from a numeric UID
# (a named user such as `node` fails with "cannot verify user is non-root").
RUN adduser --disabled-password --gecos "" --home /nonexistent \
      --shell /sbin/nologin --no-create-home --uid 10014 apex
USER 10014

# The server defaults to 127.0.0.1, which nothing outside the container can
# reach -- not the platform's health check, not the gateway.
ENV HOST=0.0.0.0

# npm start passes --env-file=.env; under compose the environment comes from
# env_file/environment instead, so the entrypoint is plain node.
EXPOSE 18030
CMD ["node", "src/server.js"]
