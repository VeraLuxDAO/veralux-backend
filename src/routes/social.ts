import { Router } from 'express';
import { z } from 'zod';
import { storeText } from '../walrus.js';

const router = Router();

router.post('/flows', async (req, res) => {
  try {
    const schema = z.object({ content: z.string().min(1) });
    const { content } = schema.parse(req.body);
    const result = await storeText(content);
    return res.status(200).json({ ok: true, result });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e.message });
  }
});

router.get('/flows', async (_req, res) => {

  return res.json({ ok: true, items: [] });
});

router.post('/glows', (_req, res) => res.json({ ok: true, msg: 'stub' }));
router.post('/promotes', (_req, res) => res.json({ ok: true, msg: 'stub' }));
router.post('/rooms', (_req, res) => res.json({ ok: true, msg: 'stub' }));
router.post('/circles', (_req, res) => res.json({ ok: true, msg: 'stub' }));
router.post('/join', (_req, res) => res.json({ ok: true, msg: 'stub' }));

export default router;
