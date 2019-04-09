const { startServer } = require('@base-cms/express-web');
const routes = require('./routes');
const siteConfig = require('../site.config');

const { GRAPHQL_URI, INTERNAL_PORT, EXTERNAL_PORT } = require('./env');
const pkg = require('../package.json');

const { log } = console;

process.on('unhandledRejection', (e) => {
  log('> Unhandled promise rejection. Throwing error...');
  throw e;
});

log(`> Booting ${pkg.name} v${pkg.version}...`);
startServer({
  siteDir: `${__dirname}/../site`,
  siteConfig,
  routes,
  graphqlUri: GRAPHQL_URI,
  port: INTERNAL_PORT,
  engineConfig: { beautify: process.env.NODE_ENV === 'development' },
}).then(() => {
  log(`> Ready on http://0.0.0.0:${EXTERNAL_PORT}`);
}).catch(e => setImmediate(() => { throw e; }));