import 'dotenv/config';
import { createHash } from 'node:crypto';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { processEbayAccountDeletionNotification } from './services/ebay-account-deletion.js';

const port = Number(process.env.EBAY_WEBHOOK_PORT ?? '8787');
const endpointUrl = process.env.EBAY_NOTIFICATION_ENDPOINT_URL;
const verificationToken = process.env.EBAY_NOTIFICATION_VERIFICATION_TOKEN;
const maxBodyBytes = Number(process.env.EBAY_WEBHOOK_MAX_BODY_BYTES ?? '65536');

if (!endpointUrl || !verificationToken) {
  throw new Error('Missing EBAY_NOTIFICATION_ENDPOINT_URL or EBAY_NOTIFICATION_VERIFICATION_TOKEN in environment');
}

function sendJson(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);

  if (url.pathname !== '/ebay/notifications') {
    res.writeHead(404);
    res.end('not found');
    return;
  }

  if (req.method === 'GET') {
    const challengeCode = url.searchParams.get('challenge_code');
    if (!challengeCode) {
      sendJson(res, 400, { error: 'missing challenge_code' });
      return;
    }

    const challengeResponse = createHash('sha256')
      .update(challengeCode)
      .update(verificationToken)
      .update(endpointUrl)
      .digest('hex');

    sendJson(res, 200, { challengeResponse });
    return;
  }

  if (req.method === 'POST') {
    const contentType = req.headers['content-type'];
    if (contentType && !String(contentType).toLowerCase().includes('application/json')) {
      sendJson(res, 415, { error: 'unsupported_media_type' });
      return;
    }

    let body = '';
    let bodyBytes = 0;
    let rejected = false;
    req.on('data', (chunk) => {
      if (rejected) return;
      bodyBytes += Buffer.byteLength(chunk);
      if (bodyBytes > maxBodyBytes) {
        rejected = true;
        sendJson(res, 413, { error: 'payload_too_large' });
        req.destroy();
        return;
      }
      body += String(chunk);
    });
    req.on('error', (error) => {
      if (rejected) return;
      rejected = true;
      console.error('[eBay webhook] request stream failed', error);
      sendJson(res, 400, { error: 'invalid_request' });
    });
    req.on('end', () => {
      if (rejected) return;
      try {
        const payload = body.length > 0 ? JSON.parse(body) : {};
        processEbayAccountDeletionNotification(payload);
      } catch (error) {
        console.error('[eBay webhook] invalid JSON payload', error);
        sendJson(res, 400, { error: 'invalid_json' });
        return;
      }
      res.writeHead(204);
      res.end();
    });
    return;
  }

  res.writeHead(405);
  res.end('method not allowed');
});

server.listen(port, '127.0.0.1', () => {
  console.log(`eBay webhook listening on http://127.0.0.1:${port}`);
});
