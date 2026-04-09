import { Hono } from "hono";
import { MODEL_ENDPOINT_MAP } from "../infra/types.js";
import type { GatewayConfig } from "../infra/types.js";

const MODEL_LIST = Object.keys(MODEL_ENDPOINT_MAP).map((id) => ({
  id,
  object: "model" as const,
  created: 1700000000,
  owned_by: "jh-web",
}));

const MODEL_SET = new Set(Object.keys(MODEL_ENDPOINT_MAP));

export function modelsRouter(_config: GatewayConfig): Hono {
  const app = new Hono();

  app.get("/", (c) => {
    return c.json({ object: "list", data: MODEL_LIST });
  });

  app.get("/:id", (c) => {
    const id = c.req.param("id");
    if (!MODEL_SET.has(id)) {
      return c.json(
        {
          error: {
            message: `Model '${id}' not found`,
            type: "invalid_request_error",
            code: "model_not_found",
            param: "id",
          },
        },
        404
      );
    }
    return c.json({ id, object: "model", created: 1700000000, owned_by: "jh-web" });
  });

  return app;
}
