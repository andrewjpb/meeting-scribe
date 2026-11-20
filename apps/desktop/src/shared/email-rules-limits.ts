// Contrato 55: os limites das regras de email (contrato 53) sem o zod, para a tela importar sem levar o esquema junto
// (o zod testa `new Function` e a CSP do renderer recusa). `email-rules.ts` reexporta daqui.

/** Regras por conta. */
export const EMAIL_RULES_MAX = 50
export const EMAIL_RULE_NAME_MAX = 100
export const EMAIL_RULE_CONDITIONS_MAX = 10
/** Caracteres do valor de uma condição. */
export const EMAIL_RULE_VALUE_MAX = 200
