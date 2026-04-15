import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

// SECURITY: Pre-computed dummy hash used during login when email is not found.
// Ensures constant-time comparison regardless of whether the user exists,
// preventing timing-based user enumeration attacks.
export const DUMMY_HASH = '$2a$10$dummyhashfortimingnormalisation.X.dummyhashfortimingnor';

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
