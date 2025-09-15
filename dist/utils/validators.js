"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.passwordPolicy = exports.registerSchema = void 0;
exports.validateRegister = validateRegister;
const zod_1 = require("zod");
exports.registerSchema = zod_1.z.object({
    email: zod_1.z.string().min(1).transform((s) => s.trim()),
    name: zod_1.z.string().min(2),
    password: zod_1.z.string().min(8),
});
function validateRegister(data) {
    const result = exports.registerSchema.safeParse(data);
    if (result.success)
        return { success: true, data: result.data };
    const issues = result.error.issues || [];
    const errors = issues.map((e) => ({ path: (e.path || []).join('.'), message: e.message }));
    return { success: false, errors };
}
const passwordPolicy = (pwd) => {
    const checks = {
        length: pwd.length >= 8,
        upper: /[A-Z]/.test(pwd),
        lower: /[a-z]/.test(pwd),
        number: /[0-9]/.test(pwd),
        symbol: /[^A-Za-z0-9]/.test(pwd),
    };
    return { ok: Object.values(checks).every(Boolean), checks };
};
exports.passwordPolicy = passwordPolicy;
exports.default = { registerSchema: exports.registerSchema, validateRegister, passwordPolicy: exports.passwordPolicy };
