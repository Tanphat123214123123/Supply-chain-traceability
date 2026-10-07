/**
 * The least-privilege role the API server runs as — created and granted by
 * migration 009. It cannot run DDL, cannot UPDATE/DELETE ledger rows, cannot
 * write the batch chain-head columns, and is subject to row-level security.
 */
export const APP_DB_ROLE = 'tracechain_app';
