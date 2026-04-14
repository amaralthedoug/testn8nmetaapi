import bcrypt from 'bcryptjs';
import { AuthError } from '../types/errors.js';

const SALT_ROUNDS = 10;

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 8) {
    throw new AuthError('Senha deve ter mínimo 8 caracteres');
  }
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
