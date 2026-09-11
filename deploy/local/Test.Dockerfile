FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git python3 && rm -rf /var/lib/apt/lists/*
WORKDIR /verify
COPY package.json package-lock.json ./
RUN npm install -g npm@11 && npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN node deploy/local/normalize-test-files.mjs
CMD ["npm", "test"]
