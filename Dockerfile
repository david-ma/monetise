# Extends the shared Thalia runtime (Bun + pre-installed Thalia core).
# Site-specific deps are installed under websites/monetise.
FROM frostickle/thalia:1.1.2

COPY --chown=bun:bun . /usr/app/Thalia/websites/monetise

USER bun
WORKDIR /usr/app/Thalia/websites/monetise
RUN bun install --frozen-lockfile --production \
  && bun run build:client \
  && mkdir -p dist

ENV PROJECT=monetise
ENV NODE_ENV=production

WORKDIR /usr/app/Thalia
EXPOSE 1337
CMD ["bun", "server/cli.ts", "--project=monetise"]
