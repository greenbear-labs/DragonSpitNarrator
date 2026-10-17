// Vercel function for every /api/* route (vercel.json rewrites them here). See _lib/relay.ts.

import { configFromEnv, createRelay, pathOf } from "./_lib/relay";
import { storeFromEnv } from "./_lib/store";

const handle = createRelay(configFromEnv(process.env), storeFromEnv(process.env));

const serve = (request: Request) => handle(request, pathOf(request));

export const GET = serve;
export const POST = serve;
export const DELETE = serve;
