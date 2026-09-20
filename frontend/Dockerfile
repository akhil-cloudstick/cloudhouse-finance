# syntax=docker/dockerfile:1

# Frontend-only image: `npm run build` producing the Next.js static export
# (output: "export" — see next.config.ts), handed to the backend container
# through a shared Docker volume mounted at /shared-out. Next's static
# export has no server component to run, so this container's whole job is
# to build once and copy the result out, then exit — it is not a
# long-running request-serving process (see docker-compose.yml for how
# `depends_on: condition: service_completed_successfully` wires this into
# the backend's startup order).
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1

CMD ["sh", "-c", "npm run build && rm -rf /shared-out/* && cp -r out/. /shared-out/ && echo 'frontend build copied to /shared-out'"]
