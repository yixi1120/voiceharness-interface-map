'use strict';
(() => {
  const site = 'https://yixi1120.github.io/voiceharness-interface-map/';
  const service = document.querySelector(
    'meta[name="github-login-service"]',
  )?.content;
  if (
    !service ||
    ![site, site + 'index.html'].includes(
      location.origin + location.pathname,
    ) ||
    new URL(service).protocol !== 'https:'
  )
    return;
  const keys = { pending: 'vh-oauth-pending', session: 'vh-oauth-session' };
  function read(key) {
    try {
      return JSON.parse(sessionStorage.getItem(key));
    } catch {
      return null;
    }
  }
  function random() {
    return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
  }
  async function call(path, init = {}) {
    return fetch(new URL(path, service), {
      ...init,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal: init.signal || AbortSignal.timeout(20000),
    });
  }
  const session = read(keys.session);
  const active =
    session?.expires > Date.now() && typeof session.ticket === 'string';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = active
    ? '退出 GitHub 登录（' + session.login + '）'
    : '用 GitHub 登录';
  document.getElementById('labBar').append(button);
  const say = (text) => {
    document.getElementById('labMessage').textContent = text;
  };
  async function signIn() {
    const res = await call('/client');
    if (!res.ok) throw Error('登录服务暂不可用。');
    const { clientId } = await res.json();
    if (!clientId) throw Error('GitHub 登录尚未配置。');
    const verifier = random(),
      state = random();
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(verifier),
    );
    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    sessionStorage.setItem(
      keys.pending,
      JSON.stringify({ state, verifier, at: Date.now(), hash: location.hash }),
    );
    const github = new URL('https://github.com/login/oauth/authorize');
    github.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: site,
      state,
      scope: '',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString();
    location.assign(github.href);
  }
  button.onclick = async () => {
    button.disabled = true;
    try {
      if (!active) {
        await signIn();
        return;
      }
      const res = await call('/session', {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + session.ticket },
      });
      if (!res.ok && res.status !== 401) throw Error('退出未完成，请重试。');
      sessionStorage.removeItem(keys.session);
      location.reload();
    } catch (e) {
      say(e.message);
      button.disabled = false;
    }
  };
  if (active) {
    window.mapGitHubLogin = {
      account: session.login,
      async read(path, init) {
        const headers = new Headers(init.headers);
        headers.set('Authorization', 'Bearer ' + session.ticket);
        const res = await call('/read' + path, { ...init, headers });
        if (res.status === 401) {
          sessionStorage.removeItem(keys.session);
          button.disabled = false;
          button.textContent = '重新用 GitHub 登录';
          button.onclick = () => signIn().catch((e) => say(e.message));
          say('GitHub 登录已过期，请重新登录。');
        }
        return res;
      },
    };
  }
  const query = new URLSearchParams(location.search);
  if (!query.has('code') && !query.has('error')) return;
  const pending = read(keys.pending);
  sessionStorage.removeItem(keys.pending);
  const pathHash = /^#(?:proposal|contract)=[1-9]\d{0,8}$/.test(pending?.hash)
    ? pending.hash
    : '';
  history.replaceState(null, '', site);
  button.disabled = true;
  (async () => {
    if (
      !pending ||
      pending.at + 600000 < Date.now() ||
      pending.state !== query.get('state')
    )
      throw Error('本次授权已失效，请重新登录。');
    if (query.has('error')) throw Error('已取消 GitHub 登录，可继续匿名查看。');
    const res = await call('/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: query.get('code'),
        verifier: pending.verifier,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw Error(data.message || '登录失败，请重试。');
    sessionStorage.setItem(keys.session, JSON.stringify(data));
    history.replaceState(null, '', site + pathHash);
    location.reload();
  })().catch((e) => {
    say(e.message);
    button.disabled = false;
  });
})();
