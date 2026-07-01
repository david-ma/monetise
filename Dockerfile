# Extends the shared Thalia runtime (Bun + pre-installed Thalia core).
# Site-specific deps are installed under websites/monetise.
FROM frostickle/thalia:1.1.2

USER root
COPY . /usr/app/Thalia/websites/monetise

WORKDIR /usr/app/Thalia/websites/monetise
RUN bun install --frozen-lockfile --production \
  && bun run build:client

ENV PROJECT=monetise
ENV NODE_ENV=production

USER bun
WORKDIR /usr/app/Thalia
EXPOSE 1337
CMD ["bun", "thalia"]
