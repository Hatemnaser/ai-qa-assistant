import assert from 'node:assert/strict';
import { it } from 'node:test';
import { LoginPolicy } from '../src/login-policy.mjs';

const frame = (url, parent = null) => ({ url: () => url, parentFrame: () => parent });
const policy = () => new LoginPolicy({ baseUrl: 'https://example.com/', authenticationOrigins: ['https://login.example.com'], stop() {} });

it('allows blank/srcdoc child frames under approved parents, including nested frames', () => {
  const p = policy(), target = frame('https://example.com/app'), sso = frame('https://login.example.com/mfa');
  for (const parent of [target,sso]) for (const url of ['about:blank','about:blank#anchor','about:srcdoc']) {
    const child = frame(url,parent);
    assert.equal(p.allowsFrame(child),true);
    assert.equal(p.allowsFrame(frame('about:srcdoc',child)),true);
  }
});

it('rejects top-level local URLs and child frames under an unapproved parent', () => {
  const p = policy();
  for (const url of ['about:blank','about:srcdoc','chrome://settings','data:text/html,local','file:///tmp/local']) {
    assert.equal(p.allowsFrame(frame(url)),false);
  }
  for (const url of ['about:blank','about:srcdoc','https://unapproved.example.com/','data:text/html,local','chrome://settings']) {
    assert.equal(p.allowsFrame(frame(url,frame('https://unapproved.example.com/'))),false);
  }
});

it('restricts inherited-origin child frames to the target after handoff', () => {
  const p = policy(); p.finishing = true;
  assert.equal(p.allowsFrame(frame('about:srcdoc',frame('https://example.com/'))),true);
  assert.equal(p.allowsFrame(frame('about:blank',frame('https://login.example.com/'))),false);
  assert.equal(p.allowsFrame(frame('https://login.example.com/')),false);
});
