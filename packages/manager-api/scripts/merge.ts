import { Effect, Schema } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";
import { NodeHttpClient, NodeRuntime, NodeServices } from "@effect/platform-node";
import * as OpenapiMerge from "openapi-merge";

const Names = Schema.Struct({
  names: Schema.Array(Schema.String),
});

Effect.gen(function* () {
  const client = (yield* HttpClient.HttpClient).pipe(
    HttpClient.mapRequest(HttpClientRequest.prependUrl("https://www.manager.io/api")),
  );

  const { names } = yield* client
    .get("/openapi-specs/")
    .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(Names)));

  const specs = yield* Effect.forEach(
    names,
    (name) => {
      process.stderr.write(".");
      return client.get(`/openapi-specs/${name}`).pipe(Effect.flatMap((r) => r.json));
    },
    { concurrency: 30 },
  );
  process.stderr.write("\n");

  const result = OpenapiMerge.merge([
    {
      oas: {
        openapi: "3.0.3",
        info: {
          title: "Manager API",
          version: "1.0.0",
        },
      },
    },
    ...specs.map((oas) => ({
      oas: oas as any,
    })),
  ]);

  if ("output" in result) {
    console.log(JSON.stringify(result.output, null, 2));
  }
}).pipe(Effect.provide([NodeServices.layer, FetchHttpClient.layer]), NodeRuntime.runMain);
