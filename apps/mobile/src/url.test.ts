/// <reference types="node" />
// Pins for src/url.ts (pure; run with node --import tsx --test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  START_PATH,
  URL_CREDENTIALS_ERROR,
  URL_EMPTY_ERROR,
  URL_HTTP_ERROR,
  URL_INVALID_ERROR,
  URL_PORT_ERROR,
  URL_SCHEME_ERROR,
  classifyNavigation,
  isPrivateIpv4,
  isSameOrigin,
  isValidHost,
  normalizePosUrl,
  originOf,
  startUrl,
  isStartPageFailure,
  topFrameBackstop,
} from './url';

const ORIGIN = 'https://pos.example.com';
const SCRIPT_SCHEME = 'java' + 'script:'; // built so the linter's script-url rule stays quiet

function origin(input: string): string {
  const result = normalizePosUrl(input);
  assert.equal(result.ok, true, input + ' should be accepted');
  return result.ok ? result.origin : '';
}

function error(input: string): string {
  const result = normalizePosUrl(input);
  assert.equal(result.ok, false, input + ' should be refused');
  return result.ok ? '' : result.error;
}

test('START_PATH is /pos and startUrl appends it', () => {
  assert.equal(START_PATH, '/pos');
  assert.equal(startUrl(ORIGIN), 'https://pos.example.com/pos');
});

test('empty and blank input -> empty error', () => {
  assert.equal(error(''), URL_EMPTY_ERROR);
  assert.equal(error('   '), URL_EMPTY_ERROR);
});

test('a bare host gets https:// prepended', () => {
  assert.equal(origin('pos.example.com'), ORIGIN);
  assert.equal(origin('  pos.example.com  '), ORIGIN);
});

test('a bare workspace name opens <name>.sandbee.in, as in the Sandbee app; full addresses are unchanged', () => {
  assert.equal(origin('posdemo'), 'https://posdemo.sandbee.in');
  assert.equal(origin('  PosDemo '), 'https://posdemo.sandbee.in', 'trimmed and lowercased');
  assert.equal(origin('my-cafe'), 'https://my-cafe.sandbee.in');
  assert.equal(origin('posdemo.sandbee.in'), 'https://posdemo.sandbee.in', 'the full address still works');
  assert.equal(origin('pos.example.com'), ORIGIN, 'any other full address still works');
  assert.equal(origin('localhost'), 'https://localhost', 'localhost stays itself');
  assert.equal(origin('http://localhost:3100'), 'http://localhost:3100', 'a written scheme or port is never expanded');
  assert.equal(error('-cafe'), URL_INVALID_ERROR);
  assert.equal(error('cafe_1'), URL_INVALID_ERROR);
});

test('the release review: a bare name with a path, query or hash expands too; a digits-only name never does', () => {
  assert.equal(origin('yourcafe/pos'), 'https://yourcafe.sandbee.in', 'M3: a path after the name');
  assert.equal(origin('posdemo?x=1'), 'https://posdemo.sandbee.in', 'M3: a query');
  assert.equal(origin('posdemo#top'), 'https://posdemo.sandbee.in', 'M3: a hash');
  assert.equal(origin('localhost/pos'), 'https://localhost', 'localhost with a path stays itself');
  assert.equal(error('192'), URL_INVALID_ERROR, 'M4: a mistyped IP is refused at once, never sent to sandbee.in');
  assert.equal(error('10'), URL_INVALID_ERROR);
  assert.equal(origin('cafe24'), 'https://cafe24.sandbee.in', 'letters and digits together are a name');
  assert.match(URL_INVALID_ERROR, /workspace name/, 'M5: the error names both ways in');
});

test('https keeps only the origin: path, query, hash dropped', () => {
  assert.equal(origin('https://pos.example.com/pos?x=1#top'), ORIGIN);
});

test('scheme and host are lowercased', () => {
  assert.equal(origin('HTTPS://POS.Example.COM'), ORIGIN);
});

test('default ports are dropped, other ports kept', () => {
  assert.equal(origin('https://pos.example.com:443'), ORIGIN);
  assert.equal(origin('https://pos.example.com:8443'), ORIGIN + ':8443');
  assert.equal(origin('http://192.168.1.20:80'), 'http://192.168.1.20');
  assert.equal(origin('http://192.168.1.20:3000'), 'http://192.168.1.20:3000');
  assert.equal(origin('https://pos.example.com:0443'), ORIGIN);
});

test('ports must be 1..65535 digits', () => {
  assert.equal(error('https://pos.example.com:0'), URL_PORT_ERROR);
  assert.equal(error('https://pos.example.com:65536'), URL_PORT_ERROR);
  assert.equal(error('https://pos.example.com:abc'), URL_PORT_ERROR);
  assert.equal(error('https://pos.example.com:'), URL_PORT_ERROR);
  assert.equal(origin('https://pos.example.com:65535'), ORIGIN + ':65535');
  assert.equal(origin('https://pos.example.com:1'), ORIGIN + ':1');
});

test('credentials are refused', () => {
  assert.equal(error('https://user:pw@pos.example.com'), URL_CREDENTIALS_ERROR);
  assert.equal(error('https://user@pos.example.com'), URL_CREDENTIALS_ERROR);
});

test('other schemes are refused', () => {
  assert.equal(error('ftp://pos.example.com'), URL_SCHEME_ERROR);
  assert.equal(error('file:///etc/passwd'), URL_SCHEME_ERROR);
  assert.equal(error(SCRIPT_SCHEME + '//x'), URL_SCHEME_ERROR);
});

test('scheme-less junk never becomes a script or app link', () => {
  assert.equal(error(SCRIPT_SCHEME + 'alert(1)'), URL_PORT_ERROR);
  assert.ok(error('mailto:someone@example.com').length > 0);
});

test('http: only localhost and private IPv4 ranges', () => {
  assert.equal(origin('http://localhost:3000'), 'http://localhost:3000');
  assert.equal(origin('http://127.0.0.1'), 'http://127.0.0.1');
  assert.equal(origin('http://10.0.2.2:3000'), 'http://10.0.2.2:3000');
  assert.equal(origin('http://172.16.0.5'), 'http://172.16.0.5');
  assert.equal(origin('http://172.31.255.255'), 'http://172.31.255.255');
  assert.equal(origin('http://192.168.1.20'), 'http://192.168.1.20');
});

test('http: public and look-alike addresses are refused', () => {
  assert.equal(error('http://example.com'), URL_HTTP_ERROR);
  assert.equal(error('http://172.15.0.5'), URL_HTTP_ERROR);
  assert.equal(error('http://172.32.0.5'), URL_HTTP_ERROR);
  assert.equal(error('http://192.169.1.1'), URL_HTTP_ERROR);
  assert.equal(error('http://11.0.0.1'), URL_HTTP_ERROR);
  assert.equal(error('http://8.8.8.8'), URL_HTTP_ERROR);
  assert.equal(error('http://localhost.evil.com'), URL_HTTP_ERROR);
  assert.equal(error('http://10.0.0.1.evil.com'), URL_HTTP_ERROR);
});

test('IPv6 literals are refused (http and https)', () => {
  assert.equal(error('http://[::1]:3000'), URL_INVALID_ERROR);
  assert.equal(error('https://[::1]'), URL_INVALID_ERROR);
});

test('malformed hosts are refused', () => {
  assert.equal(error('https://'), URL_INVALID_ERROR);
  assert.equal(error('https://exa mple.com'), URL_INVALID_ERROR);
  assert.equal(error('https://example..com'), URL_INVALID_ERROR);
  assert.equal(error('https://-example.com'), URL_INVALID_ERROR);
  assert.equal(error('https://example.com.'), URL_INVALID_ERROR);
  assert.equal(error('https://exa_mple.com'), URL_INVALID_ERROR);
  assert.equal(error('https://256.1.1.1'), URL_INVALID_ERROR);
  assert.equal(error('https://1.2.3'), URL_INVALID_ERROR);
  assert.equal(error('https://01.2.3.4'), URL_INVALID_ERROR);
  assert.equal(error('https://a' + 'b'.repeat(64) + '.com'), URL_INVALID_ERROR);
});

test('isValidHost / isPrivateIpv4 edges', () => {
  assert.equal(isValidHost('pos'), true);
  assert.equal(isValidHost('a-b.example.com'), true);
  assert.equal(isValidHost(''), false);
  assert.equal(isValidHost(('a'.repeat(62) + '.').repeat(5) + 'com'), false);
  assert.equal(isPrivateIpv4('10.255.255.255'), true);
  assert.equal(isPrivateIpv4('127.9.9.9'), true);
  assert.equal(isPrivateIpv4('192.168.0.0'), true);
  assert.equal(isPrivateIpv4('169.254.1.1'), false);
  assert.equal(isPrivateIpv4('localhost'), false);
});

test('isSameOrigin: same origin only', () => {
  assert.equal(
    isSameOrigin('https://pos.example.com/pos/orders?x=1', ORIGIN),
    true,
  );
  assert.equal(isSameOrigin('https://pos.example.com', ORIGIN), true);
  assert.equal(isSameOrigin('HTTPS://POS.EXAMPLE.COM:443/x', ORIGIN), true);
  assert.equal(isSameOrigin('http://pos.example.com/', ORIGIN), false);
  assert.equal(isSameOrigin('https://pos.example.com:8443/', ORIGIN), false);
  assert.equal(isSameOrigin('https://evil.com/', ORIGIN), false);
  assert.equal(
    isSameOrigin('https://pos.example.com.evil.com/', ORIGIN),
    false,
  );
  assert.equal(isSameOrigin('not a url', ORIGIN), false);
  assert.equal(isSameOrigin('', ORIGIN), false);
});

test('isSameOrigin: userinfo and backslash tricks are never "same"', () => {
  assert.equal(
    isSameOrigin('https://pos.example.com@evil.com/', ORIGIN),
    false,
  );
  assert.equal(
    isSameOrigin('https://evil.com@pos.example.com/', ORIGIN),
    false,
  );
  assert.equal(
    isSameOrigin('https://pos.example.com\\@evil.com/', ORIGIN),
    false,
  );
  assert.equal(
    isSameOrigin('https://evil.com\\.pos.example.com/', ORIGIN),
    false,
  );
  assert.equal(
    isSameOrigin('https://pos.example.com\t.evil.com/', ORIGIN),
    false,
  );
});

test('originOf: strict', () => {
  assert.equal(originOf('https://pos.example.com/pos'), ORIGIN);
  assert.equal(originOf(ORIGIN), ORIGIN);
  assert.equal(originOf('ftp://pos.example.com'), null);
  assert.equal(originOf('about:blank'), null);
  assert.equal(originOf('https://u@pos.example.com'), null);
});

test('classifyNavigation: top frame table', () => {
  const top = (url: string) => classifyNavigation(url, ORIGIN, true);
  assert.equal(top('https://pos.example.com/pos'), 'allow');
  assert.equal(top('https://pos.example.com/pos/orders?id=1#x'), 'allow');
  assert.equal(top('about:blank'), 'allow');
  assert.equal(top('https://other.example.com/'), 'external');
  assert.equal(top('http://pos.example.com/'), 'external');
  assert.equal(top('HTTP://other.example.com/'), 'external');
  assert.equal(top('https://pos.example.com@evil.com/'), 'external');
  assert.equal(top(SCRIPT_SCHEME + 'alert(1)'), 'deny');
  assert.equal(top('intent://scan/#Intent;scheme=zxing;end'), 'deny');
  assert.equal(top('file:///sdcard/x.html'), 'deny');
  assert.equal(top('data:text/html,hi'), 'deny');
  assert.equal(top('blob:https://pos.example.com/abc'), 'deny');
  assert.equal(top('content://media/x'), 'deny');
  assert.equal(top('chrome://crash'), 'deny');
  assert.equal(top('about:srcdoc'), 'deny');
  assert.equal(top('tel:+911234567890'), 'deny');
  assert.equal(top(''), 'deny');
});

test('classifyNavigation: sub-frame table', () => {
  const sub = (url: string) => classifyNavigation(url, ORIGIN, false);
  assert.equal(sub('https://pos.example.com/frame'), 'allow');
  assert.equal(sub('https://pay.example.net/widget'), 'allow');
  assert.equal(sub('http://pay.example.net/widget'), 'allow');
  assert.equal(sub('about:blank'), 'allow');
  assert.equal(sub('about:srcdoc'), 'allow');
  assert.equal(sub('data:text/html,hi'), 'allow');
  assert.equal(sub('blob:https://pos.example.com/abc'), 'allow');
  assert.equal(sub(SCRIPT_SCHEME + 'alert(1)'), 'deny');
  assert.equal(sub('file:///x'), 'deny');
  assert.equal(sub('intent://x'), 'deny');
  assert.equal(sub('content://x'), 'deny');
  assert.equal(sub(''), 'deny');
});

test('topFrameBackstop: nothing for the saved origin, a blank page or no url', () => {
  const act = (url: string) => topFrameBackstop(url, ORIGIN);
  assert.equal(act('https://pos.example.com/pos'), 'none');
  assert.equal(act('https://pos.example.com/pos/orders?id=1#x'), 'none');
  assert.equal(act('about:blank'), 'none');
  assert.equal(act(''), 'none');
});

test('topFrameBackstop: a foreign web page is recovered and opened outside the app', () => {
  const act = (url: string) => topFrameBackstop(url, ORIGIN);
  assert.equal(act('https://other.example.com/'), 'recover-and-open');
  assert.equal(act('http://pos.example.com/'), 'recover-and-open');
  assert.equal(act('https://pos.example.com@evil.com/'), 'recover-and-open');
  assert.equal(act('HTTP://other.example.com/'), 'recover-and-open');
});

test('topFrameBackstop: every other scheme is recovered but never opened', () => {
  const act = (url: string) => topFrameBackstop(url, ORIGIN);
  assert.equal(act(SCRIPT_SCHEME + 'alert(1)'), 'recover');
  assert.equal(act('file:///sdcard/x.html'), 'recover');
  assert.equal(act('intent://scan/#Intent;scheme=zxing;end'), 'recover');
  assert.equal(act('content://media/x'), 'recover');
  assert.equal(act('data:text/html,hi'), 'recover');
  assert.equal(act('chrome://crash'), 'recover');
});

test('isStartPageFailure: only an error status on the start page itself', () => {
  const fail = (url: string, status: number) =>
    isStartPageFailure(url, status, ORIGIN);
  assert.equal(fail('https://pos.example.com/pos', 503), true);
  assert.equal(fail('https://pos.example.com/pos', 404), true);
  assert.equal(fail('https://pos.example.com/pos/', 500), true);
  assert.equal(fail('https://pos.example.com/pos?x=1#top', 502), true);
  assert.equal(fail('https://pos.example.com/pos', 400), true);
  assert.equal(fail('https://pos.example.com/pos', 399), false);
  assert.equal(fail('https://pos.example.com/pos', 200), false);
  assert.equal(fail('https://pos.example.com/pos/orders', 404), false);
  assert.equal(fail('https://pos.example.com/posx', 500), false);
  assert.equal(fail('https://other.example.com/pos', 500), false);
  assert.equal(fail('', 500), false);
});
