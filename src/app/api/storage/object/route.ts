import { toErrorResponse, AppError } from "@/lib/errors";
import { getLocalStore } from "@/lib/storage";
import { contentDisposition } from "@/lib/storage/names";
import { verifyToken } from "@/lib/storage/tokens";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

// The stand-in for presigned URLs when the storage driver is `memory` (tests) or `disk` (local
// development): the signed token in `?t=` says what may be done to which key until when. With the
// real `s3` driver, or with no storage, this route does not exist. Nothing here reads the session:
// the token is the permission, exactly as a presigned URL is.
const MAX_BYTES = 26 * 1024 * 1024;

function claimsFor(request: Request, op: "put" | "get") {
  const token = new URL(request.url).searchParams.get("t");
  const claims = token ? verifyToken(token, env.BETTER_AUTH_SECRET) : null;
  if (!getLocalStore() || !claims || claims.op !== op) throw new AppError("NOT_FOUND");
  return claims;
}

export async function PUT(request: Request) {
  try {
    const claims = claimsFor(request, "put");
    // The signed type must be sent unchanged, as S3 requires.
    const sent = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (sent !== claims.mime) throw new AppError("UNAUTHORIZED", "The signature does not match.");
    const body = new Uint8Array(await request.arrayBuffer());
    if (body.length === 0 || body.length > MAX_BYTES) throw new AppError("FILE_TOO_LARGE");
    await getLocalStore()!.put(claims.key, body, claims.mime);
    return new Response(null, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function GET(request: Request) {
  try {
    const claims = claimsFor(request, "get");
    const blob = await getLocalStore()!.get(claims.key);
    if (!blob) throw new AppError("NOT_FOUND");
    return new Response(blob.bytes as BodyInit, {
      headers: {
        "Content-Type": claims.mime,
        "Content-Disposition": contentDisposition(
          claims.filename ?? "file",
          claims.disposition ?? "attachment",
        ),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=45",
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
