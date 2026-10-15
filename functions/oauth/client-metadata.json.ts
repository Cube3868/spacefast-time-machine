import { handle, type Env } from "../_app";
export function GET(request: Request, context: { env: Env }) {
  return handle(request, context.env);
}
