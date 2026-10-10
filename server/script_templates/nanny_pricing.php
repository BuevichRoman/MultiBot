<?php
/**
 * nanny_pricing — единый расчёт цены заказа няни (тенант children).
 *
 * Цену считает только сервер: бот, приложение няни и веб-версия получают её
 * отсюда, своих копий формулы у них нет. Формула и константы — из
 * site_constants.pricingModels, цены опций — из booking_comments.
 *
 * Вызов: POST /api/v1/script/template/<id>, s_t_data = JSON с полем action.
 *
 *   quote  — цена до создания заказа
 *            {"action":"quote", "when":"2026-10-11 09:00:00+00:00"|null,
 *             "time_zone":"Europe/Madrid", "options":[1,4]}
 *            → data: {formula, price, options, calculationType}
 *
 *   create — создать заказ с серверной ценой, без дублей
 *            {"action":"create", "request_key":"<8-64 [A-Za-z0-9_-]>",
 *             "time_zone":"Europe/Madrid", "order":{...как data у POST /drive...}}
 *            → data: {b_id, duplicate, pricingModel}
 *            Повтор с тем же request_key у того же клиента в течение суток
 *            возвращает уже созданный заказ (duplicate: true), второй не создаётся.
 *
 *   final  — цена по снимку заказа: по умолчанию длительность от планового
 *            начала до завершения; с duration_min — за заданные минуты
 *            (приложение няни так показывает цену оплачиваемого времени)
 *            {"action":"final", "b_id":4200, "duration_min":95?}
 *            → data: {formula, price, options, calculationType}
 *            Доступно клиенту заказа, его няне и админу.
 *
 * День/ночь — по часу начала заказа в его поясе: день 06:00–22:00, как у
 * ночного поиска нянь. Пояс присылает клиент (IANA), по умолчанию Europe/Madrid.
 * Шаблон заводится с only_admin = 0: его вызывают клиент и няня.
 */
call_user_func(function () {
    $api = $this;

    $in = isset($_REQUEST['s_t_data']) ? $_REQUEST['s_t_data'] : '';
    $in = is_array($in) ? $in : json_decode($in, true);
    if (empty($in) || !is_array($in) || empty($in['action'])) {
        json_exit('404', 'error', 'wrong s_t_data', null);
    }

    $uid = (int)$_SESSION[UID];
    $role = (int)$api->id_role;

    // --- модель цены -------------------------------------------------------

    $sc = isset(taxi::$data['site_constants']['pricingModels']['value'])
        ? taxi::$data['site_constants']['pricingModels']['value'] : '';
    $models = is_array($sc) ? $sc : json_decode($sc, true);
    $model = isset($models['pricing_models']['basic']) ? $models['pricing_models']['basic'] : null;
    if (empty($model['model']['expression'])) {
        json_exit('404', 'error', 'pricing model not configured', null);
    }
    $expression = (string)$model['model']['expression'];
    $const = isset($model['constants']) ? $model['constants'] : array();
    $c = function ($path, $default) use ($const) {
        $v = $const;
        foreach (explode('.', $path) as $k) {
            if (!is_array($v) || !isset($v[$k])) return $default;
            $v = $v[$k];
        }
        return is_numeric($v) ? $v + 0 : $default;
    };

    $zoneOf = function ($name) {
        $name = is_string($name) ? trim($name) : '';
        if ($name !== '' && in_array($name, timezone_identifiers_list(), true)) return $name;
        return 'Europe/Madrid';
    };

    // Час начала заказа в его поясе. 'now' и пусто — текущее время
    $startHour = function ($when, $zone) {
        try {
            // UTC явно: от date.timezone сервера не зависим, смещение в строке его перекрывает
            $utc = new DateTimeZone('UTC');
            $d = (empty($when) || $when === 'now') ? new DateTime('now', $utc) : new DateTime($when, $utc);
        } catch (Exception $e) {
            $d = new DateTime('now', new DateTimeZone('UTC'));
        }
        $d->setTimezone(new DateTimeZone($zone));
        return (int)$d->format('G');
    };

    $optionsSum = function ($ids) {
        $sum = 0;
        $comments = isset(taxi::$data['booking_comments']) ? taxi::$data['booking_comments'] : array();
        foreach ((array)$ids as $id) {
            $id = (string)$id;
            if (!isset($comments[$id])) continue;
            $o = $comments[$id]['options'];
            if (is_string($o)) $o = json_decode($o, true);
            if (isset($o['price']) && is_numeric($o['price'])) $sum += $o['price'] + 0;
        }
        return $sum;
    };

    // Арифметика без eval: числа, переменные, + - * /, унарный минус, скобки
    $evaluate = function ($formula, $vars) {
        preg_match_all('/\d*\.?\d+(?:[eE][+-]?\d+)?|[A-Za-z_]\w*|[-+*\/()]|\S/', $formula, $m);
        $t = $m[0];
        $p = 0;
        $fail = function ($why) use ($formula) { throw new Exception($why . ' in "' . $formula . '"'); };
        $expr = null;
        $factor = function () use (&$t, &$p, &$expr, $vars, $fail, &$factor) {
            $x = isset($t[$p]) ? $t[$p] : null;
            $p++;
            if ($x === '-') return -$factor();
            if ($x === '+') return $factor();
            if ($x === '(') {
                $v = $expr();
                if (!isset($t[$p]) || $t[$p] !== ')') $fail('missing )');
                $p++;
                return $v;
            }
            if ($x !== null && preg_match('/^\d*\.?\d/', $x)) return $x + 0;
            if ($x !== null && preg_match('/^[A-Za-z_]/', $x)) {
                if (!isset($vars[$x]) || !is_numeric($vars[$x])) $fail('unknown variable ' . $x);
                return $vars[$x] + 0;
            }
            $fail('unexpected ' . ($x === null ? 'end' : $x));
        };
        $term = function () use (&$t, &$p, $factor) {
            $v = $factor();
            while (isset($t[$p]) && ($t[$p] === '*' || $t[$p] === '/')) {
                $op = $t[$p++];
                $r = $factor();
                if ($op === '/' && $r == 0) throw new Exception('division by zero');
                $v = $op === '*' ? $v * $r : $v / $r;
            }
            return $v;
        };
        $expr = function () use (&$t, &$p, $term) {
            $v = $term();
            while (isset($t[$p]) && ($t[$p] === '+' || $t[$p] === '-')) {
                $op = $t[$p++];
                $r = $term();
                $v = $op === '+' ? $v + $r : $v - $r;
            }
            return $v;
        };
        $v = $expr();
        if ($p !== count($t)) $fail('trailing input');
        return $v;
    };

    $price = function ($formula, $vars) use ($evaluate) {
        try {
            $v = $evaluate($formula, $vars);
        } catch (Exception $e) {
            json_exit('404', 'error', 'price calculation failed: ' . $e->getMessage(), null);
        }
        return (string)(int)($v >= 0 ? floor($v) : ceil($v)); // как Math.trunc
    };

    // Цена до заказа: маршрута нет, distance и duration — нули (как было в боте)
    $quote = function ($when, $zone, $options) use ($c, $startHour, $optionsSum, $price, $expression) {
        $h = $startHour($when, $zone);
        $day = $h >= 6 && $h < 22;
        $vars = array(
            'base_price'       => $c('base_price', 0),
            'distance'         => 0,
            'price_per_km'     => $c('price_per_km', 0),
            'duration'         => 0,
            'price_per_minute' => $c('price_per_minute', 0),
            'time_ratio'       => $c($day ? 'time_ratio.day' : 'time_ratio.night', 1),
            'options_sum'      => $optionsSum($options),
            'submit_price'     => 0,
            'car_class_ratio'  => 1,
        );
        return array(
            'formula'         => $expression,
            'price'           => $price($expression, $vars),
            'options'         => $vars,
            'calculationType' => 'incomplete',
        );
    };

    // --- действия ----------------------------------------------------------

    $action = (string)$in['action'];

    if ($action === 'quote') {
        $zone = $zoneOf(isset($in['time_zone']) ? $in['time_zone'] : '');
        json_exit('200', 'success', null, $quote(
            isset($in['when']) ? $in['when'] : null,
            $zone,
            isset($in['options']) ? $in['options'] : array()
        ));
    }

    if ($action === 'create') {
        $key = isset($in['request_key']) ? (string)$in['request_key'] : '';
        if (!preg_match('/^[A-Za-z0-9_-]{8,64}$/', $key)) {
            json_exit('404', 'error', 'wrong request_key', null);
        }
        $order = isset($in['order']) && is_array($in['order']) ? $in['order'] : null;
        if (empty($order)) json_exit('404', 'error', 'empty order', null);

        $zone = $zoneOf(isset($in['time_zone']) ? $in['time_zone'] : '');
        $pm = $quote(
            isset($order['b_start_datetime']) ? $order['b_start_datetime'] : null,
            $zone,
            isset($order['b_comments']) ? $order['b_comments'] : array()
        );
        if (!isset($order['b_options']) || !is_array($order['b_options'])) $order['b_options'] = array();
        $order['b_options']['pricingModel'] = $pm;
        $order['b_options']['requestKey'] = $key;

        // Проверка и создание под одной блокировкой: два одновременных
        // запроса с одним ключом не создадут два заказа
        $lock = 'nanny_order_' . $uid;
        $q = query("SELECT GET_LOCK('" . real_escape_string($lock) . "', 10) AS l");
        $got = $q ? fetch_assoc($q) : null;
        if (empty($got['l'])) json_exit('404', 'error', 'order is being created, retry later', null);

        $q = query("SELECT `id_order` FROM `order`
            WHERE `client` = '" . $uid . "'
              AND `create_datetime` > NOW() - INTERVAL 1 DAY
              AND `options` LIKE '%\"requestKey\":\"" . real_escape_string($key) . "\"%'
            ORDER BY `id_order` DESC LIMIT 1");
        $row = $q ? fetch_assoc($q) : null;
        if (!empty($row['id_order'])) {
            query("SELECT RELEASE_LOCK('" . real_escape_string($lock) . "')");
            json_exit('200', 'success', null, array(
                'b_id' => (int)$row['id_order'], 'duplicate' => true, 'pricingModel' => $pm,
            ));
        }

        $res = $api->createOrder(
            json_encode($order),
            isset(taxi::$data['langs']) ? taxi::$data['langs'] : array(),
            isset(taxi::$data['payment_ways']) ? taxi::$data['payment_ways'] : array(),
            isset(taxi::$data['payment_card']) ? taxi::$data['payment_card'] : array(),
            isset(taxi::$data['booking_comments']) ? taxi::$data['booking_comments'] : array(),
            isset(taxi::$data['services']) ? taxi::$data['services'] : array(),
            isset(taxi::$data['contact_classes']) ? taxi::$data['contact_classes'] : array(),
            isset(taxi::$data['booking_location_classes']) ? taxi::$data['booking_location_classes'] : array(),
            isset(taxi::$data['currencies']) ? taxi::$data['currencies'] : array(),
            isset(taxi::$data['unit_sets']) ? taxi::$data['unit_sets'] : array(),
            isset(taxi::$data['countries']) ? taxi::$data['countries'] : array(),
            isset(taxi::$data['regions']) ? taxi::$data['regions'] : array(),
            isset(taxi::$data['cities']) ? taxi::$data['cities'] : array(),
            isset(taxi::$data_sc['schedule']) ? taxi::$data_sc['schedule'] : array(),
            isset(taxi::$data_private['price_time_functions']) ? taxi::$data_private['price_time_functions'] : array(),
            empty(taxi::$data['site_constants']['stripe_seat_title_template']) ? '' : taxi::$data['site_constants']['stripe_seat_title_template']['value'],
            empty(taxi::$data['site_constants']['stripe_request_duration']) ? 0 : taxi::$data['site_constants']['stripe_request_duration']['value'],
            isset(taxi::$data_private['aggregators']) ? taxi::$data_private['aggregators'] : array()
        );
        query("SELECT RELEASE_LOCK('" . real_escape_string($lock) . "')");

        if (!isset($res['status']) || $res['status'] !== 'success' || empty($res['data']['b_id'])) {
            json_exit(
                isset($res['code']) ? $res['code'] : '404',
                isset($res['status']) ? $res['status'] : 'error',
                isset($res['message']) ? $res['message'] : 'order not created',
                null
            );
        }
        json_exit('200', 'success', null, array(
            'b_id' => (int)$res['data']['b_id'], 'duplicate' => false, 'pricingModel' => $pm,
        ));
    }

    if ($action === 'final') {
        $id = isset($in['b_id']) ? (int)$in['b_id'] : 0;
        if ($id <= 0) json_exit('404', 'error', 'wrong b_id', null);
        $q = query("SELECT `client`, `options`, `datetime_start_plan`, `complete_datetime`
            FROM `order` WHERE `id_order` = '" . $id . "'");
        $o = $q ? fetch_assoc($q) : null;
        if (empty($o)) json_exit('404', 'error', 'order not found', null);

        if ($role != 4 && (int)$o['client'] !== $uid) {
            $q = query("SELECT 1 FROM `order_driver` WHERE `id_order` = '" . $id . "' AND `id_user` = '" . $uid . "' LIMIT 1");
            if (!$q || !fetch_assoc($q)) json_exit('404', 'error', 'not enough rights', null);
        }

        $opts = json_decode($o['options'], true);
        $pm = isset($opts['pricingModel']) ? $opts['pricingModel'] : null;
        if (empty($pm['formula']) || $pm['formula'] === '-' || !is_array($pm['options'])) {
            json_exit('404', 'error', 'order has no price', null);
        }
        $vars = $pm['options'];
        if (isset($in['duration_min'])) {
            if (!is_numeric($in['duration_min']) || $in['duration_min'] < 0) json_exit('404', 'error', 'wrong duration_min', null);
            $vars['duration'] = (int)$in['duration_min'];
            $pm['options'] = $vars;
            $pm['price'] = $price($pm['formula'], $vars);
        } elseif (!empty($o['complete_datetime']) && $o['complete_datetime'] !== '0000-00-00 00:00:00') {
            // Минуты от планового начала до завершения, как считало приложение
            // няни; пока заказ не завершён, цена — та, что в заказе
            // Обе отметки — в поясе базы, разница от пояса не зависит; UTC — чтобы
            // не зависеть от date.timezone (предупреждение ушло бы в ответ e_warning)
            $utc = new DateTimeZone('UTC');
            $from = new DateTime($o['datetime_start_plan'], $utc);
            $to = new DateTime($o['complete_datetime'], $utc);
            $mins = (int)(($to->getTimestamp() - $from->getTimestamp()) / 60);
            $vars['duration'] = $mins;
            $pm['options'] = $vars;
            $pm['price'] = $price($pm['formula'], $vars);
        }
        json_exit('200', 'success', null, $pm);
    }

    json_exit('404', 'error', 'unknown action', null);
});
