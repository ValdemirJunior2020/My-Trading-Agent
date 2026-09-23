import { addEvent } from './db.js';
const clients = new Set();
export const attachEventStream = (res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('event: ready\ndata: {"ok":true}\n\n');
    clients.add(res);
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
    res.on('close', () => { clearInterval(heartbeat); clients.delete(res); });
};
export const publish = (type, payload, agentId) => {
    const event = addEvent(type, payload, agentId), data = JSON.stringify(event);
    for (const client of clients)
        client.write(`event: agent\ndata: ${data}\n\n`);
    return event;
};
