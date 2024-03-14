FROM frostickle/thalia:1.0.3 as base

USER root

RUN mkdir -p /usr/app/Thalia/websites/monetise
COPY package.json /usr/app/Thalia/websites/monetise

WORKDIR /usr/app/Thalia/websites/monetise
RUN pnpm install
COPY . /usr/app/Thalia/websites/monetise
RUN pnpm run build

WORKDIR /usr/app/Thalia

CMD ["/usr/app/Thalia/start.sh", "monetise"]
