import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../db/client.js';
import { hashPassword, comparePassword, DUMMY_HASH } from '../services/authService.js';
import { env } from '../config/env.js';

const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

const registerSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8)
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  // Register — creates account and auto-logs in so the setup wizard has an auth cookie
  app.post('/api/auth/register', async (req, reply) => {
    const body = registerSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos.' });

    const { name, email, password } = body.data;
    const password_hash = await hashPassword(password);
    let rows: { id: number }[];
    try {
      const result = await pool.query<{ id: number }>(
        'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
        [name, email, password_hash]
      );
      rows = result.rows;
    } catch (err: unknown) {
      const pg = err as { code?: string };
      if (pg.code === '23505') return reply.status(409).send({ error: 'Este email já está cadastrado.' });
      throw err;
    }

    const token = app.jwt.sign({ id: rows[0].id, email });
    reply.setCookie('token', token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: env.NODE_ENV === 'production',
      path: '/',
      maxAge: COOKIE_MAX_AGE
    });

    return reply.status(201).send({ name, email, setup_complete: false });
  });

  // Login
  app.post('/api/auth/login', async (req, reply) => {
    const body = loginSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos.' });

    const { email, password } = body.data;
    const { rows } = await pool.query<{
      id: number; name: string; email: string; password_hash: string;
    }>('SELECT id, name, email, password_hash FROM users WHERE email = $1', [email]);

    const user = rows[0];
    // SECURITY: Always run comparePassword even when user not found to prevent
    // timing-based user enumeration. DUMMY_HASH is a valid bcrypt hash (never matches).
    const hashToCompare = user ? user.password_hash : DUMMY_HASH;
    const valid = await comparePassword(password, hashToCompare);
    if (!user || !valid) return reply.status(401).send({ error: 'Email ou senha inválidos.' });

    const { rows: settings } = await pool.query<{ value: string }>(
      "SELECT value FROM settings WHERE key = 'setup_complete'"
    );
    const setup_complete = settings[0]?.value === 'true';

    const token = app.jwt.sign({ id: user.id, email: user.email });
    reply.setCookie('token', token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: env.NODE_ENV === 'production',
      path: '/',
      maxAge: COOKIE_MAX_AGE
    });

    return reply.send({ name: user.name, email: user.email, setup_complete });
  });

  // Logout
  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie('token', { path: '/' });
    return reply.send({ message: 'Sessão encerrada.' });
  });

  // Me — used by frontend on load to determine which screen to show
  app.get('/api/auth/me', async (req, reply) => {
    const token = req.cookies?.['token'];
    if (!token) {
      const { rows } = await pool.query('SELECT id FROM users LIMIT 1');
      const code = rows.length === 0 ? 'NO_USER' : 'NO_SESSION';
      return reply.status(401).send({ code });
    }

    try {
      const payload = app.jwt.verify<{ id: number; email: string }>(token);
      const { rows: userRows } = await pool.query<{ name: string; email: string }>(
        'SELECT name, email FROM users WHERE id = $1',
        [payload.id]
      );
      const { rows: settings } = await pool.query<{ value: string }>(
        "SELECT value FROM settings WHERE key = 'setup_complete'"
      );
      const setup_complete = settings[0]?.value === 'true';
      return reply.send({ name: userRows[0]?.name, email: userRows[0]?.email, setup_complete });
    } catch {
      const { rows } = await pool.query('SELECT id FROM users LIMIT 1');
      const code = rows.length === 0 ? 'NO_USER' : 'NO_SESSION';
      return reply.status(401).send({ code });
    }
  });
}
