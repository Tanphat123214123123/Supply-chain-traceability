export default async function globalTeardown(): Promise<void> {
  await globalThis.__TC_PG_CONTAINER__?.stop();
}
