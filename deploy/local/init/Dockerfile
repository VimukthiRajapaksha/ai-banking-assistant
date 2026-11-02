# syntax=docker/dockerfile:1
# Shared image for the one-shot init services (thunder-init, amp-init,
# consent-init). curl + jq to talk HTTP and parse JSON; openssl to generate the
# secrets the provisioners set on the clients they create.
FROM alpine:3.21
RUN apk add --no-cache bash curl jq openssl
WORKDIR /init
COPY --chmod=755 *.sh ./
# The declarative ThunderID bundle the provisioner imports.
COPY thunder/ ./thunder/
ENTRYPOINT ["/init/entrypoint.sh"]
