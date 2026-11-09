import { createRequire } from 'node:module';

it('não confia em IPv4 externo por um prefixo IPv6 mapeado curto', () => {
  const fromNest = createRequire(
    createRequire(__filename).resolve('@nestjs/platform-express/package.json'),
  );
  const fromExpress = createRequire(fromNest.resolve('express/package.json'));
  const proxy = fromExpress('proxy-addr') as {
    compile(range: string): (address: string, index: number) => boolean;
  };
  expect(proxy.compile('::ffff:10.0.0.0/8')('8.8.8.8', 0)).toBe(false);
  expect(proxy.compile('::/1')('8.8.8.8', 0)).toBe(false);
  expect(proxy.compile('::ffff:10.0.0.0/104')('10.1.2.3', 0)).toBe(true);
  expect(proxy.compile('10.0.0.0/8')('10.1.2.3', 0)).toBe(true);
});
