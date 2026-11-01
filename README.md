# Fashion multichannel backend

Requires Node.js 22+ and MySQL. Configure the existing .env locally.

- npm run db:migrate: create missing database/tables/columns/indexes/constraints/triggers/views and apply versioned role migrations without resetting business data.
- npm run db:generate: regenerate the rerunnable SQL installer from sql/schema.source.sql; does not connect to the database.
- npm run dev: start the API with Node file watching.
- npm start: start normally.
- npm test: unit tests.
- npm run test:smoke: read-only API checks.
- npm run test:integration: isolated temporary database tests, followed by cleanup. Requires CREATE/DROP DATABASE privileges.
- npm run test:browser: integration and desktop/mobile Chrome checks. Requires frontend dependencies and Chrome at the path in tests/browser.cjs.

See DATABASE_SETUP.md for moving to another machine and required MySQL permissions. DoAnMo/fashion_database.sql is now the generated additive installer (direct import requires MySQL 8.0.29+); historical data dumps and seed scripts are separate and must not overwrite an existing database. See ../IMPLEMENTATION_STATUS.md for prior scope and external integration requirements.
