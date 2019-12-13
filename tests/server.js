/**
 * @module server
 * @license MIT
 * @author nuintun
 */

const Koa = require('koa');
const server = require('../index');

const app = new Koa();
const port = process.env.PORT || 80;

/**
 * @function socketError
 * @param {NodeJS.ErrnoException} error
 * @returns {boolean }
 */
function socketError(error) {
  return /ECONNABORTED|ECONNRESET|EPIPE|ETIMEDOUT|ENOPROTOOPT/.test(error.code);
}

// Static files server
app.use(server('tests'));

// Listen error event
app.on('error', error => !socketError(error) && console.error(error));

// Start server
app.listen(port, () => console.log(`> server running at: 127.0.0.1:${port}`));
