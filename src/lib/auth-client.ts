import { createAuthClient } from "better-auth/react";
import { magicLinkClient } from "better-auth/client/plugins";

// Browser client. Holds no secrets; every call goes to /api/auth on the same origin.
export const authClient = createAuthClient({
  plugins: [magicLinkClient()],
});
