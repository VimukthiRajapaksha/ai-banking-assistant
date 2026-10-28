# syntax=docker/dockerfile:1
# Vite dev server -- this is a demo stack that is meant to be edited and
# reloaded. Swap to `npm run build` + a static file server for a real deploy.
FROM node:22-alpine

WORKDIR /app
COPY package.json package-lock.json ./
# @wso2/oxygen-ui@0.13.1 pins peer react@19.2.3 exactly while the lockfile
# resolves react@19.3.0. npm 10 (shipped in node:22-alpine) refuses that;
# --legacy-peer-deps reproduces what the local install does.
RUN npm ci --legacy-peer-deps

COPY . .

EXPOSE 18000
CMD ["npx", "vite"]
