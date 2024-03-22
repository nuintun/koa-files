/**
 * @module server
 * @license MIT
 * @author nuintun
 */

import Koa from 'koa';
import files from 'koa-files';

const app = new Koa();
const port = +process.env.PORT || 80;

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
  files('tests', {
    headers: {
      'Cache-Control': 'public, max-age=31557600'
    }
  })
);

// Listen error event
app.on('error', error => !httpError(error) && console.error(error));

// Start server
app.listen(port, () => console.log(`> server running at: http://127.0.0.1:${port}`));
