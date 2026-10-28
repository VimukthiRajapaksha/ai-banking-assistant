# syntax=docker/dockerfile:1
FROM node:22-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

# npm start passes --env-file=.env; under compose the environment comes from
# env_file/environment instead, so the entrypoint is plain node.
USER node
EXPOSE 18030
CMD ["node", "src/server.js"]
