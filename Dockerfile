FROM frostickle/thalia:1.0.4 as base

USER root

RUN mkdir -p /usr/app/Thalia/websites/monetise/data
COPY package.json /usr/app/Thalia/websites/monetise

WORKDIR /usr/app/Thalia/websites/monetise
RUN pnpm install
COPY . /usr/app/Thalia/websites/monetise

# RUN unlink /usr/app/Thalia/websites/monetise/node_modules/thalia
RUN ln -s /usr/app/Thalia /usr/app/Thalia/websites/monetise/node_modules/thalia

WORKDIR /usr/app/Thalia
RUN sh build.sh monetise

CMD ["/usr/app/Thalia/start.sh", "monetise"]
