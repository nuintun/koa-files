/**
 * @module koa-files
 * @license MIT
 * @version 0.0.1
 * @author nuintun
 * @description A static files serving middleware for koa.
 * @see https://github.com/nuintun/koa-files#readme
 */

'use strict';

const ms = require('ms');
const etag = require('etag');
const destroy = require('destroy');
const stream = require('stream');
const fs = require('fs');
const path = require('path');
const parseRange = require('range-parser');

/**
 * @module through
 * @license MIT
 * @author nuintun
 */
/**
 * @function noop
 * @description A noop _transform function
 * @param {any} chunk
 * @param {string} encoding
 * @param {Function} next
 */
function noop(chunk, encoding, next) {
    next(null, chunk);
}
/**
 * @function through
 * @param {TransformOptions | TransformFunction} options
 * @param {ransformFunction | FlushFunction} transform
 * @param {FlushFunction} flush
 * @returns {Transform}
 */
function through(options, transform, flush) {
    if (typeof options === 'function') {
        transform = options;
        flush = transform;
        options = {};
    }
    else if (typeof transform !== 'function') {
        transform = noop;
    }
    options = options || {};
    if (options.objectMode == null)
        options.objectMode = true;
    if (options.highWaterMark == null)
        options.highWaterMark = 16;
    const stream$1 = new stream.Transform(options);
    stream$1._transform = transform;
    if (typeof flush === 'function')
        stream$1._flush = flush;
    return stream$1;
}

/**
 * @module utils
 * @license MIT
 * @author nuintun
 */
const CHARS = Array.from('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz');
/**
 * @function isOutRange
 * @description Test path is out of bound of base
 * @param {string} path
 * @param {string} root
 * @returns {boolean}
 */
function isOutRange(path$1, root) {
    path$1 = path.relative(root, path$1);
    return /\.\.(?:[\\/]|$)/.test(path$1);
}
/**
 * @function unixify
 * @description Convert path separators to posix/unix-style forward slashes
 * @param {string} path
 * @returns {string}
 */
function unixify(path) {
    return path.replace(/\\/g, '/');
}
/**
 * @function boundaryGenerator
 * @description Create boundary
 * @returns {string}
 */
function boundaryGenerator() {
    let boundary = '';
    // Create boundary
    for (let i = 0; i < 38; i++) {
        boundary += CHARS[Math.floor(Math.random() * 62)];
    }
    // Return boundary
    return boundary;
}
/**
 * @function parseTokens
 * @description Parse a HTTP tokens.
 * @param {string[]} value
 */
function parseTokens(value) {
    let start = 0;
    let end = 0;
    let tokens = [];
    // gather tokens
    for (let i = 0, length = value.length; i < length; i++) {
        switch (value.charCodeAt(i)) {
            case 0x20:
                // ' '
                if (start === end) {
                    start = end = i + 1;
                }
                break;
            case 0x2c:
                // ','
                tokens.push(value.substring(start, end));
                start = end = i + 1;
                break;
            default:
                end = i + 1;
                break;
        }
    }
    // final token
    tokens.push(value.substring(start, end));
    return tokens;
}
/**
 * @function fstat
 * @param {string} path
 * @returns {Promise<Stats>}
 */
function fstat(path) {
    return new Promise((resolve, reject) => {
        fs.stat(path, (error, stats) => {
            error ? reject(error) : resolve(stats);
        });
    });
}
/**
 * @function hasTrailingSlash
 * @param {string} path
 * @returns {boolean}
 */
function hasTrailingSlash(path) {
    return /\/$/.test(path);
}

const defaultOptions = {
    maxAge: '1y'
};
class Send {
    /**
     * @constructor
     * @param {Context} ctx
     * @param {string} root
     * @param {Options} options
     */
    constructor(ctx, root = '.', options) {
        this.ctx = ctx;
        this.root = unixify(path.resolve(root));
        this.options = Object.assign(Object.assign({}, defaultOptions), options);
        // Decode path
        const path$1 = decodeURI(ctx.path);
        // Get real path
        this.path = path$1 === -1 ? -1 : unixify(path.join(this.root, path$1));
        // Buffer
        this.buffer = through();
    }
    /**
     * @method isConditionalGET
     * @returns {boolean}
     */
    isConditionalGET() {
        const { request } = this.ctx;
        return !!(request.get('If-Match') ||
            request.get('If-None-Match') ||
            request.get('If-Modified-Since') ||
            request.get('if-Unmodified-Since'));
    }
    /**
     * @method isPreconditionFailure
     * @returns {boolean}
     */
    isPreconditionFailure() {
        const { request, response } = this.ctx;
        // If-Match
        const match = request.get('If-Match');
        if (match) {
            const etag = response.get('ETag');
            return (!etag ||
                (match !== '*' &&
                    parseTokens(match).every((match) => {
                        return match !== etag && match !== 'W/' + etag && 'W/' + match !== etag;
                    })));
        }
        // If-Unmodified-Since
        const unmodifiedSince = Date.parse(request.get('If-Unmodified-Since'));
        if (!isNaN(unmodifiedSince)) {
            const lastModified = Date.parse(response.get('Last-Modified'));
            return isNaN(lastModified) || lastModified > unmodifiedSince;
        }
        return false;
    }
    /**
     * @method isCachable
     * @returns {boolean}
     */
    isCachable() {
        const { status } = this.ctx;
        return status === 304 || (status >= 200 && status < 300);
    }
    /**
     * @method isRangeFresh
     * @returns {boolean}
     */
    isRangeFresh() {
        const { request, response } = this.ctx;
        const ifRange = request.get('If-Range');
        if (!ifRange)
            return true;
        // If-Range as etag
        if (ifRange.indexOf('"') !== -1) {
            const etag = response.get('ETag');
            return !!(etag && ifRange.indexOf(etag) !== -1);
        }
        // If-Range as modified date
        const lastModified = response.get('Last-Modified');
        return Date.parse(lastModified) <= Date.parse(ifRange);
    }
    /**
     * @method error
     * @param {number} status
     */
    error(status) {
        const { ctx, options } = this;
        if (typeof options.onerror === 'function') {
            options.onerror(ctx, status, ctx.message);
        }
        else {
            ctx.throw(status);
        }
    }
    /**
     * @method statError
     * @param {ErrnoException} error
     */
    statError(error) {
        this.error(/^(ENOENT|ENAMETOOLONG|ENOTDIR)$/i.test(error.code) ? 404 : 500);
    }
    /**
     * @method dir
     * @param {string} path
     */
    dir(path) {
        const { ctx, options } = this;
        if (typeof options.ondir === 'function') {
            options.ondir(ctx, path);
        }
        else {
            this.error(403);
        }
    }
    /**
     * @method parseRange
     * @param {Stats} stats
     * @returns {Ranges}
     */
    parseRange(stats) {
        const { ctx } = this;
        const { request } = ctx;
        const result = [];
        const { size } = stats;
        // Content-Length
        let contentLength = size;
        // Range support
        if (this.options.acceptRanges !== false) {
            const range = request.get('Range');
            // Range fresh
            if (range && this.isRangeFresh()) {
                // Parse range -1 -2 or []
                const ranges = parseRange(size, range, { combine: true });
                // Valid ranges, support multiple ranges
                if (Array.isArray(ranges) && ranges.type === 'bytes') {
                    ctx.status = 206;
                    // Multiple ranges
                    if (ranges.length > 1) {
                        // Reset content-length
                        contentLength = 0;
                        // Range boundary
                        const boundary = `<${boundaryGenerator()}>`;
                        const suffix = `\r\n--${boundary}--\r\n`;
                        const contentType = `Content-Type: ${ctx.type}`;
                        ctx.type = `multipart/byteranges; boundary=${boundary}`;
                        // Map ranges
                        ranges.forEach(({ start, end }) => {
                            const contentRange = `Content-Range: bytes ${start}-${end}/${size}`;
                            const prefix = `\r\n--${boundary}\r\n${contentType}\r\n${contentRange}\r\n\r\n`;
                            // Compute content-length
                            contentLength += end - start + Buffer.byteLength(prefix) + 1;
                            // Cache range
                            result.push({ start, end, prefix });
                        });
                        // The first prefix boundary remove \r\n
                        result[0].prefix = result[0].prefix.replace(/^\r\n/, '');
                        // The last add suffix boundary
                        result[result.length - 1].suffix = suffix;
                        // Compute content-length
                        contentLength += Buffer.byteLength(suffix);
                    }
                    else {
                        const { start, end } = ranges[0];
                        ctx.set('Content-Range', `bytes ${start}-${end}/${size}`);
                        // Compute content-length
                        contentLength = end - start + 1;
                        // Cache range
                        result.push({ start, end });
                    }
                }
                else {
                    return ranges;
                }
            }
        }
        ctx.length = contentLength;
        return result.length ? result : [{ start: 0, end: size }];
    }
    /**
     * @method setupHeaders
     * @param {string} path
     * @param {Stats} stats
     */
    setupHeaders(path$1, stats) {
        const { ctx, options } = this;
        // Accept-Ranges
        if (options.acceptRanges !== false) {
            // Set Accept-Ranges
            ctx.set('Accept-Ranges', 'bytes');
        }
        // Set Content-Type
        ctx.type = path.extname(path$1);
        // Cache-Control
        if (options.cacheControl !== false) {
            let cacheControl = `public, max-age=${ms(options.maxAge) / 1000}`;
            if (options.immutable) {
                cacheControl += ', immutable';
            }
            // Set Cache-Control
            ctx.set('Cache-Control', cacheControl);
        }
        // Last-Modified
        if (options.lastModified !== false) {
            // Get mtime utc string
            ctx.set('Last-Modified', stats.mtime.toUTCString());
        }
        // ETag
        if (options.etag !== false) {
            // Set ETag
            ctx.set('ETag', etag(stats));
        }
    }
    /**
     * @method read
     * @param {string} path
     * @param {Range} range
     * @returns {Promise<true>}
     */
    read(path, range) {
        const { buffer } = this;
        return new Promise((resolve, reject) => {
            // Write prefix boundary
            range.prefix && buffer.write(range.prefix);
            // Create file stream
            const file = fs.createReadStream(path, range);
            // Write data to buffer
            file.on('data', (chunk) => {
                buffer.write(chunk);
            });
            // Error handling code-smell
            file.on('error', error => {
                // Reject
                reject(error);
            });
            // File stream close
            file.on('close', () => {
                // Push suffix boundary
                range.suffix && buffer.write(range.suffix);
                // Destroy file stream
                destroy(file);
                // Resolve
                resolve(true);
            });
        });
    }
    /**
     * @method start
     * @returns {Promise<any>}
     */
    async start() {
        const { ctx, root, path, buffer, options } = this;
        const { method, response } = ctx;
        const { ignore } = options;
        // Only support GET and HEAD
        if (method !== 'GET' && method !== 'HEAD') {
            return this.error(405);
        }
        // Path -1 or null byte(s)
        if (path === -1 || path.includes('\0')) {
            return this.error(400);
        }
        // Malicious path
        if (isOutRange(path, root)) {
            return this.error(403);
        }
        // Is ignore path or file
        switch (typeof ignore === 'function' ? ignore(path) : false) {
            case 'deny':
                return this.error(403);
            case 'ignore':
                return this.error(404);
        }
        let stats;
        try {
            stats = await fstat(path);
        }
        catch (error) {
            return this.statError(error);
        }
        if (stats) {
            // Is directory
            if (stats.isDirectory()) {
                return this.dir(path);
            }
            else if (hasTrailingSlash(path)) {
                // Not a directory but has trailing slash
                return this.error(404);
            }
            // Setup headers
            this.setupHeaders(path, stats);
            // Conditional get support
            if (this.isConditionalGET()) {
                const responseEnd = () => {
                    // Remove content-type
                    response.remove('Content-Type');
                    // End with empty content
                    ctx.body = null;
                };
                if (this.isPreconditionFailure()) {
                    ctx.status = 412;
                    return responseEnd();
                }
                else if (this.isCachable() && ctx.fresh) {
                    ctx.status = 304;
                    return responseEnd();
                }
            }
            // Head request
            if (method === 'HEAD') {
                // Set content-length
                ctx.length = stats.size;
                // End with empty content
                return (ctx.body = null);
            }
            // Parse ranges
            const ranges = this.parseRange(stats);
            // 416
            if (ranges === -1) {
                // Set content-range
                ctx.set('Content-Range', `bytes */${stats.size}`);
                // Unsatisfiable 416
                return this.error(416);
            }
            // 400
            if (ranges === -2) {
                return this.error(400);
            }
            // Set stream body
            ctx.body = buffer;
            // Read file ranges
            for (const range of ranges) {
                await this.read(path, range);
            }
            // End stream
            buffer.end();
        }
    }
}

/**
 * @module index
 * @license MIT
 * @author nuintun
 */
/**
 * @function server
 * @param {string} root
 * @param {Options} options
 */
function server(root, options) {
    return async (ctx, next) => {
        const { start } = new Send(ctx, root, options);
        await next();
        await start();
    };
}

module.exports = server;
