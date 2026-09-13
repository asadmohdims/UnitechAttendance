// Overwritten at deploy time (see .github/workflows/deploy.yml) with the real git short SHA +
// build timestamp. Stays 'dev' here in the repo so local/demo testing has an obvious, harmless
// placeholder — only the deployed _site copy gets a real stamp.
export const APP_VERSION = 'dev';
