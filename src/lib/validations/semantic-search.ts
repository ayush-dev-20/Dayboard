import { z } from "zod";

export const setSemanticSearchSchema = z.strictObject({ enabled: z.boolean() });
