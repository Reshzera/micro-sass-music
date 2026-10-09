# Backend

NestJS API for the micro-SaaS music project.

## Setup

```bash
npm install
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

## Validation

`ValidationPipe` is registered globally in `src/main.ts` with `whitelist`,
`forbidNonWhitelisted` and `transform` enabled, so request DTOs decorated with
`class-validator` are validated and stripped of unknown properties automatically.
