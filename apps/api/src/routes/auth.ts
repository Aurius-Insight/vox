import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import {
  clearUserSession,
  createUserSession,
  requireAuth,
  setUserSessionCookie,
} from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { ApiError, asyncHandler } from '../lib/http.js';

const router = Router();

// Senha minima de 8 caracteres na validacao de FORMATO do login. Nao
// rejeita senhas legadas (validacao acontece em runtime contra bcrypt
// hash); aumenta a barreira contra ataques que mandam payload absurdo.
// Politica de criacao de usuario continua exigindo min(12).
const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

router.post(
  '/login',
  authLimiter,
  asyncHandler(async (req, res) => {
    const input = LoginSchema.parse(req.body);
    const user = await prisma.user.findFirst({
      where: {
        email: input.email.toLowerCase(),
        active: true,
      },
    });

    if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
      throw new ApiError(401, 'invalid_credentials', 'E-mail ou senha invalidos.');
    }

    const sessionId = await createUserSession(user.id);
    setUserSessionCookie(res, sessionId);

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        roles: user.roles,
        unitId: user.unitId,
      },
    });
  }),
);

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// O proprio usuario (professor, coordenacao, diretor) edita seus dados: nome
// e senha. E-mail (login) e papeis nao sao editaveis aqui.
const UpdateMeSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  password: z.string().min(12).max(200).optional(),
});

router.patch(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = UpdateMeSchema.parse(req.body);
    const data: { name?: string; passwordHash?: string } = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.password !== undefined) data.passwordHash = await bcrypt.hash(input.password, 12);
    if (Object.keys(data).length === 0) {
      throw new ApiError(400, 'no_changes', 'Nada para atualizar.');
    }

    const updated = await prisma.user.update({
      where: { id: req.user!.id },
      data,
      select: { id: true, email: true, name: true, roles: true, unitId: true },
    });
    res.json({ user: updated });
  }),
);

router.post(
  '/logout',
  requireAuth,
  asyncHandler(async (req, res) => {
    await clearUserSession(req, res);
    res.status(204).send();
  }),
);

export default router;
