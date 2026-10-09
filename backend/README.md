# Backend

NestJS API for the micro-SaaS music project.

## Setup

```bash
npm install
cp .env.example .env     # fill in KIE_API_KEY
npm run db:up            # Postgres via ../docker-compose.yml, host port 5433
npm run prisma:migrate   # apply migrations and generate the client
```

## Running

```bash
npm run start:dev    # watch mode
npm run start        # development
npm run start:prod   # production (requires npm run build)
```

## Tests

```bash
npm run test         # unit
npm run test:e2e     # end-to-end
npm run test:cov     # coverage
```

Unit specs live under `test/`, mirroring `src/` (`test/modules/generations`,
`test/externals/kieClient`). They are pure unit tests: no Postgres and no
network — Prisma and `fetch` are mocked.

`tsconfig.spec.json` exists because Jest runs on CommonJS while `@nestjs/config`
v12 ships ESM only; ts-jest down-compiles it via `transformIgnorePatterns`.

## Database

Postgres runs from `docker-compose.yml` at the repo root and is reached through
`DATABASE_URL`. Prisma is configured by `prisma.config.ts`, with the schema in
`prisma/schema.prisma` and the generated client in `src/generated/prisma`
(gitignored — regenerate it after a fresh clone).

```bash
npm run db:up            # start Postgres
npm run db:down          # stop it (the named volume keeps the data)
npm run prisma:migrate   # create/apply a migration in development
npm run prisma:deploy    # apply existing migrations (CI / production)
npm run prisma:generate  # regenerate the client only
npm run prisma:studio    # browse the data
```

`PrismaService` (`src/prisma/prisma.service.ts`) extends `PrismaClient` and is
exported by the global `PrismaModule`, so any provider can inject it without
importing the module. It connects on bootstrap and disconnects on shutdown.
Prisma 7 reaches Postgres through the `@prisma/adapter-pg` driver adapter, which
`PrismaService` builds from `DATABASE_URL`.

## Validation

`ValidationPipe` is registered globally in `src/main.ts` with `whitelist`,
`forbidNonWhitelisted` and `transform` enabled, so request DTOs decorated with
`class-validator` are validated and stripped of unknown properties automatically.
