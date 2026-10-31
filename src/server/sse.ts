import { Response } from 'express';

interface Client {
  id: string;
  res: Response;
}

const clients: Map<string, Client> = new Map();

export function addSseClient(id: string, res: Response): void {
  clients.set(id, { id, res });
  // Send initial ping
  res.write(`data: ${JSON.stringify({ type: 'CONNECTED', clientCount: clients.size })}\n\n`);
}

export function removeSseClient(id: string): void {
  clients.delete(id);
}

export function broadcastAlert(alert: Record<string, any>): void {
  const payload = JSON.stringify({ type: 'NEW_ALERT', data: alert });
  for (const [id, client] of clients.entries()) {
    try {
      client.res.write(`data: ${payload}\n\n`);
    } catch {
      clients.delete(id);
    }
  }
}

export function broadcastEvent(event: Record<string, any>): void {
  const payload = JSON.stringify({ type: 'NEW_EVENT', data: event });
  for (const [id, client] of clients.entries()) {
    try {
      client.res.write(`data: ${payload}\n\n`);
    } catch {
      clients.delete(id);
    }
  }
}
