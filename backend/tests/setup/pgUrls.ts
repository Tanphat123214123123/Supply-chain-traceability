/** Shared between globalSetup and test workers (which only see process.env, not globalSetup's memory). */
export const TEMPLATE_DB = 'tc_template';
export const APP_ROLE_TEST_PASSWORD = 'tracechain_app_test';

export function workerDatabaseName(workerId: string | number): string {
  return `tc_test_w${workerId}`;
}

/** Same server, different database (and optionally different credentials). */
export function withDatabase(url: string, database: string, credentials?: { user: string; password: string }): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  if (credentials) {
    parsed.username = encodeURIComponent(credentials.user);
    parsed.password = encodeURIComponent(credentials.password);
  }
  return parsed.toString();
}
