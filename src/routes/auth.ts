import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../db/client.js';
import { hashPassword, comparePassword } from '../services/authService.js';

const registerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8)
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  // Register — only allowed while users table is empty
  app.post('/api/auth/register', async (req, reply) => {
    const body = registerSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos.' });

    const { rows: existing } = await pool.query('SELECT id FROM users LIMIT 1');
    if (existing.length > 0) {
      return reply.status(403).send({ error: 'Registro já foi realizado.' });
    }

    const { name, email, password } = body.data;
    const password_hash = await hashPassword(password);
    await pool.query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3)',
      [name, email, password_hash]
    );

    return reply.status(201).send({ message: 'Conta criada.' });
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
    const valid = user && (await comparePassword(password, user.password_hash));
    if (!valid) return reply.status(401).send({ error: 'Email ou senha inválidos.' });

    const { rows: settings } = await pool.query<{ value: string }>(
      "SELECT value FROM settings WHERE key = 'setup_complete'"
    );
    const setup_complete = settings[0]?.value === 'true';

    const token = app.jwt.sign({ id: user.id, email: user.email });
    reply.setCookie('token', token, {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      maxAge: 60 * 60 * 24 * 30
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
    const token = (req as unknown as { cookies: Record<string, string> }).cookies['token'];
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
