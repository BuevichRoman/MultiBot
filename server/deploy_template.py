#!/usr/bin/env python3
"""
Заводит (или обновляет) на платформе шаблон nanny_pricing и проверяет его.

Нужна учётка с ролью 4 — у бота это его служебная учётка из
config/orchestrator.json. Пароль только через переменные окружения:

    NB_LOGIN=... NB_PASSWORD=... python3 server/deploy_template.py
    NB_LOGIN=... NB_PASSWORD=... python3 server/deploy_template.py --check 888

Шаги:
  1. requestKey в белом списке b_options (иначе платформа отклонит заказ);
  2. шаблон nanny_pricing: создать или обновить код, active=1, only_admin=0;
  3. --check <id клиента>: quote, create дважды с одним ключом (должен
     вернуться тот же заказ), final; тестовый заказ отменяется.
"""
import json
import os
import sys
import uuid
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

TENANT = 'children'
BASE = f'https://ibronevik.ru/taxi/c/{TENANT}/api/v1'
CONFIG_JS = f'https://ibronevik.ru/taxi/cache/data_{TENANT}.js'
VAR = 'nanny_pricing'
SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'script_templates', 'nanny_pricing.php')


def post(path, fields, auth=None):
    if auth:
        fields = dict(fields, token=auth['token'], u_hash=auth['u_hash'])
    req = urllib.request.Request(BASE + path, data=urllib.parse.urlencode(fields).encode(),
                                 headers={'User-Agent': 'nanny-pricing-deploy'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def must(r, what):
    if r.get('status') != 'success':
        sys.exit(f'✗ {what}: {r.get("code")} {r.get("message")}')
    if r.get('e_warning'):
        print(f'  ! {what}: e_warning {json.dumps(r["e_warning"], ensure_ascii=False)[:300]}')
    return r.get('data')


def login():
    r = post('/auth/login', {'login': os.environ['NB_LOGIN'], 'password': os.environ['NB_PASSWORD'], 'type': 'e-mail'})
    must(r, 'вход')
    t = must(post('/token', {'auth_hash': r['auth_hash']}), 'токен')
    return {'token': t['token'], 'u_hash': t['u_hash']}


def public_constant(name):
    with urllib.request.urlopen(urllib.request.Request(CONFIG_JS, headers={'User-Agent': 'nanny-pricing-deploy'}), timeout=60) as r:
        s = r.read().decode()
    data = json.loads(s[s.index('{'):s.rindex('}') + 1])
    return data['site_constants'][name]['value']


def ensure_whitelist(auth):
    keys = json.loads(public_constant('b_options_valid_keys') or '{}')
    if keys.get('requestKey'):
        print('✓ requestKey уже в белом списке b_options')
        return
    keys['requestKey'] = True
    must(post('/data', {'data': json.dumps({'site_constants': [
        {'id': 'b_options_valid_keys', 'value': json.dumps(keys, ensure_ascii=False)}]}, ensure_ascii=False)}, auth),
        'белый список b_options')
    print('✓ requestKey добавлен в белый список b_options')


def upsert_template(auth):
    src = open(SRC, encoding='utf-8').read()
    priv = must(post('/data', {'private': 1}, auth), 'чтение шаблонов') or {}
    found = None
    for tid, t in (priv.get('script_templates') or {}).items():
        if isinstance(t, dict) and t.get('var') == VAR:
            found = tid
    row = {'var': VAR, 'file': src, 'active': 1, 'only_admin': 0}
    if found:
        row['id'] = found
    must(post('/data', {'data': json.dumps({'script_templates': [row]}, ensure_ascii=False)}, auth), 'шаблон')
    print(f'✓ шаблон {VAR} {"обновлён (id " + str(found) + ")" if found else "создан"}')


def template(auth, payload, client=None):
    fields = {'is_var': 1, 's_t_data': json.dumps(payload, ensure_ascii=False)}
    if client:
        fields.update({'u_a_id': client, 'u_a_role': 1})
    return post(f'/script/template/{VAR}', fields, auth)


def check(auth, client):
    tomorrow = (datetime.now(timezone.utc) + timedelta(days=1)).replace(hour=9, minute=0, second=0, microsecond=0)
    when = tomorrow.strftime('%Y-%m-%d %H:%M:%S+00:00')
    q = must(template(auth, {'action': 'quote', 'when': when, 'time_zone': 'Europe/Madrid', 'options': []}, client), 'quote')
    print(f'✓ quote: {q["price"]} ({q["formula"]}, time_ratio {q["options"]["time_ratio"]})')

    key = 'selfcheck-' + uuid.uuid4().hex[:16]
    order = {
        'b_start_latitude': '36.720160', 'b_start_longitude': '-4.420340',
        'b_start_datetime': when, 'b_passengers_count': 1, 'b_max_waiting': 3600,
        'b_payment_way': 1, 'b_services': [], 'b_comments': [],
        'b_options': {'submitPrice': 0, 'createdBy': 'whatsapp', 'childrenProfiles': '1'},
    }
    c1 = must(template(auth, {'action': 'create', 'request_key': key, 'time_zone': 'Europe/Madrid', 'order': order}, client), 'create')
    bid = c1['b_id']
    try:
        print(f'✓ create: заказ {bid}, цена {c1["pricingModel"]["price"]}, duplicate={c1["duplicate"]}')
        c2 = must(template(auth, {'action': 'create', 'request_key': key, 'time_zone': 'Europe/Madrid', 'order': order}, client), 'create повтор')
        ok = c2['b_id'] == bid and c2['duplicate'] is True
        print(f'{"✓" if ok else "✗"} повтор с тем же ключом: заказ {c2["b_id"]}, duplicate={c2["duplicate"]}')
        f = must(template(auth, {'action': 'final', 'b_id': bid, 'duration_min': 120}, client), 'final')
        print(f'✓ final за 120 мин: {f["price"]}')
        if not ok:
            sys.exit('✗ защита от повтора не сработала')
    finally:
        r = post(f'/drive/get/{bid}', {'action': 'set_cancel_state', 'reason': 'проверка шаблона цены',
                                        'u_a_id': client, 'u_a_role': 1}, auth)
        print(f'{"✓" if r.get("status") == "success" else "✗"} тестовый заказ {bid} отменён: {r.get("status")} {r.get("message") or ""}')


def main():
    if 'NB_LOGIN' not in os.environ or 'NB_PASSWORD' not in os.environ:
        sys.exit('нужны NB_LOGIN и NB_PASSWORD (учётка с ролью 4)')
    auth = login()
    ensure_whitelist(auth)
    upsert_template(auth)
    if '--check' in sys.argv:
        check(auth, sys.argv[sys.argv.index('--check') + 1])


if __name__ == '__main__':
    main()
