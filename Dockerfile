# test runner image for the containerised suite. see docker-compose.yml

# trixie rather than bookworm because pg_dump refuses to dump a server newer than itself, and bookworm only ships the postgresql 15 client while docker-compose.yml runs postgres 17
FROM node:24-trixie-slim

# the database clients are what the cli.js dump commands shell out to, which is what lets the dump tests run for real
RUN apt-get update && apt-get install -y --no-install-recommends \
      postgresql-client \
      default-mysql-client \
      sqlite3 \
  && rm -rf /var/lib/apt/lists/*

# the mysql image generates a self-signed certificate on first boot, and the mariadb client that trixie ships verifies certificates by default, so mysqldump refuses to connect to it. that pairing only arises against throwaway servers, so verification is relaxed for this image rather than in the library, where turning it off would be a real weakening
RUN mkdir -p /etc/mysql/conf.d \
  && printf '[client]\nssl-verify-server-cert=0\n' > /etc/mysql/conf.d/no-ssl-verify.cnf

WORKDIR /multi-db

# install dependencies first so editing source does not refetch them
#
# --ignore-scripts skips a needless native build: better-sqlite3 has a binding.gyp and no install script of its own, so npm runs node-gyp for it even though the package ships a prebuilt binary for this platform. skipping it means no compiler is needed in this image at all
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .

CMD ["npm", "test"]
