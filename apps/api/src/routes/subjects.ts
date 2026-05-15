import { Router } from 'express';
import { prisma } from '../db/client.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../lib/http.js';

const router = Router();

// As disciplinas sao fixas (decisao da reuniao: "sao sempre essas cinco
// disciplinas, nao vai mudar"), entao a rota e somente leitura.
router.get(
  '/',
  requireAuth,
  requireRole('diretor', 'coordenacao'),
  asyncHandler(async (_req, res) => {
    const subjects = await prisma.subject.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
    res.json({ data: subjects });
  }),
);

export default router;
