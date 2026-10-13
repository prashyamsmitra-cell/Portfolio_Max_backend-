// Local non-watching server with the JSON-file post store and local admin auth enabled.
process.env.DEV_SERVER = '1';
const { listen } = await import('./dev.mjs');
listen();
