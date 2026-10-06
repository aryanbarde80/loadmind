// Production entry point: one Node process serves the built UI, API, and proxy.
process.env.NODE_ENV = 'production';
const { start } = await import('../server/main.mjs');
await start();
