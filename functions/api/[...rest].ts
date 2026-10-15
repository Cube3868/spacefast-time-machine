import { handle, type Env } from "../_app";
export default (request: Request, context: { env: Env }) =>
  handle(request, context.env);
