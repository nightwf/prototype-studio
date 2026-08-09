FROM node:20-slim

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json vitest.config.ts eslint.config.js ./
COPY packages ./packages
COPY apps ./apps

RUN npm install -g pnpm@10.4.1 && pnpm install --frozen-lockfile
RUN pnpm --filter @prototype-studio/studio build
RUN pnpm --filter @prototype-studio/web-server build

ENV PORT=8787
ENV SPACES_DIR=/data/spaces
EXPOSE 8787

CMD ["node", "apps/web-server/dist/main.cjs"]
