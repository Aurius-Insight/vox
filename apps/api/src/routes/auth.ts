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

router.post(
  '/logout',
  requireAuth,
  asyncHandler(async (req, res) => {
    await clearUserSession(req, res);
    res.status(204).send();
  }),
);

export default router;
