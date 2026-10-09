# Loreweaver

A worldbuilding copilot for novelists. It answers questions about your fictional world, and its suggestions follow the world's own rules.

> Work in progress. This README grows as the project does.

## Quickstart

Requires Node 24 (see `.nvmrc`) with Corepack enabled (`corepack enable`).

```sh
pnpm install
docker compose up --build -d   # the legacy CMS on http://localhost:8080
cp apps/web/.env.example apps/web/.env.local
pnpm dev
```

Then open http://localhost:3000.

## Scripts

| Command          | What it does                          |
| ---------------- | ------------------------------------- |
| `pnpm dev`       | Start the web app in development mode |
| `pnpm test`      | Run unit tests                        |
| `pnpm lint`      | Lint with ESLint                      |
| `pnpm typecheck` | Type-check with TypeScript            |
| `pnpm format`    | Format the whole repo with Prettier   |

## Docs

- [Product requirements](docs/PRD.md)
- [Architecture decisions](docs/adr/)
- [Daily reports](docs/reports/), starting with [Day 1](docs/reports/day-1.md)

## License

[MIT](LICENSE)
