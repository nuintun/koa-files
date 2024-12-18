/**
 * @module server
 */

import Koa from 'koa';
import { server } from 'koa-files';

const port = 80;
const app = new Koa();

/**
 * @function httpError
 * @param {NodeJS.ErrnoException} error
 * @returns {boolean}
 */
function httpError(error) {
  return /^(EOF|EPIPE|ECANCELED|ECONNRESET|ECONNABORTED)$/i.test(error.code);
}

// Static files server
app.use(
  server('tests', {
    async headers() {
      return {
        Server: `Node/${process.version.slice(1)}`
      };
    }
  })
);

// Listen error event
app.on('error', error => !httpError(error) && console.error(error));

// Start server
app.listen(port, () => console.log(`> server running at: http://127.0.0.1`));
