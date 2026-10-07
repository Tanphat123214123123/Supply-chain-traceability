import 'dotenv/config';
import { Pool } from 'pg';
import { APP_DB_ROLE } from './roles';
import { migrate } from './migrator';
import { sslConfigFromEnv } from './pool';

/**
 * `npm run migrate` / `node dist/db/migrate.js`
 *
 * Connects with MIGRATION_DATABASE_URL (a schema-owner role), falling back to
 * DATABASE_URL for single-user local setups. If APP_DB_PASSWORD is set, the
 * runtime role created by the migrations is also given LOGIN + that password,
 * so a fresh environment needs no manual `ALTER ROLE` step.
 */
async function main(): Promise<void> {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('Set MIGRATION_DATABASE_URL (or DATABASE_URL) to run migrations.');

  const pool = new Pool({ connectionString: url, ssl: sslConfigFromEnv(), max: 1, application_name: 'tracechain-migrate' });
  try {
    const result = await migrate(pool, { log: (msg) => console.log(msg) });
    console.log(
      result.applied.length === 0
        ? `Schema up to date (${result.alreadyApplied} migrations already applied).`
        : `Applied ${result.applied.length} migration(s).`,
    );

    const appPassword = process.env.APP_DB_PASSWORD;
    if (appPassword) {
      const client = await pool.connect();
      try {
        // ALTER ROLE takes no bind parameters — escapeLiteral is pg's own quoting.
        await client.query(`ALTER ROLE ${APP_DB_ROLE} WITH LOGIN PASSWORD ${client.escapeLiteral(appPassword)}`);
        console.log(`Role ${APP_DB_ROLE} can now log in with APP_DB_PASSWORD.`);
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
