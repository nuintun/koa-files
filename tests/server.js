/**
 * @module server
 * @license MIT
 * @author nuintun
 */

const Koa = require('koa');
const server = require('../index');

const app = new Koa();
const port = process.env.PORT || 80;

app.use(server('tests'));

app.on('error', error => error);

app.listen(port, () => console.log(`> server running at: 127.0.0.1:${port}`));
