FROM node:20-alpine

WORKDIR /home/node/app
RUN corepack enable

COPY --chown=node:node . .

USER node
ENV NODE_ENV=production

RUN pnpm install --frozen-lockfile
RUN pnpm build

EXPOSE 64737
CMD ["pnpm", "start"]
