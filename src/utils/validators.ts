import { z } from 'zod'

export const registerSchema = z.object({
  email: z.string().min(1).transform((s: string) => s.trim()),
  name: z.string().min(2),
  password: z.string().min(8),
})

export function validateRegister(data: unknown) {
  const result = registerSchema.safeParse(data)
  if (result.success) return { success: true, data: result.data }
  const issues = result.error.issues || []
  const errors = issues.map((e: { path?: Array<string | number>, message: string }) => ({ path: (e.path || []).join('.'), message: e.message }))
  return { success: false, errors }
}

export const passwordPolicy = (pwd: string) => {
  const checks = {
    length: pwd.length >= 8,
    upper: /[A-Z]/.test(pwd),
    lower: /[a-z]/.test(pwd),
    number: /[0-9]/.test(pwd),
    symbol: /[^A-Za-z0-9]/.test(pwd),
  }
  return { ok: Object.values(checks).every(Boolean), checks }
}

export default { registerSchema, validateRegister, passwordPolicy }
