# Disposable staging integration

## Purpose

The production-like Auth and ledger suite is deliberately **not** part of push or pull-request CI. It applies the reviewed Prisma migrations and truncates core application tables, so it may run only against the designated disposable Doolphin staging Supabase project.

Ordinary `CI` remains non-destructive: it installs the lockfile, validates Prisma, lints, runs unit/contract tests, and builds the app without connecting to Supabase.

## One-time GitHub configuration

Create the protected GitHub Actions environment named `disposable-doolphin-staging`. Give it any required reviewers appropriate for a staging reset. Configure these environment secrets from the **Doolphin staging** project only:

- `TEST_SUPABASE_URL`
- `TEST_SUPABASE_PUBLISHABLE_KEY`
- `TEST_SUPABASE_SERVICE_ROLE_KEY`
- `TEST_DATABASE_URL` — pooler connection string
- `TEST_DIRECT_URL` — direct connection string
- `DOOLPHIN_DISPOSABLE_STAGING_PROJECT_REF` — the 20-character project ref from the Doolphin staging project's URL. This identifier is not a credential, but is kept in the protected environment so the workflow has one reviewed source of truth.

Never add values from production. The current production ref is explicitly denied by the verifier, and the API, pooler, and direct database URLs must all resolve to the configured staging ref.

## Running the destructive suite

After the workflow is present on the repository default branch, select **Actions → Disposable staging integration → Run workflow**, choose the desired ref, and type exactly:

```text
RESET_DOOLPHIN_STAGING
```

The workflow runs a preflight before any database work and repeats it immediately before `prisma migrate deploy`. The test process repeats the verifier before opening its Postgres connection. It rejects missing values, malformed URLs, a production ref, mismatched project refs, an unexpected staging ref, mismatched effective connection strings, and an absent confirmation. Logs print only fixed status codes, never credentials or URLs.

The suite then applies only canonical migrations with `prisma migrate deploy`, tests hosted Supabase Auth and ledger behavior, and cleans its test-created Auth users and legal-document fixture. The ledger test truncates application identity, workspace, entitlement, billing, and credit-ledger data at setup and teardown. Treat every run as a staging reset.

## Current limitations

The hosted Supabase Auth disposable-email assertion requires the staging project's **Before User Created** hook to use `pg-functions://postgres/public/doolphin_before_user_created`. Prisma creates the database function but cannot configure the hosted Auth dashboard hook. Password-reset redirect coverage remains local because its redirect allow-list is a hosted dashboard setting not yet represented as versioned configuration.
