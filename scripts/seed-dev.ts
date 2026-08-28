import { prisma } from '@curios/db';

const account = await prisma.account.upsert({
  where: { email: 'nadia@example.com' },
  update: {},
  create: {
    email: 'nadia@example.com',
    name: 'Nadia',
    identities: {
      create: { provider: 'GOOGLE', providerUserId: 'dev-sub-1', email: 'nadia@example.com' },
    },
    pages: {
      create: {
        handle: 'nadia',
        displayName: 'Nadia Bakes',
        bio: 'Kek butter dan brownies, Shah Alam',
        language: 'ms',
        published: true,
        links: {
          create: [
            { label: 'WhatsApp', url: 'https://wa.me/60123456789', position: 0 },
            { label: 'Instagram', url: 'https://instagram.com/example', position: 1 },
          ],
        },
        neverSay: { create: { phrase: 'halal certified' } },
      },
    },
  },
  include: { pages: true },
});

console.log('page id:', account.pages[0]?.id);
console.log('visit:   http://localhost:3000/nadia');
await prisma.$disconnect();
