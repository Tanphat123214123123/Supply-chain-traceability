import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client, Pool } from 'pg';
import { migrate } from '../../src/db/migrator';
import { APP_DB_ROLE } from '../../src/db/roles';
import { APP_ROLE_TEST_PASSWORD, TEMPLATE_DB, withDatabase, workerDatabaseName } from './pgUrls';

declare global {
  // eslint-disable-next-line no-var
  var __TC_PG_CONTAINER__: StartedPostgreSqlContainer | undefined;
}

/**
 * Real PostgreSQL for the whole suite — the code under test relies on RLS,
 * triggers, column grants and SECURITY DEFINER functions, none of which a
 * fake can stand in for.
 *
 *   • TEST_DATABASE_URL set → use that server (must be a superuser URL, e.g. a
 *     CI service container); otherwise start a throwaway container.
 *   • Migrations run ONCE into a template database; each Jest worker then gets
 *     its own copy (CREATE DATABASE ... TEMPLATE is a fast file copy), so
 *     workers run in parallel without seeing each other's rows.
 */
export default async function globalSetup(globalConfig: { maxWorkers: number }): Promise<void> {
  let adminUrl = process.env.TEST_DATABASE_URL;
  if (!adminUrl) {
    const container = await new PostgreSqlContainer('postgres:16-alpine').start();
    globalThis.__TC_PG_CONTAINER__ = container;
    adminUrl = container.getConnectionUri();
  }

  const admin = new Client({ connectionString: withDatabase(adminUrl, 'postgres') });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${TEMPLATE_DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEMPLATE_DB}`);

    const templatePool = new Pool({ connectionString: withDatabase(adminUrl, TEMPLATE_DB), max: 1 });
    try {
      await migrate(templatePool);
    } finally {
      await templatePool.end();
    }
    // Roles are cluster-wide: one ALTER covers every worker database.
    await admin.query(`ALTER ROLE ${APP_DB_ROLE} WITH LOGIN PASSWORD '${APP_ROLE_TEST_PASSWORD}'`);

    const workers = Math.max(1, globalConfig.maxWorkers);
    for (let i = 1; i <= workers; i++) {
      const name = workerDatabaseName(i);
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${name} TEMPLATE ${TEMPLATE_DB}`);
    }
  } finally {
    await admin.end();
  }

  process.env.TEST_PG_ADMIN_URL = adminUrl;
}
