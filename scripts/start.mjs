// Production entry point: never enable local JSON-file writes or local admin authentication.
process.env.DEV_SERVER = '0';
const { listen } = await import('./dev.mjs');
listen();
