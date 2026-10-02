import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postLoginRoute } from '../src/app/login/post-login-route.ts';

for (const role of ['USER', 'MANAGER', 'ADMIN', 'SUPER_ADMIN']) {
  test(`${role} lands on /projects after sign-in`, () => {
    assert.equal(postLoginRoute(role), '/projects');
    assert.equal(postLoginRoute(role, null), '/projects');
  });
}

test('an internal returnUrl is honoured', () => {
  assert.equal(postLoginRoute('USER', '/settings'), '/settings');
});

test('external or login returnUrls are ignored', () => {
  assert.equal(postLoginRoute('ADMIN', '//evil.example'), '/projects');
  assert.equal(postLoginRoute('ADMIN', 'https://evil.example'), '/projects');
  assert.equal(postLoginRoute('MANAGER', '/login?x=1'), '/projects');
});
