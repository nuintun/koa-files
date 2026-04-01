/**
 * @module server
 */

import Koa from 'koa';
import { server } from 'koa-files';

const port = 80;
const app = new Koa();

// HTTP client error codes.
const HTTP_CLIENT_ERROR_CODES = new Set([
  'EOF', // End of file - client closed connection.
  'EPIPE', // Broken pipe - client disconnected.
  'ECANCELED', // Operation canceled.
  'ECONNRESET', // Connection reset by peer.
  'ECONNABORTED', // Connection aborted.
  'ERR_STREAM_PREMATURE_CLOSE' // Stream closed before finishing.
]);

// Static files server.
app.use(
  server('tests', {
    async headers() {
      return {
        Server: `Node/${process.version.slice(1)}`
      };
    }
  })
);

// Listen error event.
app.on('error', error => {
  if (!HTTP_CLIENT_ERROR_CODES.has(error.code)) {
    console.error(error);
  }
});

// Start server.
app.listen(port, () => {
  console.log(`> server running at: http://127.0.0.1`);
});
