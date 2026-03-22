import Fastify from "fastify";
// import dotenv from "dotenv";
import "dotenv/config";
import { version } from "pino";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { appRouter } from "./trpc.js";
// dotenv.config();

//initialize server with fastify and pino-logger
const server = Fastify({
  logger: {
    transport: {
      target: "pino-pretty",
    },
  },
});


// Register the tRPC plugin
server.register(fastifyTRPCPlugin, {
  prefix: '/trpc',
  trpcOptions: { router: appRouter },
});

export default server;

