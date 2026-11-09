/*
 * Simulador da Orders API (QR) do Mercado Pago para o ambiente kind e o CI.
 * Reproduz somente os campos que o Billing verifica e envia o webhook assinado
 * como o provedor real. Não substitui o ensaio com credenciais de teste.
 */
const http = require('node:http');
const { createHmac, randomBytes, randomUUID } = require('node:crypto');

const secret = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
const webhookUrl = process.env.WEBHOOK_URL;
if (!secret || !webhookUrl) throw new Error('MERCADO_PAGO_WEBHOOK_SECRET e WEBHOOK_URL são obrigatórios');

const orders = new Map();
const byKey = new Map();
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const id = (prefix) => prefix + Array.from(randomBytes(26), (byte) => alphabet[byte % alphabet.length]).join('');

function view(order) {
  const state = order.refunded ? 'refunded' : order.paid ? 'processed' : order.canceled ? 'canceled' : 'created';
  const detail = { refunded: 'refunded', processed: 'accredited', canceled: 'canceled', created: 'created' }[state];
  return {
    id: order.id,
    type: 'qr',
    external_reference: order.externalReference,
    currency: 'BRL',
    total_amount: order.total,
    status: state,
    status_detail: detail,
    type_response: { qr_data: order.qr },
    transactions: {
      payments: [{
        id: order.transactionId,
        reference_id: order.paymentId,
        status: state,
        status_detail: state === 'canceled' ? 'canceled_by_api' : detail,
        paid_amount: order.paid ? order.total : '0.00',
        ...(order.refunded ? { refunded_amount: order.total } : {}),
      }],
      refunds: order.refunded ? [{ id: order.refundId, transaction_id: order.transactionId, status: 'processed', amount: order.total }] : [],
    },
  };
}

async function notify(order) {
  const requestId = randomUUID();
  const ts = String(Date.now());
  const v1 = createHmac('sha256', secret).update(`id:${order.id.toLowerCase()};request-id:${requestId};ts:${ts};`).digest('hex');
  const response = await fetch(`${webhookUrl}?data.id=${order.id}&type=order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-request-id': requestId, 'x-signature': `ts=${ts},v1=${v1}` },
    body: JSON.stringify({ type: 'order', action: 'order.processed', data: { id: order.id } }),
  });
  return response.status;
}

async function body(request) {
  let raw = '';
  for await (const chunk of request) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function send(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(payload));
}

http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://simulador');
    const path = url.pathname.split('/').filter(Boolean);
    if (request.method === 'GET' && url.pathname === '/saude') return send(response, 200, { status: 'ok' });
    if (request.method === 'POST' && url.pathname === '/v1/orders') {
      const key = request.headers['x-idempotency-key'];
      if (key && byKey.has(key)) return send(response, 201, view(orders.get(byKey.get(key))));
      const input = await body(request);
      const order = {
        id: id('ORD'), externalReference: input.external_reference, total: input.total_amount, qr: `00020101021226-SIMULADO-${randomUUID()}`,
        transactionId: id('PAY'), paymentId: String(Date.now()), refundId: id('REF'), createdAt: Date.now(),
      };
      orders.set(order.id, order);
      if (key) byKey.set(key, order.id);
      return send(response, 201, view(order));
    }
    if (path[0] === 'v1' && path[1] === 'orders' && orders.has(path[2])) {
      const order = orders.get(path[2]);
      if (request.method === 'GET' && path.length === 3) return send(response, 200, view(order));
      if (request.method === 'POST' && path[3] === 'cancel' && !order.paid) { order.canceled = true; return send(response, 200, view(order)); }
      if (request.method === 'POST' && path[3] === 'refund' && order.paid) { order.refunded = true; return send(response, 200, view(order)); }
      return send(response, 409, { message: 'Operação incompatível com o estado da order' });
    }
    if (request.method === 'GET' && path[0] === 'v1' && path[1] === 'payments') {
      const order = [...orders.values()].find((item) => item.paymentId === path[2] && item.paid);
      if (!order) return send(response, 404, { message: 'Pagamento não encontrado' });
      return send(response, 200, {
        id: Number(order.paymentId), status: 'approved', status_detail: 'accredited', currency_id: 'BRL',
        transaction_amount: Number(order.total), transaction_amount_refunded: 0, date_approved: new Date(order.paidAt).toISOString(),
      });
    }
    // Rotas do simulador: o teste localiza a order e aciona o pagamento do comprador.
    if (request.method === 'GET' && url.pathname === '/simulador/ordens') {
      return send(response, 200, [...orders.values()].sort((a, b) => b.createdAt - a.createdAt).map(view));
    }
    if (request.method === 'POST' && path[0] === 'simulador' && path[1] === 'pagamentos' && orders.has(path[2])) {
      const order = orders.get(path[2]);
      if (order.canceled) return send(response, 409, { message: 'Order cancelada' });
      order.paid = true; order.paidAt = Date.now();
      return send(response, 200, { status: 'PAGO', webhook: await notify(order) });
    }
    return send(response, 404, { message: 'Rota não simulada' });
  } catch (error) {
    return send(response, 500, { message: error.message });
  }
}).listen(8080, () => process.stdout.write('Mercado Pago simulado na porta 8080\n'));
