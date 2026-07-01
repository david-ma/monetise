FROM oven/bun:1 AS base

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

# GeoIP database and Monet image assets are expected under data/
# Postgres is a separate service — set NODE_ENV=docker and link host `db`.
ENV NODE_ENV=production
EXPOSE 1337

# TODO: replace with frostickle/thalia:1.1.0 once published to Docker Hub
CMD ["bun", "thalia"]
