import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { UnauthenticatedError } from '../../plugins/session.js';
import {
  answerTopic, deleteTopic, deleteWording, mergeTopic, renameTopic, resolveConflict,
  setTopicSuppressed, splitWording, withdrawTopicAnswer,
} from './topic.service.js';

const params = z.object({ id: z.string().min(1).max(64) });

export const topicRoutes: FastifyPluginAsyncZod = async (app) => {
  // Narrowed rather than asserted: a non-null assertion would survive someone
  // moving the session hook off the scope.
  const owner = (request: { account?: { id: string } | null }) => {
    if (!request.account) throw new UnauthenticatedError();
    return request.account.id;
  };

  app.post('/topics/:id/answer', { schema: { params, body: z.object({ answer: z.string().max(4000) }) } }, async (request, reply) => {
    await answerTopic(app.prisma, owner(request), request.params.id, request.body.answer, request.log);
    return reply.send({ status: 'answered' });
  });
  app.delete('/topics/:id/answer', { schema: { params } }, async (request, reply) => {
    await withdrawTopicAnswer(app.prisma, owner(request), request.params.id);
    return reply.send({ status: 'withdrawn' });
  });
  app.post('/topics/:id/suppress', { schema: { params, body: z.object({ suppressed: z.boolean() }) } }, async (request, reply) => {
    await setTopicSuppressed(app.prisma, owner(request), request.params.id, request.body.suppressed);
    return reply.send({ status: 'updated' });
  });
  app.patch('/topics/:id', { schema: { params, body: z.object({ title: z.string().max(1000) }) } }, async (request, reply) => {
    await renameTopic(app.prisma, owner(request), request.params.id, request.body.title);
    return reply.send({ status: 'renamed' });
  });
  app.post('/topics/:id/merge', {
    schema: { params, body: z.object({ intoTopicId: z.string().min(1).max(64), keepAnswer: z.enum(['this', 'into']) }) },
  }, async (request, reply) => {
    await mergeTopic(app.prisma, owner(request), request.params.id, request.body.intoTopicId, request.body.keepAnswer);
    return reply.send({ status: 'merged' });
  });
  app.post('/topics/:id/resolve', { schema: { params, body: z.object({ keep: z.enum(['answer', 'conflict']) }) } }, async (request, reply) => {
    await resolveConflict(app.prisma, owner(request), request.params.id, request.body.keep);
    return reply.send({ status: 'resolved' });
  });
  app.delete('/topics/:id', { schema: { params } }, async (request, reply) => {
    await deleteTopic(app.prisma, owner(request), request.params.id);
    return reply.send({ status: 'deleted' });
  });
  app.post('/questions/:id/split', { schema: { params } }, async (request, reply) => {
    return reply.send(await splitWording(app.prisma, owner(request), request.params.id));
  });
  app.delete('/questions/:id', { schema: { params } }, async (request, reply) => {
    await deleteWording(app.prisma, owner(request), request.params.id);
    return reply.send({ status: 'deleted' });
  });
};
