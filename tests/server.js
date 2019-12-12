/**
 * @module server
 * @license MIT
 * @author nuintun
 */

const Koa = require('koa');
const server = require('../index');

const app = new Koa();

app.use(server('tests'));

app.on('error', error => error);

app.listen(80, () => console.log('Server running at: 127.0.0.1'));
