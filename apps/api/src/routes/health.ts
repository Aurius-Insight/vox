import { Router } from 'express';

const router = Router();

router.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'vox-mvp-api',
    checkedAt: new Date().toISOString(),
  });
});

export default router;
