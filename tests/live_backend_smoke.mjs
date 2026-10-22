/**
 * Read-only smoke test for the real nanny backend.
 *
 * Requires MULTIBOT_API_URL, MULTIBOT_ADMIN_LOGIN and MULTIBOT_ADMIN_PASSWORD.
 * Does not create orders, modify users, or print credentials/tokens/response bodies.
 */
const required = (name) => {
  const value = (process.env[name] || '').trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const baseUrl = required('MULTIBOT_API_URL').replace(/\/+$/, '');
const login = required('MULTIBOT_ADMIN_LOGIN');
const password = required('MULTIBOT_ADMIN_PASSWORD');

const parsedBase = new URL(baseUrl);
if (parsedBase.protocol !== 'https:') {
  throw new Error('MULTIBOT_API_URL must use HTTPS');
}
if (!parsedBase.pathname.replace(/\/+$/, '').endsWith('/api/v1')) {
  throw new Error('MULTIBOT_API_URL must point to the /api/v1 endpoint');
}

async function postForm(stage, path, values) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null) body.set(key, String(value));
  }

  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body,
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    const code = error && typeof error === 'object' && 'cause' in error
      ? error.cause?.code
      : undefined;
    throw new Error(`${stage}: network/TLS request failed${code ? ` (${code})` : ''}`);
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`${stage}: backend returned non-JSON response (HTTP ${response.status})`);
  }

  if (!response.ok || data?.status === 'error') {
    const code = data?.code ? `, API code ${String(data.code).slice(0, 80)}` : '';
    throw new Error(`${stage}: failed (HTTP ${response.status}${code})`);
  }
  console.log(`PASS ${stage}: HTTP ${response.status}`);
  return data;
}

async function main() {
  const auth = await postForm('admin authentication', '/auth/login', {
    login,
    password,
    type: 'e-mail',
  });
  if (auth.status !== 'success' || !auth.auth_hash) {
    throw new Error('admin authentication: response did not contain auth_hash');
  }

  const tokenResponse = await postForm('token acquisition', '/token', {
    auth_hash: auth.auth_hash,
  });
  const token = tokenResponse?.data?.token;
  const uHash = tokenResponse?.data?.u_hash;
  if (tokenResponse.status !== 'success' || !token || !uHash) {
    throw new Error('token acquisition: response did not contain token and u_hash');
  }

  const apiData = await postForm('database-backed API data read', '/data', {
    token,
    u_hash: uHash,
    json_like: JSON.stringify({
      site_constants: '',
      booking_comments: '',
    }),
  });
  const payload = apiData?.data?.data;
  if (apiData.status !== 'success' || !payload?.site_constants || !payload?.booking_comments) {
    throw new Error('database-backed API data read: site_constants or booking_comments missing');
  }
  console.log('PASS database-backed API data read: site_constants and booking_comments present');

  const quote = await postForm('nanny pricing template quote', '/script/template/nanny_pricing', {
    token,
    hash: uHash,
    is_var: '1',
    s_t_data: JSON.stringify({
      action: 'quote',
      when: 'now',
      time_zone: 'Europe/Madrid',
      options: [],
      duration_min: 0,
    }),
  });
  const quoteData = quote?.data?.data ?? quote?.data;
  if (quote.status !== 'success' || !quoteData || !Number.isFinite(Number(quoteData.price))) {
    throw new Error('nanny pricing template quote: successful numeric price was not returned');
  }
  console.log('PASS nanny pricing template quote: numeric price returned');
  console.log('LIVE BACKEND SMOKE TEST PASSED (read-only; no order created)');
}

main().catch((error) => {
  console.error(`LIVE BACKEND SMOKE TEST FAILED: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exitCode = 1;
});
