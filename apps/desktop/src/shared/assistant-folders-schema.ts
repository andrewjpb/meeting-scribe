// Esquema zod das pastas do Assistente (contrato 165). Separado de `assistant-folders.ts` para o renderer, que só usa os
// tipos e as regras, não carregar o zod. O main valida com ele a lista em `settings.json` e o que ele mesmo grava.
import { z } from 'zod'
import type { AssistantFolder } from './assistant-folders'

/** Caminho absoluto, até 1024 caracteres, sem caractere de controle (a mesma regra do caminho do `claude`). */
const FOLDER_PATH_MAX = 1024
const noControl = (value: string): boolean => ![...value].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f)

export const assistantFolderSchema: z.ZodType<AssistantFolder> = z
  .object({
    id: z.string().regex(/^[\w-]{1,64}$/),
    path: z
      .string()
      .min(1)
      .max(FOLDER_PATH_MAX)
      .refine((value) => value.startsWith('/') && noControl(value)),
    addedAt: z.string().min(1).max(64).refine(noControl),
  })
  .strict()
