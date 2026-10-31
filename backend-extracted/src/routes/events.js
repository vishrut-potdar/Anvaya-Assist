import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { eventBodySchema, submitEvent } from '../services/events.js';

const router = Router();

// body: { event: {...all fields...}, signature: base64 ed25519 signature of canonicalize(event) }
router.post('/', requireAuth, async (req, res) => {
  const { event, signature } = z.object({ event: eventBodySchema, signature: z.string().min(1) }).parse(req.body);
  res.status(201).json(await submitEvent(req.partner, event, signature));
});

export default router;
